import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SprixyClient, SprixyError, type Asset, type Generation } from '@sprixy/client';

export interface SprixyMcpOptions {
  /** Allow tools to write exported files to the local disk (stdio mode only). */
  allowFileWrite?: boolean;
  writeFile?: (path: string, data: Uint8Array) => Promise<string>;
  version?: string;
}

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } | { type: 'resource'; resource: { uri: string; blob: string; mimeType: string } };

const text = (t: string): Content => ({ type: 'text', text: t });
const json = (v: unknown): Content => text(JSON.stringify(v, null, 2));

function b64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

const KINDS = ['sprite', 'character', 'object', 'environment', 'tileset', 'texture', 'ui', 'icon'] as const;
const DITHER = ['none', 'floyd-steinberg', 'atkinson', 'bayer2', 'bayer4', 'bayer8'] as const;

const postprocess = z.object({
  removeBackground: z.enum(['flood', 'ai', 'none']).optional().describe("'flood' = free deterministic removal (default), 'ai' = BiRefNet (paid), 'none'"),
  pixelize: z.boolean().optional().describe('Snap to a true pixel grid at the native resolution (default true)'),
  palette: z.enum(['project', 'auto', 'none']).optional().describe("'project' = enforce the project palette (default)"),
  maxColors: z.number().int().min(2).max(256).optional(),
  outline: z.boolean().optional(),
  dither: z.enum(DITHER).optional(),
}).optional();

const stepSchema = z.record(z.string(), z.unknown()).describe('A processing step: { "op": "<op>", ...params }. Call sprixy_get_capabilities for the list of ops.');

export function createSprixyMcpServer(client: SprixyClient, opts: SprixyMcpOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'sprixy', version: opts.version ?? '0.1.0' },
    {
      instructions:
        'Sprixy generates and processes 2D game assets (pixel art sprites, characters, tilesets, animations). ' +
        'Typical flow: sprixy_list_projects → sprixy_get_project (art direction keeps assets coherent) → sprixy_estimate_cost → sprixy_generate_asset → ' +
        'sprixy_create_variant / sprixy_generate_directions / sprixy_animate_asset → sprixy_export_asset. ' +
        'AI tools cost money on the user\'s own provider keys: estimate first when generating many assets. Processing tools (sprixy_process_asset, sprixy_slice_spritesheet) are free.',
    },
  );

  async function previews(assets: Asset[], max = 4): Promise<Content[]> {
    const out: Content[] = [];
    for (const a of assets.slice(0, max)) {
      const scale = Math.max(1, Math.min(16, Math.floor(256 / Math.max(a.width, a.height))));
      try {
        const f = await client.download(`/api/v1/assets/${a.id}/export?format=png&scale=${scale}`);
        out.push({ type: 'image', data: b64(f.data), mimeType: 'image/png' });
      } catch { /* preview is best effort */ }
    }
    return out;
  }

  async function finish(g: Generation, wait: boolean): Promise<{ content: Content[]; isError?: boolean }> {
    if (!wait) return { content: [json({ generation: g, note: 'Job started. Poll with sprixy_get_generation.' })] };
    let cur = g;
    const deadline = Date.now() + 20 * 60_000;
    while ((cur.status === 'queued' || cur.status === 'running') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      cur = await client.getGeneration(cur.id);
    }
    if (cur.status !== 'succeeded') return { content: [json({ generation: cur })], isError: cur.status === 'failed' };
    const assets = await Promise.all(cur.outputAssetIds.map((id) => client.getAsset(id)));
    const summary = assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, size: `${a.width}x${a.height}`, frames: a.frames?.length ?? 0, tags: a.tags }));
    return {
      content: [json({ status: cur.status, generationId: cur.id, cost: cur.actualCost, costSource: cur.costSource, warnings: cur.warnings, extra: cur.extra, assets: summary }), ...(await previews(assets))],
    };
  }

  const guard = <A,>(fn: (args: A) => Promise<{ content: Content[]; isError?: boolean }>) => async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      const msg = e instanceof SprixyError ? `${e.code}: ${e.message}${e.details ? `\n${JSON.stringify(e.details)}` : ''}` : (e as Error).message;
      return { content: [text(`Error — ${msg}`)], isError: true };
    }
  };

  // ── Projects & art direction ──
  server.registerTool('sprixy_list_projects', {
    title: 'List projects',
    description: 'List Sprixy projects with their asset counts and effective palette.',
    inputSchema: {},
  }, guard(async () => {
    const { items } = await client.listProjects();
    return { content: [json(items.map((p) => ({ id: p.id, name: p.name, description: p.description, assets: p.assetCount, palette: p.effectivePalette })))] };
  }));

  server.registerTool('sprixy_get_project', {
    title: 'Get project & art direction',
    description: 'Get a project with its full art direction (palette, native resolution, perspective, lighting, shading, outline, preferred models and LoRAs).',
    inputSchema: { projectId: z.string() },
  }, guard(async ({ projectId }) => ({ content: [json(await client.request('GET', `/api/v1/projects/${projectId}/art-direction`))] })));

  server.registerTool('sprixy_create_project', {
    title: 'Create project',
    description: 'Create a project. artDirection is optional: { palette: { presetId?: "pico-8"|"db32"|"endesga-32"|..., colors?: string[], enforce?: boolean, maxColors?: number }, spriteSize: {width,height}, iconSize, tileSize, sceneSize, perspective: side|top-down|three-quarter|isometric|front, lighting, shading: flat|cel|soft|dithered, detail: minimal|low|medium|high, outline: none|black|dark-colored|selective, styleNotes, models: {image?, edit?, animate?, removeBg?}, loras: [{loraId, scale}] }',
    inputSchema: { name: z.string(), description: z.string().optional(), artDirection: z.record(z.string(), z.unknown()).optional() },
  }, guard(async (a) => ({ content: [json(await client.createProject(a))] })));

  server.registerTool('sprixy_update_art_direction', {
    title: 'Update art direction',
    description: 'Merge changes into a project art direction (same fields as sprixy_create_project.artDirection). New assets automatically follow it.',
    inputSchema: { projectId: z.string(), patch: z.record(z.string(), z.unknown()) },
  }, guard(async ({ projectId, patch }) => ({ content: [json(await client.updateArtDirection(projectId, patch))] })));

  // ── Models, cost, usage ──
  server.registerTool('sprixy_list_models', {
    title: 'List AI models',
    description: 'List available models with capabilities (txt2img, img2img, edit, animate, removeBg, train), list price, quality/speed ratings and whether the user has a key for the provider.',
    inputSchema: { capability: z.enum(['txt2img', 'img2img', 'edit', 'animate', 'removeBg', 'train']).optional() },
  }, guard(async ({ capability }) => {
    const r = await client.listModels(capability);
    const items = (r.items as { id: string; name: string; capabilities: string[]; pricing: unknown; quality: number; speed: number; available: boolean; dynamic?: boolean }[])
      .filter((m) => !m.dynamic || m.available)
      .map((m) => ({ id: m.id, name: m.name, capabilities: m.capabilities, pricing: m.pricing, quality: m.quality, speed: m.speed, available: m.available }));
    return { content: [json({ defaults: r.defaults, items })] };
  }));

  server.registerTool('sprixy_estimate_cost', {
    title: 'Estimate job cost',
    description: 'Estimate the cost of a job WITHOUT running it. `job` uses the same shape as the generation tools, with a `task` field: generate | variant | directions | animate | removeBg | train.',
    inputSchema: { job: z.record(z.string(), z.unknown()) },
  }, guard(async ({ job }) => ({ content: [json(await client.estimate(job))] })));

  server.registerTool('sprixy_get_usage', {
    title: 'Usage & budgets',
    description: 'Spending today / this month, per provider and model, and configured budgets & limits.',
    inputSchema: { days: z.number().int().min(1).max(365).optional() },
  }, guard(async ({ days }) => ({ content: [json(await client.usage(days ?? 30))] })));

  server.registerTool('sprixy_get_capabilities', {
    title: 'Processing ops, palettes & formats',
    description: 'List deterministic processing operations (with parameters), palette presets, asset kinds and export formats.',
    inputSchema: {},
  }, guard(async () => ({ content: [json(await client.request('GET', '/api/v1/meta'))] })));

  server.registerTool('sprixy_list_loras', {
    title: 'List LoRAs',
    description: 'List preset, imported and trained LoRAs with their compatibility family (z-image, flux2-klein-4b, flux2-klein-9b, flux1).',
    inputSchema: { projectId: z.string().optional() },
  }, guard(async ({ projectId }) => ({ content: [json(await client.request('GET', `/api/v1/loras${projectId ? `?projectId=${projectId}` : ''}`))] })));

  // ── Generation ──
  server.registerTool('sprixy_generate_asset', {
    title: 'Generate asset',
    description: 'Generate pixel-art asset(s) with AI following the project art direction, then convert them deterministically to true pixel art (background removal, grid snapping, palette). Costs money on the user\'s provider key. Returns previews.',
    inputSchema: {
      projectId: z.string(),
      kind: z.enum(KINDS),
      prompt: z.string().describe('What to draw, e.g. "a knight with a blue cape holding a sword"'),
      name: z.string().optional(),
      count: z.number().int().min(1).max(4).optional(),
      modelId: z.string().optional().describe('e.g. fal:z-image-turbo, fal:flux2-klein-9b, openrouter:google/gemini-2.5-flash-image'),
      width: z.number().int().optional().describe('Native pixel width (defaults to the art direction)'),
      height: z.number().int().optional(),
      referenceAssetIds: z.array(z.string()).max(4).optional().describe('Style references (requires an edit-capable model)'),
      loras: z.array(z.object({ loraId: z.string(), scale: z.number().optional() })).optional(),
      seed: z.number().int().optional(),
      tags: z.array(z.string()).optional(),
      postprocess,
      wait: z.boolean().optional().describe('Wait for completion (default true)'),
    },
  }, guard(async ({ wait, ...spec }) => finish(await client.startJob({ task: 'generate', ...spec }), wait !== false)));

  server.registerTool('sprixy_create_variant', {
    title: 'Create variant',
    description: 'Create AI variant(s) of an existing asset (edit with the asset as reference), keeping its palette by default.',
    inputSchema: { assetId: z.string(), prompt: z.string(), count: z.number().int().min(1).max(4).optional(), modelId: z.string().optional(), lockPalette: z.boolean().optional(), strength: z.number().min(0.05).max(1).optional(), wait: z.boolean().optional() },
  }, guard(async ({ wait, ...spec }) => finish(await client.startJob({ task: 'variant', ...spec }), wait !== false)));

  server.registerTool('sprixy_generate_directions', {
    title: 'Multi-direction character',
    description: 'Generate 4 or 8 facing directions of a character (west-facing views are mirrored for free) plus a direction spritesheet.',
    inputSchema: { assetId: z.string(), directions: z.union([z.literal(4), z.literal(8)]).optional(), baseDirection: z.enum(['south', 'east']).optional(), modelId: z.string().optional(), wait: z.boolean().optional() },
  }, guard(async ({ wait, ...spec }) => finish(await client.startJob({ task: 'directions', ...spec }), wait !== false)));

  server.registerTool('sprixy_animate_asset', {
    title: 'Animate asset',
    description: "Animate a sprite: method 'video' (image-to-video model such as Wan, frames extracted and pixelized) or 'sheet' (edit model draws a sprite sheet). Produces an animation asset with frames.",
    inputSchema: { assetId: z.string(), action: z.string().describe('e.g. "walk cycle", "idle breathing", "sword attack"'), method: z.enum(['video', 'sheet']).optional(), frames: z.number().int().min(2).max(24).optional(), fps: z.number().int().min(2).max(30).optional(), modelId: z.string().optional(), wait: z.boolean().optional() },
  }, guard(async ({ wait, ...spec }) => finish(await client.startJob({ task: 'animate', ...spec }), wait !== false)));

  server.registerTool('sprixy_edit_region', {
    title: 'AI edit of a region',
    description: 'Repaint a rectangle of an asset with an edit model (e.g. "replace the sword with a staff"). The result is re-pixelized and palette-locked, and pixels outside the rectangle are guaranteed unchanged. Creates a variant asset.',
    inputSchema: {
      assetId: z.string(), prompt: z.string(),
      x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().min(1), height: z.number().int().min(1),
      modelId: z.string().optional(), lockPalette: z.boolean().optional(), wait: z.boolean().optional(),
    },
  }, guard(async ({ wait, x, y, width, height, ...rest }) => finish(await client.startJob({ task: 'inpaint', rect: { x, y, w: width, h: height }, ...rest }), wait !== false)));

  server.registerTool('sprixy_remove_background_ai', {
    title: 'AI background removal',
    description: 'Remove a complex background with an AI model (BiRefNet). For flat backgrounds prefer the free sprixy_process_asset with { op: "removeBackground" }.',
    inputSchema: { assetId: z.string(), modelId: z.string().optional(), wait: z.boolean().optional() },
  }, guard(async ({ wait, ...spec }) => finish(await client.startJob({ task: 'removeBg', ...spec }), wait !== false)));

  server.registerTool('sprixy_get_generation', {
    title: 'Get generation',
    description: 'Status, progress, cost and output assets of a generation job.',
    inputSchema: { generationId: z.string() },
  }, guard(async ({ generationId }) => ({ content: [json(await client.getGeneration(generationId))] })));

  server.registerTool('sprixy_list_generations', {
    title: 'Generation history',
    description: 'Recent generation jobs (optionally filtered by project or status: active|succeeded|failed).',
    inputSchema: { projectId: z.string().optional(), status: z.string().optional(), limit: z.number().int().max(100).optional() },
  }, guard(async (q) => ({ content: [json(await client.listGenerations(q))] })));

  server.registerTool('sprixy_cancel_generation', {
    title: 'Cancel generation',
    description: 'Cancel a queued or running job.',
    inputSchema: { generationId: z.string() },
  }, guard(async ({ generationId }) => ({ content: [json(await client.cancelGeneration(generationId))] })));

  // ── Library ──
  server.registerTool('sprixy_search_assets', {
    title: 'Search assets',
    description: 'Search the asset library by text, kind, tag, favorite or project.',
    inputSchema: { q: z.string().optional(), projectId: z.string().optional(), kind: z.string().optional(), tag: z.string().optional(), favorite: z.boolean().optional(), limit: z.number().int().max(200).optional() },
  }, guard(async (q) => {
    const r = await client.searchAssets({ ...q, limit: q.limit ?? 50 });
    return { content: [json({ total: r.total, items: r.items.map((a) => ({ id: a.id, name: a.name, kind: a.kind, size: `${a.width}x${a.height}`, frames: a.frames?.length ?? 0, tags: a.tags, favorite: a.favorite, projectId: a.projectId })) })] };
  }));

  server.registerTool('sprixy_get_asset', {
    title: 'Get asset',
    description: 'Asset metadata (frames, palette, variants) with an upscaled preview image.',
    inputSchema: { assetId: z.string(), preview: z.boolean().optional() },
  }, guard(async ({ assetId, preview }) => {
    const a = await client.getAsset(assetId);
    return { content: [json({ ...a, variants: a.variants.map((v) => ({ id: v.id, name: v.name, kind: v.kind })) }), ...(preview === false ? [] : await previews([a], 1))] };
  }));

  server.registerTool('sprixy_update_asset', {
    title: 'Update asset',
    description: 'Rename an asset, set tags or favorite.',
    inputSchema: { assetId: z.string(), name: z.string().optional(), tags: z.array(z.string()).optional(), favorite: z.boolean().optional() },
  }, guard(async ({ assetId, ...patch }) => ({ content: [json(await client.updateAsset(assetId, patch))] })));

  server.registerTool('sprixy_import_image', {
    title: 'Import image',
    description: 'Import an image from an https URL or data URI, optionally converting it to pixel art with a pipeline, e.g. [{"op":"pixelize","width":64,"height":64},{"op":"applyPalette","presetId":"db32"}].',
    inputSchema: { projectId: z.string(), image: z.string(), name: z.string().optional(), kind: z.string().optional(), pipeline: z.array(stepSchema).optional() },
  }, guard(async (a) => {
    const asset = await client.importImage(a);
    return { content: [json(asset), ...(await previews([asset], 1))] };
  }));

  // ── Free processing ──
  server.registerTool('sprixy_process_asset', {
    title: 'Process asset (free)',
    description: 'Run deterministic pixel-art processing (no AI cost): removeBackground, pixelize, reduceColors, applyPalette (presets), dithering, outline, removeOrphans, trim, resize/scale (nearest), flip, hsl, paletteSwap (recolor), seamless… mode: preview | replace | new (variant).',
    inputSchema: { assetId: z.string(), steps: z.array(stepSchema).min(1), mode: z.enum(['preview', 'replace', 'new']).optional() },
  }, guard(async ({ assetId, steps, mode }) => {
    const r = (await client.processAsset(assetId, steps, mode ?? 'new')) as Asset & { preview?: string };
    if (r.preview) return { content: [text(`Preview ${(r as unknown as { width: number }).width}x${(r as unknown as { height: number }).height}`), { type: 'image', data: r.preview.split(',')[1], mimeType: 'image/png' }] };
    return { content: [json(r), ...(await previews([r], 1))] };
  }));

  server.registerTool('sprixy_slice_spritesheet', {
    title: 'Slice spritesheet (free)',
    description: 'Slice a sheet into frames (automatic detection or grid), align frames (bottom/center) and save as an animation or separate assets.',
    inputSchema: {
      assetId: z.string(), mode: z.enum(['grid', 'auto']).optional(), frameWidth: z.number().int().optional(), frameHeight: z.number().int().optional(),
      columns: z.number().int().optional(), rows: z.number().int().optional(), align: z.enum(['bottom', 'center', 'none']).optional(), fps: z.number().int().optional(),
      output: z.enum(['animation', 'assets']).optional(), removeBackground: z.boolean().optional(),
    },
  }, guard(async ({ assetId, ...body }) => ({ content: [json(await client.request('POST', `/api/v1/assets/${assetId}/slice`, body))] })));

  server.registerTool('sprixy_build_autotile', {
    title: 'Autotile terrain set (free)',
    description: 'Build a 16-tile Wang corner autotile set (2 terrains, e.g. dirt + grass) from two texture assets of a project. Free and deterministic; exports as a Godot terrain set or a Tiled wangset.',
    inputSchema: {
      projectId: z.string(), lowerAssetId: z.string(), upperAssetId: z.string(),
      lowerName: z.string().optional(), upperName: z.string().optional(), tileSize: z.number().int().optional(),
      seed: z.number().int().optional(), roughness: z.number().min(0).max(1).optional(), edge: z.boolean().optional(),
    },
  }, guard(async (body) => {
    const a = (await client.request('POST', '/api/v1/tilesets/wang', body)) as Asset;
    return { content: [json({ id: a.id, name: a.name, size: `${a.width}x${a.height}` }), ...(await previews([a], 1))] };
  }));

  // ── Export ──
  server.registerTool('sprixy_export_asset', {
    title: 'Export asset',
    description: 'Export an asset as png | gif | webp | spritesheet | json | zip | godot | unity | phaser. In local (stdio) mode, pass outputDir to write the file to disk; otherwise the file is returned as an embedded resource.',
    inputSchema: {
      assetId: z.string(), format: z.enum(['png', 'gif', 'webp', 'spritesheet', 'json', 'zip', 'godot', 'unity', 'phaser']),
      scale: z.number().int().min(1).max(32).optional(), fps: z.number().int().optional(), outputDir: z.string().optional(),
    },
  }, guard(async ({ assetId, format, scale, fps, outputDir }) => {
    const q = new URLSearchParams({ format, ...(scale ? { scale: String(scale) } : {}), ...(fps ? { fps: String(fps) } : {}) });
    const f = await client.download(`/api/v1/assets/${assetId}/export?${q}`);
    const filename = f.filename ?? `${assetId}.${format}`;
    if (outputDir && opts.allowFileWrite && opts.writeFile) {
      const p = await opts.writeFile(`${outputDir.replace(/[\\/]+$/, '')}/${filename}`, f.data);
      return { content: [text(`Exported ${filename} (${f.data.length} bytes) to ${p}`)] };
    }
    if (f.data.length > 8 * 1024 * 1024) return { content: [text(`Export is ${f.data.length} bytes — too large to embed. Download it from ${client.baseUrl}/api/v1/assets/${assetId}/export?${q} with your API token.`)] };
    return { content: [text(`Exported ${filename} (${f.data.length} bytes)`), { type: 'resource', resource: { uri: `sprixy://exports/${filename}`, blob: b64(f.data), mimeType: f.contentType } }] };
  }));

  return server;
}
