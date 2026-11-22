import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  runPipeline, crop, packSheet, sliceGrid, autoSlice, alignFrames, removeBackgroundFlood, type ProcessStep, type RGBAImage, type Frame,
} from '@sprixy/core';
import { requireUser } from '../auth.js';
import { badRequest } from '../lib/errors.js';
import { decodeImage, encodePng, fetchBinary, toDataUri } from '../lib/images.js';
import { readStored } from '../lib/storage.js';
import { getDb } from '../db/index.js';
import {
  assertProject, createAsset, getAssetRow, listAssets, updateAsset, deleteAsset, replaceAssetImage, loadAssetImage, assetDto,
  saveEditorDoc, loadEditorDoc, imagePalette, type AssetDto,
} from '../services/assets.js';
import { ASSET_KINDS } from '../services/artDirection.js';

/** Zod schema mirroring @sprixy/core ProcessStep (validated server-side). */
const hex = z.string().regex(/^#?[0-9a-fA-F]{6}$/);
const dither = z.enum(['none', 'floyd-steinberg', 'atkinson', 'bayer2', 'bayer4', 'bayer8']);
export const processStepSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('removeBackground'), tolerance: z.number().min(0).max(100).optional(), global: z.boolean().optional() }),
  z.object({ op: z.literal('chromaKey'), color: hex, tolerance: z.number().min(0).max(100).optional() }),
  z.object({ op: z.literal('hardenAlpha'), threshold: z.number().int().min(0).max(255).optional() }),
  z.object({ op: z.literal('pixelize'), width: z.number().int().min(1).max(2048).optional(), height: z.number().int().min(1).max(2048).optional(), sampling: z.enum(['mode', 'center', 'average']).optional() }),
  z.object({ op: z.literal('resize'), width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096) }),
  z.object({ op: z.literal('scale'), factor: z.number().min(0.01).max(32) }),
  z.object({ op: z.literal('reduceColors'), maxColors: z.number().int().min(2).max(256), dither: dither.optional(), ditherStrength: z.number().min(0).max(1).optional() }),
  z.object({ op: z.literal('applyPalette'), palette: z.array(hex).max(256).optional(), presetId: z.string().optional(), dither: dither.optional(), ditherStrength: z.number().min(0).max(1).optional() }),
  z.object({ op: z.literal('removeOrphans'), minNeighbors: z.number().int().min(1).max(8).optional() }),
  z.object({ op: z.literal('fillPinholes') }),
  z.object({ op: z.literal('despeckle') }),
  z.object({ op: z.literal('outline'), color: z.union([hex, z.literal('auto')]).optional(), mode: z.enum(['outer', 'inner']).optional(), diagonal: z.boolean().optional() }),
  z.object({ op: z.literal('trim'), padding: z.number().int().min(0).max(256).optional() }),
  z.object({ op: z.literal('canvas'), width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096), anchor: z.enum(['center', 'top-left', 'bottom-center']).optional() }),
  z.object({ op: z.literal('crop'), x: z.number().int(), y: z.number().int(), width: z.number().int().min(1), height: z.number().int().min(1) }),
  z.object({ op: z.literal('flip'), direction: z.enum(['horizontal', 'vertical']) }),
  z.object({ op: z.literal('hsl'), hue: z.number().optional(), saturation: z.number().min(0).max(4).optional(), lightness: z.number().min(-1).max(1).optional() }),
  z.object({ op: z.literal('brightnessContrast'), brightness: z.number().min(-1).max(1).optional(), contrast: z.number().min(-1).max(1).optional() }),
  z.object({ op: z.literal('replaceColors'), mapping: z.record(z.string(), z.string()) }),
  z.object({ op: z.literal('paletteSwap'), palette: z.array(hex).max(256).optional(), presetId: z.string().optional() }),
  z.object({ op: z.literal('seamless'), band: z.number().int().min(1).max(512).optional() }),
]);
export const pipelineSchema = z.array(processStepSchema).min(1).max(30);

const MAX_PIXELS = 4096 * 4096;
function guard(img: RGBAImage) {
  if (img.width * img.height > MAX_PIXELS) throw badRequest('Image too large (max 16 MP)');
}

/** Run a pipeline on an asset; animations/sheets are processed frame by frame and repacked. */
export function processWithFrames(img: RGBAImage, frames: Frame[] | null, steps: ProcessStep[]): { image: RGBAImage; frames: Frame[] | null } {
  if (!frames?.length) return { image: runPipeline(img, steps), frames: null };
  const parts = frames.map((f) => runPipeline(crop(img, f.rect), steps));
  const uniform = alignFrames(parts, { mode: 'none' });
  const cols = new Set(frames.map((f) => f.rect.y)).size > 0 ? Math.max(1, frames.filter((f) => f.rect.y === frames[0].rect.y).length) : frames.length;
  const sheet = packSheet(uniform, { columns: cols, names: frames.map((f) => f.name), durations: frames.map((f) => f.duration ?? 100) });
  return { image: sheet.image, frames: sheet.frames };
}

async function readUpload(req: FastifyRequest): Promise<{ buffers: { data: Buffer; filename: string }[]; fields: Record<string, string> }> {
  const buffers: { data: Buffer; filename: string }[] = [];
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === 'file') buffers.push({ data: await part.toBuffer(), filename: part.filename });
    else fields[part.fieldname] = String(part.value);
  }
  return { buffers, fields };
}

const idParam = z.object({ id: z.string() });
const kindEnum = z.enum(ASSET_KINDS);

export async function assetRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/v1/assets', {
    schema: {
      tags: ['assets'], summary: 'Search / list assets (library)',
      querystring: z.object({
        projectId: z.string().optional(), kind: z.string().optional(), tag: z.string().optional(), favorite: z.coerce.boolean().optional(),
        q: z.string().optional(), parentId: z.string().optional(), collectionId: z.string().optional(), rootsOnly: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().optional(), offset: z.coerce.number().int().optional(), sort: z.enum(['newest', 'oldest', 'name']).optional(),
      }),
    },
  }, async (req) => listAssets(requireUser(req).id, req.query));

  r.get('/api/v1/tags', { schema: { tags: ['assets'], summary: 'All tags with counts', querystring: z.object({ projectId: z.string().optional() }) } }, async (req) => {
    const u = requireUser(req);
    const rows = getDb().all<{ tag: string; n: number }>(
      `SELECT t.tag, COUNT(*) n FROM asset_tags t JOIN assets a ON a.id = t.asset_id WHERE a.user_id = ? AND a.deleted_at IS NULL ${req.query.projectId ? 'AND a.project_id = ?' : ''} GROUP BY t.tag ORDER BY n DESC`,
      ...(req.query.projectId ? [u.id, req.query.projectId] : [u.id]),
    );
    return { items: rows.map((t) => ({ tag: t.tag, count: t.n })) };
  });

  r.get('/api/v1/assets/:id', { schema: { tags: ['assets'], summary: 'Asset details', params: idParam } }, async (req) => {
    const u = requireUser(req);
    const a = assetDto(getAssetRow(u.id, req.params.id));
    const variants = listAssets(u.id, { parentId: a.id, limit: 200 }).items;
    const parent = a.parentId ? (() => { try { return assetDto(getAssetRow(u.id, a.parentId!)); } catch { return null; } })() : null;
    return { ...a, variants, parent };
  });

  r.get('/api/v1/assets/:id/file', { schema: { tags: ['assets'], summary: 'Asset PNG (native size)', params: idParam } }, async (req, reply) => {
    const row = getAssetRow(requireUser(req).id, req.params.id);
    reply.header('Cache-Control', 'private, max-age=31536000, immutable').type('image/png');
    return readStored(row.file);
  });

  r.get('/api/v1/assets/:id/source', { schema: { tags: ['assets'], summary: 'Raw AI output before post-processing', params: idParam } }, async (req, reply) => {
    const row = getAssetRow(requireUser(req).id, req.params.id);
    if (!row.source_file) throw badRequest('This asset has no source image');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable').type('image/png');
    return readStored(row.source_file);
  });

  r.patch('/api/v1/assets/:id', {
    schema: {
      tags: ['assets'], summary: 'Rename, tag, favorite, change kind/parent, set animation frames', params: idParam,
      body: z.object({
        name: z.string().min(1).max(200).optional(), favorite: z.boolean().optional(), tags: z.array(z.string()).max(50).optional(),
        kind: kindEnum.optional(), parentId: z.string().nullable().optional(), meta: z.record(z.string(), z.unknown()).optional(),
        frames: z.array(z.object({ name: z.string(), rect: z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int(), h: z.number().int() }), duration: z.number().optional() })).nullable().optional(),
      }),
    },
  }, async (req) => updateAsset(requireUser(req).id, req.params.id, req.body));

  r.delete('/api/v1/assets/:id', { schema: { tags: ['assets'], summary: 'Delete an asset', params: idParam } }, async (req) => {
    await deleteAsset(requireUser(req).id, req.params.id);
    return { ok: true };
  });

  // Import (multipart file upload) — optional deterministic conversion to pixel art.
  r.post('/api/v1/assets/upload', {
    schema: { tags: ['assets'], summary: 'Upload images (multipart: files + projectId, kind?, name?, tags?, pipeline? JSON)', consumes: ['multipart/form-data'] },
  }, async (req) => {
    const u = requireUser(req);
    const { buffers, fields } = await readUpload(req);
    if (!fields.projectId) throw badRequest('projectId is required');
    assertProject(u.id, fields.projectId);
    if (!buffers.length) throw badRequest('No file uploaded');
    const steps = fields.pipeline ? pipelineSchema.parse(JSON.parse(fields.pipeline)) : null;
    const kind = kindEnum.catch('import').parse(fields.kind ?? 'import');
    const created: AssetDto[] = [];
    for (const b of buffers) {
      const src = await decodeImage(b.data);
      guard(src);
      const img = steps ? runPipeline(src, steps) : src;
      created.push(await createAsset({
        userId: u.id, projectId: fields.projectId, kind, name: fields.name || b.filename.replace(/\.[^.]+$/, ''), image: img,
        source: steps ? await encodePng(src) : undefined, meta: { palette: imagePalette(img), imported: true, pipeline: steps ?? undefined },
        tags: fields.tags ? fields.tags.split(',') : ['import'],
      }));
    }
    return { items: created };
  });

  // Import from URL or data URI (for API clients like Mocky / MCP).
  r.post('/api/v1/assets/import', {
    schema: {
      tags: ['assets'], summary: 'Import an image from an https URL or a data URI, optionally converting it to pixel art',
      body: z.object({
        projectId: z.string(), image: z.string().min(10), name: z.string().max(200).default('Imported image'), kind: kindEnum.default('import'),
        tags: z.array(z.string()).optional(), pipeline: pipelineSchema.optional(),
      }),
    },
  }, async (req) => {
    const u = requireUser(req);
    assertProject(u.id, req.body.projectId);
    if (!/^(https:\/\/|data:image\/)/.test(req.body.image)) throw badRequest('image must be an https URL or a data:image/... URI');
    const buf = await fetchBinary(req.body.image, { signal: AbortSignal.timeout(20_000) });
    if (buf.length > 30 * 1024 * 1024) throw badRequest('Image too large');
    const src = await decodeImage(buf);
    guard(src);
    const img = req.body.pipeline ? runPipeline(src, req.body.pipeline) : src;
    return createAsset({
      userId: u.id, projectId: req.body.projectId, kind: req.body.kind, name: req.body.name, image: img,
      source: req.body.pipeline ? await encodePng(src) : undefined, meta: { palette: imagePalette(img), imported: true, pipeline: req.body.pipeline },
      tags: req.body.tags ?? ['import'],
    });
  });

  // Deterministic processing (free).
  r.post('/api/v1/assets/:id/process', {
    schema: {
      tags: ['processing'], summary: 'Run a deterministic pipeline on an asset (preview, replace in place, or save as a new variant) — no AI cost',
      params: idParam,
      body: z.object({ steps: pipelineSchema, mode: z.enum(['preview', 'replace', 'new']).default('preview'), fromSource: z.boolean().default(false), name: z.string().max(200).optional() }),
    },
  }, async (req) => {
    const u = requireUser(req);
    const row = getAssetRow(u.id, req.params.id);
    const dto = assetDto(row);
    let input = await loadAssetImage(row);
    let frames = dto.frames;
    if (req.body.fromSource) {
      if (!row.source_file) throw badRequest('This asset has no source image');
      input = await decodeImage(await readStored(row.source_file));
      frames = null;
    }
    const out = processWithFrames(input, frames, req.body.steps as ProcessStep[]);
    if (req.body.mode === 'preview') {
      return { preview: toDataUri(await encodePng(out.image)), width: out.image.width, height: out.image.height, colors: imagePalette(out.image).length };
    }
    if (req.body.mode === 'replace') return replaceAssetImage(u.id, row.id, out.image, { frames: out.frames, meta: { palette: imagePalette(out.image) } });
    return createAsset({
      userId: u.id, projectId: row.project_id, kind: row.kind, name: req.body.name ?? `${row.name} · processed`, image: out.image, parentId: row.id,
      frames: out.frames, meta: { palette: imagePalette(out.image), pipeline: req.body.steps, fps: dto.meta.fps }, tags: ['processed'],
    });
  });

  r.post('/api/v1/assets/batch', {
    schema: {
      tags: ['assets'], summary: 'Batch actions: tag, untag, favorite, unfavorite, delete, move, collection, process',
      body: z.object({
        assetIds: z.array(z.string()).min(1).max(500),
        action: z.enum(['tag', 'untag', 'favorite', 'unfavorite', 'delete', 'move', 'addToCollection', 'process']),
        value: z.string().optional(),
        steps: pipelineSchema.optional(),
        mode: z.enum(['replace', 'new']).default('new'),
      }),
    },
  }, async (req) => {
    const u = requireUser(req);
    const { assetIds, action, value } = req.body;
    const results: { id: string; ok: boolean; error?: string; newId?: string }[] = [];
    for (const id of assetIds) {
      try {
        const a = assetDto(getAssetRow(u.id, id));
        switch (action) {
          case 'tag': updateAsset(u.id, id, { tags: [...a.tags, ...(value ?? '').split(',')] }); break;
          case 'untag': updateAsset(u.id, id, { tags: a.tags.filter((t) => t !== (value ?? '').toLowerCase()) }); break;
          case 'favorite': updateAsset(u.id, id, { favorite: true }); break;
          case 'unfavorite': updateAsset(u.id, id, { favorite: false }); break;
          case 'delete': await deleteAsset(u.id, id); break;
          case 'move': {
            if (!value) throw badRequest('value (projectId) required');
            assertProject(u.id, value);
            getDb().run('UPDATE assets SET project_id = ?, parent_id = NULL, updated_at = ? WHERE id = ?', value, Date.now(), id);
            break;
          }
          case 'addToCollection': {
            const c = getDb().get('SELECT 1 FROM collections WHERE id = ? AND user_id = ?', value ?? '', u.id);
            if (!c) throw badRequest('Collection not found');
            getDb().run('INSERT OR IGNORE INTO collection_assets (collection_id, asset_id, position) VALUES (?,?,?)', value!, id, Date.now());
            break;
          }
          case 'process': {
            if (!req.body.steps) throw badRequest('steps required');
            const row = getAssetRow(u.id, id);
            const out = processWithFrames(await loadAssetImage(row), a.frames, req.body.steps as ProcessStep[]);
            if (req.body.mode === 'replace') await replaceAssetImage(u.id, id, out.image, { frames: out.frames, meta: { palette: imagePalette(out.image) } });
            else {
              const n = await createAsset({ userId: u.id, projectId: row.project_id, kind: row.kind, name: `${row.name} · processed`, image: out.image, parentId: row.id, frames: out.frames, meta: { palette: imagePalette(out.image), pipeline: req.body.steps, fps: a.meta.fps }, tags: ['processed'] });
              results.push({ id, ok: true, newId: n.id });
              continue;
            }
            break;
          }
        }
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: (e as Error).message });
      }
    }
    return { results };
  });

  // Spritesheet slicing & frame alignment.
  r.post('/api/v1/assets/:id/slice', {
    schema: {
      tags: ['processing'], summary: 'Slice a spritesheet (grid or automatic), align frames, and store as animation frames or separate assets',
      params: idParam,
      body: z.object({
        mode: z.enum(['grid', 'auto']).default('auto'),
        frameWidth: z.number().int().min(1).optional(), frameHeight: z.number().int().min(1).optional(),
        columns: z.number().int().min(1).optional(), rows: z.number().int().min(1).optional(),
        margin: z.number().int().min(0).optional(), spacing: z.number().int().min(0).optional(),
        removeBackground: z.boolean().default(false),
        align: z.enum(['bottom', 'center', 'none']).default('bottom'),
        fps: z.number().int().min(1).max(60).default(10),
        output: z.enum(['animation', 'assets']).default('animation'),
      }),
    },
  }, async (req) => {
    const u = requireUser(req);
    const row = getAssetRow(u.id, req.params.id);
    let img = await loadAssetImage(row);
    if (req.body.removeBackground) img = removeBackgroundFlood(img, { tolerance: 12, global: true });
    const b = req.body;
    const sliced = b.mode === 'grid'
      ? sliceGrid(img, { frameWidth: b.frameWidth, frameHeight: b.frameHeight, columns: b.columns, rows: b.rows, margin: b.margin, spacing: b.spacing, skipEmpty: true })
      : autoSlice(img, { mergeDistance: 1 });
    if (!sliced.images.length) throw badRequest('No frames detected');
    const frames = alignFrames(sliced.images, { mode: b.align });
    if (b.output === 'assets') {
      const items: AssetDto[] = [];
      for (const [i, f] of frames.entries()) {
        items.push(await createAsset({ userId: u.id, projectId: row.project_id, kind: 'sprite', name: `${row.name} · ${i + 1}`, image: f, parentId: row.id, meta: { palette: imagePalette(f) }, tags: ['sliced'] }));
      }
      return { items };
    }
    const sheet = packSheet(frames, { columns: Math.min(frames.length, 8), durations: frames.map(() => Math.round(1000 / b.fps)) });
    const asset = await createAsset({ userId: u.id, projectId: row.project_id, kind: 'animation', name: `${row.name} · animation`, image: sheet.image, parentId: row.id, frames: sheet.frames, meta: { fps: b.fps, palette: imagePalette(sheet.image) }, tags: ['animation'] });
    return { items: [asset] };
  });

  // Compose an animation from several assets (frames).
  r.post('/api/v1/animations', {
    schema: {
      tags: ['processing'], summary: 'Build an animation / spritesheet from existing assets (frames in order)',
      body: z.object({ projectId: z.string(), assetIds: z.array(z.string()).min(1).max(256), name: z.string().max(200).default('Animation'), fps: z.number().int().min(1).max(60).default(10), align: z.enum(['bottom', 'center', 'none']).default('bottom'), columns: z.number().int().min(1).optional(), kind: z.enum(['animation', 'spritesheet']).default('animation') }),
    },
  }, async (req) => {
    const u = requireUser(req);
    assertProject(u.id, req.body.projectId);
    const imgs = await Promise.all(req.body.assetIds.map(async (id) => loadAssetImage(getAssetRow(u.id, id))));
    const frames = alignFrames(imgs, { mode: req.body.align });
    const sheet = packSheet(frames, { columns: req.body.columns ?? Math.min(frames.length, 8), durations: frames.map(() => Math.round(1000 / req.body.fps)) });
    return createAsset({ userId: u.id, projectId: req.body.projectId, kind: req.body.kind, name: req.body.name, image: sheet.image, frames: sheet.frames, meta: { fps: req.body.fps, palette: imagePalette(sheet.image), sourceAssets: req.body.assetIds }, tags: [req.body.kind] });
  });

  // Editor: save pixels (+ layered document).
  r.put('/api/v1/assets/:id/image', {
    schema: {
      tags: ['editor'], summary: 'Replace asset pixels from the editor (PNG data URI) and optionally store the layered document',
      params: idParam,
      body: z.object({
        image: z.string().startsWith('data:image/png;base64,'),
        document: z.unknown().optional(),
        frames: z.array(z.object({ name: z.string(), rect: z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int(), h: z.number().int() }), duration: z.number().optional() })).nullable().optional(),
        saveAsNew: z.boolean().default(false),
        name: z.string().max(200).optional(),
      }),
    },
    bodyLimit: 40 * 1024 * 1024,
  }, async (req) => {
    const u = requireUser(req);
    const img = await decodeImage(await fetchBinary(req.body.image));
    guard(img);
    let asset: AssetDto;
    if (req.body.saveAsNew) {
      const row = getAssetRow(u.id, req.params.id);
      asset = await createAsset({ userId: u.id, projectId: row.project_id, kind: row.kind, name: req.body.name ?? `${row.name} · edit`, image: img, parentId: row.id, frames: req.body.frames ?? null, meta: { palette: imagePalette(img), fps: assetDto(row).meta.fps }, tags: ['edited'] });
    } else {
      asset = await replaceAssetImage(u.id, req.params.id, img, { frames: req.body.frames, meta: { palette: imagePalette(img) } });
    }
    if (req.body.document !== undefined) await saveEditorDoc(u.id, asset.id, req.body.document);
    return asset;
  });

  r.get('/api/v1/assets/:id/document', { schema: { tags: ['editor'], summary: 'Layered editor document (null if never edited)', params: idParam } }, async (req) => ({ document: await loadEditorDoc(requireUser(req).id, req.params.id) }));

  r.post('/api/v1/assets/blank', {
    schema: { tags: ['editor'], summary: 'Create an empty asset to draw from scratch', body: z.object({ projectId: z.string(), name: z.string().max(200).default('New sprite'), width: z.number().int().min(1).max(1024), height: z.number().int().min(1).max(1024), kind: kindEnum.default('sprite') }) },
  }, async (req) => {
    const u = requireUser(req);
    assertProject(u.id, req.body.projectId);
    return createAsset({ userId: u.id, projectId: req.body.projectId, kind: req.body.kind, name: req.body.name, image: { width: req.body.width, height: req.body.height, data: new Uint8ClampedArray(req.body.width * req.body.height * 4) }, tags: ['drawn'] });
  });
}
