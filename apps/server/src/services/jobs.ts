import { z } from 'zod';
import { zipSync } from 'fflate';
import {
  type RGBAImage, type Frame,
  removeBackgroundFlood, contentBounds, crop, pixelize, resizeCanvas, runPipeline, hardenAlpha, removeOrphans,
  addOutline, makeSeamless, upscaleInteger, flipHorizontal, packSheet, autoSlice, sliceGrid, alignFrames, applyMask,
  resizeNearest, applyPalette, paletteFromHex, createImage, blit,
} from '@sprixy/core';
import { getDb, parseJson } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, HttpError } from '../lib/errors.js';
import { decodeImage, encodePng, fetchBinary, flattenOnColor } from '../lib/images.js';
import { readStored } from '../lib/storage.js';
import { getModel, getProvider, DEFAULT_MODELS } from '../providers/registry.js';
import { PRESET_LORAS } from '../providers/catalog.js';
import type { ModelDef, TaskRequest, TaskResult, CostEstimate, Capability, LoraRef, ImageInput } from '../providers/types.js';
import { getSecret } from './keys.js';
import { assertWithinBudget } from './budget.js';
import {
  GENERATABLE_KINDS, KIND_SPECS, KEY_BG, buildPrompt, generationSize, normalizeArtDirection, paletteSteps,
  type ArtDirection, type GeneratableKind, type PostProcessOptions, type AssetKind,
} from './artDirection.js';
import { assertProject, createAsset, getAssetRow, loadAssetImage, loadSourceImage, imagePalette, type AssetDto } from './assets.js';
import { extractFrames } from './video.js';
import { config } from '../config.js';

// ───────────────────────────── Schemas ─────────────────────────────

const loraSel = z.object({ loraId: z.string(), scale: z.number().min(0).max(4).optional() });

export const postProcessSchema = z.object({
  removeBackground: z.enum(['flood', 'ai', 'none']).optional(),
  pixelize: z.boolean().optional(),
  palette: z.enum(['project', 'auto', 'none', 'source']).optional(),
  maxColors: z.number().int().min(2).max(256).optional(),
  outline: z.boolean().optional(),
  cleanup: z.boolean().optional(),
  dither: z.enum(['none', 'floyd-steinberg', 'atkinson', 'bayer2', 'bayer4', 'bayer8']).optional(),
});

export const jobSpecSchema = z.discriminatedUnion('task', [
  z.object({
    task: z.literal('generate'),
    projectId: z.string(),
    kind: z.enum(GENERATABLE_KINDS),
    prompt: z.string().min(1).max(2000),
    name: z.string().max(200).optional(),
    modelId: z.string().optional(),
    count: z.number().int().min(1).max(4).default(1),
    width: z.number().int().min(4).max(1024).optional(),
    height: z.number().int().min(4).max(1024).optional(),
    loras: z.array(loraSel).max(3).optional(),
    referenceAssetIds: z.array(z.string()).max(4).optional(),
    seed: z.number().int().min(0).optional(),
    postprocess: postProcessSchema.optional(),
    tags: z.array(z.string()).max(20).optional(),
  }),
  z.object({
    task: z.literal('variant'),
    assetId: z.string(),
    prompt: z.string().min(1).max(2000),
    modelId: z.string().optional(),
    count: z.number().int().min(1).max(4).default(1),
    strength: z.number().min(0.05).max(1).default(0.55),
    lockPalette: z.boolean().default(true),
    loras: z.array(loraSel).max(3).optional(),
    seed: z.number().int().min(0).optional(),
  }),
  z.object({
    task: z.literal('directions'),
    assetId: z.string(),
    directions: z.union([z.literal(4), z.literal(8)]).default(4),
    baseDirection: z.enum(['south', 'east']).default('south'),
    modelId: z.string().optional(),
    lockPalette: z.boolean().default(true),
  }),
  z.object({
    task: z.literal('animate'),
    assetId: z.string(),
    action: z.string().min(1).max(500),
    method: z.enum(['video', 'sheet']).default('video'),
    frames: z.number().int().min(2).max(24).default(8),
    fps: z.number().int().min(2).max(30).default(10),
    modelId: z.string().optional(),
    resolution: z.string().optional(),
    lockPalette: z.boolean().default(true),
  }),
  z.object({
    task: z.literal('removeBg'),
    assetId: z.string(),
    modelId: z.string().optional(),
  }),
  z.object({
    task: z.literal('train'),
    name: z.string().min(1).max(120),
    datasetId: z.string(),
    modelId: z.string().default(DEFAULT_MODELS.train),
    steps: z.number().int().min(100).max(10000).default(1000),
    learningRate: z.number().positive().max(0.01).optional(),
    triggerWord: z.string().max(60).optional(),
    trainingType: z.enum(['content', 'style', 'balanced']).optional(),
    projectId: z.string().optional(),
  }),
]);

export type JobSpec = z.infer<typeof jobSpecSchema>;

// ───────────────────────────── Execution context ─────────────────────────────

interface Ctx {
  genId: string;
  userId: string;
  signal: AbortSignal;
  progress(msg: string): void;
  call(model: ModelDef, req: TaskRequest): Promise<TaskResult>;
}

interface Plan {
  task: JobSpec['task'];
  projectId: string | null;
  kind: string | null;
  model: ModelDef;
  prompt: string;
  finalPrompt: string;
  estimate: CostEstimate;
  calls: { model: ModelDef; req: TaskRequest }[];
  warnings: string[];
  execute(ctx: Ctx): Promise<{ assets: AssetDto[]; extra?: Record<string, unknown> }>;
}

const running = new Map<string, AbortController>();

// ───────────────────────────── Helpers ─────────────────────────────

const DEFAULT_POST: PostProcessOptions = { removeBackground: 'flood', pixelize: true, palette: 'project', outline: false, cleanup: true };

async function pngInput(img: RGBAImage): Promise<ImageInput> {
  return { data: await encodePng(img), mime: 'image/png' };
}

/** Upscale a small sprite (nearest) and flatten it on the key color so image/video models see it clearly. */
function referenceFrom(img: RGBAImage, target = 1024): RGBAImage {
  const k = Math.max(1, Math.floor(target / Math.max(img.width, img.height)));
  return flattenOnColor(upscaleInteger(img, k), KEY_BG.rgb);
}

async function resultImages(res: TaskResult, signal: AbortSignal): Promise<{ img: RGBAImage; raw: Buffer }[]> {
  const out: { img: RGBAImage; raw: Buffer }[] = [];
  for (const im of res.images) {
    const raw = im.data ?? (im.url ? await fetchBinary(im.url, { signal }) : null);
    if (!raw) continue;
    out.push({ img: await decodeImage(raw), raw });
  }
  if (!out.length) throw new Error('The provider returned no image');
  return out;
}

export interface ToSpriteOptions {
  target: { width: number; height: number };
  transparent: boolean;
  anchor: 'center' | 'bottom-center';
  post: PostProcessOptions;
  ad: ArtDirection;
  sourcePalette?: string[];
  seamless?: boolean;
}

/** Deterministic conversion of a raw AI image into a clean, true-grid pixel-art asset. */
export function toSprite(raw: RGBAImage, o: ToSpriteOptions): RGBAImage {
  let img = raw;
  if (o.transparent && o.post.removeBackground === 'flood') img = removeBackgroundFlood(img, { tolerance: 16 });
  if (o.seamless) img = makeSeamless(img);
  if (o.post.pixelize) {
    if (o.transparent) {
      const b = contentBounds(img, 127);
      if (!b) throw new Error('The generated image is empty after background removal — try another prompt or disable background removal');
      const margin = Math.min(o.target.width, o.target.height) >= 16 ? 2 : 0;
      const s = Math.max(b.w / Math.max(1, o.target.width - margin), b.h / Math.max(1, o.target.height - margin));
      const w = Math.max(1, Math.min(o.target.width, Math.round(b.w / s)));
      const h = Math.max(1, Math.min(o.target.height, Math.round(b.h / s)));
      img = pixelize(crop(img, b), { width: w, height: h });
      img = resizeCanvas(img, o.target.width, o.target.height, o.anchor);
      if (o.anchor === 'bottom-center' && margin) {
        // keep a 1px floor margin
        const lifted = createImage(img.width, img.height);
        blit(lifted, img, 0, -1);
        img = lifted;
      }
    } else {
      img = pixelize(img, { width: o.target.width, height: o.target.height });
    }
  }
  img = runPipeline(img, paletteSteps(o.ad, o.post, o.sourcePalette));
  if (o.transparent) {
    img = hardenAlpha(img);
    if (o.post.cleanup) img = removeOrphans(img);
    if (o.post.outline) img = addOutline(img, { color: 'auto', mode: 'inner' });
  }
  return img;
}

function projectArtDirection(userId: string, projectId: string): ArtDirection {
  const p = assertProject(userId, projectId);
  return normalizeArtDirection(parseJson(p.art_direction, {}));
}

interface ResolvedLora { ref: LoraRef; trigger?: string; name: string }

function resolveLoras(userId: string, model: ModelDef, sel: { loraId: string; scale?: number }[], warnings: string[]): ResolvedLora[] {
  const out: ResolvedLora[] = [];
  for (const s of sel) {
    const preset = PRESET_LORAS.find((p) => p.id === s.loraId);
    const row = preset ? null : getDb().get<{ name: string; family: string; path: string; trigger_word: string | null; default_scale: number }>('SELECT * FROM loras WHERE id = ? AND user_id = ?', s.loraId, userId);
    const l = preset
      ? { name: preset.name, family: preset.family, path: preset.path, trigger: preset.triggerWord, scale: s.scale ?? preset.defaultScale }
      : row
        ? { name: row.name, family: row.family, path: row.path, trigger: row.trigger_word ?? undefined, scale: s.scale ?? row.default_scale }
        : null;
    if (!l) { warnings.push(`LoRA ${s.loraId} not found — skipped`); continue; }
    if (!model.loraFamily || l.family !== model.loraFamily || !model.loraEndpoint && !model.editLoraEndpoint) {
      warnings.push(`LoRA "${l.name}" (${l.family}) is not compatible with ${model.name} — skipped`);
      continue;
    }
    out.push({ ref: { path: l.path, scale: l.scale }, trigger: l.trigger, name: l.name });
  }
  return out.slice(0, model.maxLoras ?? 3);
}

async function pickModel(id: string | undefined, fallbacks: (string | undefined)[], cap: Capability, alt?: Capability): Promise<ModelDef> {
  const candidates = [id, ...fallbacks, DEFAULT_MODELS[cap]].filter((x): x is string => !!x);
  for (const c of candidates) {
    try {
      const m = await getModel(c);
      if (m.capabilities.includes(cap) || (alt && m.capabilities.includes(alt))) return m;
      if (c === id) throw badRequest(`Model ${m.name} cannot do "${cap}"`);
    } catch (e) {
      if (c === id) throw e;
    }
  }
  throw badRequest(`No model available for ${cap}`);
}

async function sumEstimates(userId: string, calls: { model: ModelDef; req: TaskRequest }[]): Promise<CostEstimate> {
  let usd = 0, unknown = false, live = true;
  const parts: string[] = [];
  for (const c of calls) {
    let key: string | undefined;
    try { key = getSecret(userId, c.model.provider); } catch { key = undefined; }
    const e = await getProvider(c.model.provider).estimate(c.model, c.req, key);
    if (e.usd === null) unknown = true; else usd += e.usd;
    if (e.source !== 'live') live = false;
    parts.push(`${c.model.name}: ${e.breakdown}`);
  }
  return { usd: unknown && usd === 0 ? null : usd, source: unknown ? 'unknown' : live ? 'live' : 'catalog', breakdown: parts.join(' + ') };
}

const DIRECTION_TEXT: Record<string, string> = {
  south: 'front view, facing the camera',
  east: 'side view facing right',
  north: 'back view, facing away from the camera',
  west: 'side view facing left',
  'south-east': 'three-quarter front view facing down-right',
  'north-east': 'three-quarter back view facing up-right',
  'south-west': 'three-quarter front view facing down-left',
  'north-west': 'three-quarter back view facing up-left',
};
const MIRROR: Record<string, string> = { west: 'east', east: 'west', 'south-west': 'south-east', 'north-west': 'north-east', 'south-east': 'south-west', 'north-east': 'north-west' };

// ───────────────────────────── Planning ─────────────────────────────

export async function planJob(userId: string, spec: JobSpec): Promise<Plan> {
  const warnings: string[] = [];

  if (spec.task === 'generate') {
    const ad = projectArtDirection(userId, spec.projectId);
    const kind = spec.kind as GeneratableKind;
    const kspec = KIND_SPECS[kind];
    const refIds = spec.referenceAssetIds ?? ad.referenceAssetIds;
    let model = await pickModel(spec.modelId, [ad.models.image], 'txt2img', 'edit');
    const useRefs = refIds.length > 0 && model.capabilities.includes('edit');
    if (refIds.length && !useRefs) warnings.push(`${model.name} cannot use reference images — references ignored`);
    if (!model.capabilities.includes('txt2img') && !useRefs) model = await getModel(DEFAULT_MODELS.txt2img);
    const loras = resolveLoras(userId, model, spec.loras ?? ad.loras, warnings);
    const target = { width: spec.width ?? kspec.defaultSize(ad).width, height: spec.height ?? kspec.defaultSize(ad).height };
    const gsize = generationSize(target);
    const post: PostProcessOptions = { ...DEFAULT_POST, ...spec.postprocess, removeBackground: kspec.transparent ? spec.postprocess?.removeBackground ?? 'flood' : 'none' };
    const finalPrompt = buildPrompt(kind, spec.prompt, ad, {
      size: target,
      triggerWords: loras.map((l) => l.trigger ?? ''),
      extra: useRefs ? 'match the art style, palette and proportions of the reference images' : '',
    });
    const refImages: ImageInput[] = [];
    if (useRefs) for (const id of refIds.slice(0, model.maxRefs ?? 4)) refImages.push(await pngInput(referenceFrom(await loadAssetImage(getAssetRow(userId, id)))));
    const req: TaskRequest = useRefs
      ? { task: 'edit', prompt: finalPrompt, images: refImages, width: gsize.width, height: gsize.height, numImages: spec.count, seed: spec.seed, loras: loras.map((l) => l.ref) }
      : { task: 'txt2img', prompt: finalPrompt, width: gsize.width, height: gsize.height, numImages: spec.count, seed: spec.seed, loras: loras.map((l) => l.ref), negativePrompt: ad.negativePrompt };
    const calls: { model: ModelDef; req: TaskRequest }[] = [{ model, req }];
    let bgModel: ModelDef | null = null;
    if (post.removeBackground === 'ai') {
      bgModel = await pickModel(ad.models.removeBg, [], 'removeBg');
      for (let i = 0; i < spec.count; i++) calls.push({ model: bgModel, req: { task: 'removeBg', image: { data: Buffer.alloc(0), mime: 'image/png' } } });
    }
    return {
      task: 'generate', projectId: spec.projectId, kind, model, prompt: spec.prompt, finalPrompt, warnings,
      calls, estimate: await sumEstimates(userId, calls),
      async execute(ctx) {
        const res = await ctx.call(model, req);
        const imgs = await resultImages(res, ctx.signal);
        const assets: AssetDto[] = [];
        for (let i = 0; i < imgs.length; i++) {
          let raw = imgs[i].img;
          let p = post;
          if (bgModel) {
            ctx.progress(`AI background removal ${i + 1}/${imgs.length}…`);
            const cut = await resultImages(await ctx.call(bgModel, { task: 'removeBg', image: { data: imgs[i].raw, mime: 'image/png' } }), ctx.signal);
            raw = cut[0].img.width === raw.width ? applyMask(raw, cut[0].img, 127) : cut[0].img;
            p = { ...post, removeBackground: 'none' };
          }
          ctx.progress(`Pixel-perfect post-processing ${i + 1}/${imgs.length}…`);
          const sprite = toSprite(raw, { target, transparent: kspec.transparent, anchor: kspec.anchor, post: p, ad, seamless: !!kspec.seamless });
          const name = (spec.name ?? spec.prompt).slice(0, 80) + (imgs.length > 1 ? ` #${i + 1}` : '');
          assets.push(await createAsset({
            userId, projectId: spec.projectId, kind: kind as AssetKind, name, image: sprite, source: imgs[i].raw, generationId: ctx.genId,
            meta: { prompt: spec.prompt, modelId: model.id, seed: res.seed, palette: imagePalette(sprite), tileSize: kind === 'tileset' || kind === 'texture' ? ad.tileSize : undefined, loras: loras.map((l) => l.name) },
            tags: spec.tags ?? [kind],
          }));
        }
        return { assets };
      },
    };
  }

  if (spec.task === 'variant') {
    const base = getAssetRow(userId, spec.assetId);
    const ad = projectArtDirection(userId, base.project_id);
    const model = await pickModel(spec.modelId, [ad.models.edit], 'edit', 'img2img');
    const loras = resolveLoras(userId, model, spec.loras ?? ad.loras, warnings);
    const img = await loadAssetImage(base);
    const ref = await pngInput(referenceFrom(img));
    const kind = (GENERATABLE_KINDS as readonly string[]).includes(base.kind) ? (base.kind as GeneratableKind) : 'sprite';
    const kspec = KIND_SPECS[kind];
    const finalPrompt = [
      ...loras.map((l) => l.trigger ?? ''),
      `Variation of the pixel art ${kind} in the reference image: ${spec.prompt}`,
      'keep exactly the same pixel art style, pixel size, proportions, perspective and color palette',
      kspec.transparent ? `plain flat solid ${KEY_BG.name} (${KEY_BG.hex}) background` : '',
    ].filter(Boolean).join(', ');
    const gsize = generationSize({ width: img.width, height: img.height });
    const req: TaskRequest = model.capabilities.includes('edit')
      ? { task: 'edit', prompt: finalPrompt, images: [ref], width: gsize.width, height: gsize.height, numImages: spec.count, seed: spec.seed, loras: loras.map((l) => l.ref) }
      : { task: 'img2img', prompt: finalPrompt, image: ref, strength: spec.strength, width: gsize.width, height: gsize.height, numImages: spec.count, seed: spec.seed, loras: loras.map((l) => l.ref) };
    const sourcePalette = spec.lockPalette ? imagePalette(img) : undefined;
    const calls = [{ model, req }];
    return {
      task: 'variant', projectId: base.project_id, kind: base.kind, model, prompt: spec.prompt, finalPrompt, warnings, calls,
      estimate: await sumEstimates(userId, calls),
      async execute(ctx) {
        const res = await ctx.call(model, req);
        const imgs = await resultImages(res, ctx.signal);
        const assets: AssetDto[] = [];
        for (let i = 0; i < imgs.length; i++) {
          const sprite = toSprite(imgs[i].img, {
            target: { width: img.width, height: img.height }, transparent: kspec.transparent, anchor: kspec.anchor,
            post: { ...DEFAULT_POST, palette: sourcePalette ? 'source' : 'project', removeBackground: kspec.transparent ? 'flood' : 'none' }, ad, sourcePalette,
          });
          assets.push(await createAsset({
            userId, projectId: base.project_id, kind: base.kind, name: `${base.name} · ${spec.prompt}`.slice(0, 120), image: sprite, source: imgs[i].raw,
            parentId: base.id, generationId: ctx.genId, meta: { prompt: spec.prompt, modelId: model.id, variantOf: base.id, palette: imagePalette(sprite) }, tags: ['variant'],
          }));
        }
        return { assets };
      },
    };
  }

  if (spec.task === 'directions') {
    const base = getAssetRow(userId, spec.assetId);
    const ad = projectArtDirection(userId, base.project_id);
    const model = await pickModel(spec.modelId, [ad.models.edit], 'edit');
    const img = await loadAssetImage(base);
    const ref = await pngInput(referenceFrom(img));
    const order = spec.directions === 4 ? ['south', 'east', 'north', 'west'] : ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
    const generated = order.filter((d) => d !== spec.baseDirection && !(MIRROR[d] && order.includes(MIRROR[d]) && ['west', 'south-west', 'north-west'].includes(d)) && !(spec.baseDirection === 'east' && d === 'west'));
    const gsize = generationSize({ width: img.width, height: img.height });
    const prompts = Object.fromEntries(generated.map((d) => [d, [
      `The exact same character as in the reference image, now shown in ${DIRECTION_TEXT[d]}`,
      'identical design, outfit, colors, proportions and pixel art style, same pixel size',
      'full body, centered, standing pose',
      `plain flat solid ${KEY_BG.name} (${KEY_BG.hex}) background`,
    ].join(', ')]));
    const calls = generated.map((d) => ({ model, req: { task: 'edit', prompt: prompts[d], images: [ref], width: gsize.width, height: gsize.height, numImages: 1 } as TaskRequest }));
    const sourcePalette = spec.lockPalette ? imagePalette(img) : undefined;
    return {
      task: 'directions', projectId: base.project_id, kind: base.kind, model, prompt: `${spec.directions} directions`, finalPrompt: Object.values(prompts).join('\n'), warnings, calls,
      estimate: await sumEstimates(userId, calls),
      async execute(ctx) {
        const views: Record<string, RGBAImage> = { [spec.baseDirection]: img };
        const raws: Record<string, Buffer> = {};
        for (const [i, c] of calls.entries()) {
          const d = generated[i];
          ctx.progress(`Generating ${d} view (${i + 1}/${calls.length})…`);
          const [out] = await resultImages(await ctx.call(c.model, c.req), ctx.signal);
          raws[d] = out.raw;
          views[d] = toSprite(out.img, {
            target: { width: img.width, height: img.height }, transparent: true, anchor: 'bottom-center',
            post: { ...DEFAULT_POST, palette: sourcePalette ? 'source' : 'project' }, ad, sourcePalette,
          });
        }
        for (const d of order) if (!views[d] && MIRROR[d] && views[MIRROR[d]]) views[d] = flipHorizontal(views[MIRROR[d]]);
        const assets: AssetDto[] = [];
        for (const d of order) {
          if (d === spec.baseDirection || !views[d]) continue;
          assets.push(await createAsset({
            userId, projectId: base.project_id, kind: base.kind, name: `${base.name} · ${d}`, image: views[d], source: raws[d], parentId: base.id, generationId: ctx.genId,
            meta: { direction: d, palette: imagePalette(views[d]), mirroredFrom: raws[d] ? undefined : MIRROR[d] }, tags: ['direction', d],
          }));
        }
        const present = order.filter((d) => views[d]);
        const sheet = packSheet(present.map((d) => views[d]), { columns: present.length, names: present });
        assets.push(await createAsset({
          userId, projectId: base.project_id, kind: 'spritesheet', name: `${base.name} · ${present.length}-direction sheet`, image: sheet.image, parentId: base.id, generationId: ctx.genId,
          frames: sheet.frames, meta: { directions: present }, tags: ['directions', 'spritesheet'],
        }));
        return { assets };
      },
    };
  }

  if (spec.task === 'animate') {
    const base = getAssetRow(userId, spec.assetId);
    const ad = projectArtDirection(userId, base.project_id);
    const img = await loadAssetImage(base);
    const sourcePalette = spec.lockPalette ? imagePalette(img) : undefined;
    const paletteFix = (f: RGBAImage) => {
      let out = sourcePalette?.length ? applyPalette(f, paletteFromHex(sourcePalette)) : runPipeline(f, paletteSteps(ad, DEFAULT_POST));
      out = removeOrphans(hardenAlpha(out));
      return out;
    };
    const durations = (n: number) => Array.from({ length: n }, () => Math.round(1000 / spec.fps));

    if (spec.method === 'video') {
      const model = await pickModel(spec.modelId, [ad.models.animate], 'animate');
      // Give the character room to move, then upscale for the video model.
      const padW = Math.round(img.width * 1.5 / 2) * 2, padH = Math.round(img.height * 1.5 / 2) * 2;
      const padded = resizeCanvas(img, padW, padH, 'center');
      const ref = await pngInput(referenceFrom(padded, 768));
      const wanFrames = Math.max(17, Math.min(81, Math.round((spec.frames / spec.fps) * 16)));
      const numFrames = wanFrames - ((wanFrames - 1) % 4);
      const finalPrompt = `${spec.action}. The pixel art character from the image performs this action in place, centered in frame, static camera, no camera movement, no zoom, no background change, flat solid ${KEY_BG.name} background, same character design and colors, crisp pixel art, smooth seamless loop`;
      const req: TaskRequest = { task: 'animate', prompt: finalPrompt, image: ref, numFrames, fps: 16, resolution: spec.resolution ?? '480p', negativePrompt: 'camera motion, zoom, blurry, background scenery, text, watermark' };
      const calls = [{ model, req }];
      return {
        task: 'animate', projectId: base.project_id, kind: 'animation', model, prompt: spec.action, finalPrompt, warnings, calls,
        estimate: await sumEstimates(userId, calls),
        async execute(ctx) {
          const res = await ctx.call(model, req);
          if (!res.video?.url) throw new Error('The video model returned no video');
          ctx.progress('Downloading video & extracting frames…');
          const video = await fetchBinary(res.video.url, { signal: ctx.signal });
          const raw = await extractFrames(video, spec.frames, { sampleFps: 16, signal: ctx.signal, skipStart: 1 });
          ctx.progress('Pixelizing frames…');
          let frames = raw.map((f) => paletteFix(pixelize(removeBackgroundFlood(f, { tolerance: 18 }), { width: padW, height: padH })));
          // Crop every frame to the union of their content so the loop stays aligned.
          let x0 = padW, y0 = padH, x1 = 0, y1 = 0;
          for (const f of frames) { const b = contentBounds(f); if (b) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); } }
          if (x1 > x0 && y1 > y0) frames = frames.map((f) => crop(f, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
          const sheet = packSheet(frames, { columns: Math.min(frames.length, 8), durations: durations(frames.length) });
          const asset = await createAsset({
            userId, projectId: base.project_id, kind: 'animation', name: `${base.name} · ${spec.action}`.slice(0, 120), image: sheet.image, parentId: base.id, generationId: ctx.genId,
            frames: sheet.frames, meta: { fps: spec.fps, action: spec.action, method: 'video', modelId: model.id, palette: sourcePalette }, tags: ['animation'],
          });
          return { assets: [asset], extra: { videoUrl: res.video.url } };
        },
      };
    }

    // Sprite-sheet method: an edit model draws all frames at once from the reference.
    const model = await pickModel(spec.modelId, [ad.models.edit], 'edit');
    const n = Math.min(spec.frames, 8);
    const cols = Math.min(n, 4), rows = Math.ceil(n / 4);
    const ref = await pngInput(referenceFrom(img));
    const finalPrompt = `Pixel art sprite sheet: ${n} animation frames of the exact character from the reference image performing "${spec.action}", arranged in a grid of ${cols} columns and ${rows} row(s), every frame the same size and evenly spaced with empty space between frames, identical character design and colors, consistent pixel size, plain flat solid ${KEY_BG.name} (${KEY_BG.hex}) background, no text, no grid lines, no frame borders`;
    const req: TaskRequest = { task: 'edit', prompt: finalPrompt, images: [ref], width: 512 * cols, height: 512 * rows, numImages: 1 };
    const calls = [{ model, req }];
    return {
      task: 'animate', projectId: base.project_id, kind: 'animation', model, prompt: spec.action, finalPrompt, warnings, calls,
      estimate: await sumEstimates(userId, calls),
      async execute(ctx) {
        const [out] = await resultImages(await ctx.call(model, req), ctx.signal);
        ctx.progress('Slicing frames…');
        const cut = removeBackgroundFlood(out.img, { tolerance: 16, global: true });
        let parts = autoSlice(cut, { mergeDistance: 10, minArea: 64 }).images;
        if (parts.length < 2) parts = sliceGrid(cut, { columns: cols, rows, skipEmpty: true }).images;
        parts = parts.slice(0, n);
        const srcBounds = contentBounds(img) ?? { x: 0, y: 0, w: img.width, h: img.height };
        const heights = parts.map((p) => (contentBounds(p, 127)?.h ?? p.height)).sort((a, b) => a - b);
        const s = Math.max(1, heights[Math.floor(heights.length / 2)] / srcBounds.h);
        const frames = alignFrames(parts.map((p) => {
          const b = contentBounds(p, 127) ?? { x: 0, y: 0, w: p.width, h: p.height };
          return paletteFix(pixelize(crop(p, b), { width: Math.max(1, Math.round(b.w / s)), height: Math.max(1, Math.round(b.h / s)) }));
        }), { mode: 'bottom', padding: 1 });
        const sheet = packSheet(frames, { columns: Math.min(frames.length, 8), durations: durations(frames.length) });
        const asset = await createAsset({
          userId, projectId: base.project_id, kind: 'animation', name: `${base.name} · ${spec.action}`.slice(0, 120), image: sheet.image, source: out.raw, parentId: base.id, generationId: ctx.genId,
          frames: sheet.frames, meta: { fps: spec.fps, action: spec.action, method: 'sheet', modelId: model.id, palette: sourcePalette }, tags: ['animation'],
        });
        return { assets: [asset] };
      },
    };
  }

  if (spec.task === 'removeBg') {
    const base = getAssetRow(userId, spec.assetId);
    const ad = projectArtDirection(userId, base.project_id);
    const model = await pickModel(spec.modelId, [ad.models.removeBg], 'removeBg');
    const img = await loadAssetImage(base);
    const k = Math.max(1, Math.floor(1024 / Math.max(img.width, img.height)));
    const big = upscaleInteger({ ...img, data: new Uint8ClampedArray(img.data) }, k);
    for (let i = 3; i < big.data.length; i += 4) big.data[i] = 255; // model sees the full original pixels
    const req: TaskRequest = { task: 'removeBg', image: await pngInput(big) };
    const calls = [{ model, req }];
    return {
      task: 'removeBg', projectId: base.project_id, kind: base.kind, model, prompt: 'remove background', finalPrompt: '', warnings, calls,
      estimate: await sumEstimates(userId, calls),
      async execute(ctx) {
        const [out] = await resultImages(await ctx.call(model, req), ctx.signal);
        const mask = resizeNearest(out.img, img.width, img.height);
        const opaque = { ...img, data: new Uint8ClampedArray(img.data) };
        for (let i = 3; i < opaque.data.length; i += 4) opaque.data[i] = 255;
        const result = removeOrphans(applyMask(opaque, mask, 127));
        const asset = await createAsset({
          userId, projectId: base.project_id, kind: base.kind, name: `${base.name} · cutout`, image: result, parentId: base.id, generationId: ctx.genId,
          meta: { modelId: model.id, palette: imagePalette(result) }, tags: ['cutout'],
        });
        return { assets: [asset] };
      },
    };
  }

  // train
  const model = await pickModel(spec.modelId, [], 'train');
  const ds = getDb().get<{ id: string; name: string; default_caption: string; project_id: string | null }>('SELECT * FROM datasets WHERE id = ? AND user_id = ?', spec.datasetId, userId);
  if (!ds) throw badRequest('Dataset not found');
  const images = getDb().all<{ file: string; caption: string; rights_confirmed: number }>('SELECT * FROM dataset_images WHERE dataset_id = ? ORDER BY created_at', ds.id);
  if (images.length < 4) throw badRequest('A dataset needs at least 4 images (10+ recommended)');
  if (images.some((i) => !i.rights_confirmed)) throw badRequest('Every dataset image must be confirmed as authorized for training');
  const defaultCaption = ds.default_caption || (spec.triggerWord ? `${spec.triggerWord} pixel art` : 'pixel art');
  const req: TaskRequest = { task: 'train', zip: Buffer.alloc(0), steps: spec.steps, learningRate: spec.learningRate, defaultCaption, triggerWord: spec.triggerWord, trainingType: spec.trainingType, isStyle: true };
  const calls = [{ model, req }];
  return {
    task: 'train', projectId: spec.projectId ?? ds.project_id, kind: null, model, prompt: `Train LoRA "${spec.name}"`, finalPrompt: defaultCaption, warnings, calls,
    estimate: await sumEstimates(userId, calls),
    async execute(ctx) {
      ctx.progress(`Packaging ${images.length} images…`);
      const files: Record<string, Uint8Array> = {};
      for (const [i, im] of images.entries()) {
        const name = `img_${String(i + 1).padStart(3, '0')}`;
        // Upscale tiny pixel art so trainers see crisp pixels (nearest neighbour).
        const decoded = await decodeImage(await readStored(im.file));
        const k = Math.max(1, Math.floor(1024 / Math.max(decoded.width, decoded.height)));
        files[`${name}.png`] = new Uint8Array(await encodePng(flattenOnColor(upscaleInteger(decoded, k), [255, 255, 255])));
        const caption = im.caption || defaultCaption;
        files[`${name}.txt`] = new TextEncoder().encode(spec.triggerWord && !caption.includes(spec.triggerWord) ? `${spec.triggerWord}, ${caption}` : caption);
      }
      const zip = Buffer.from(zipSync(files, { level: 6 }));
      const res = await ctx.call(model, { ...req, zip } as TaskRequest);
      if (!res.lora?.url) throw new Error('Training finished without a LoRA file');
      const id = newId('lora_');
      getDb().run(
        'INSERT INTO loras (id,user_id,project_id,name,family,path,trigger_word,default_scale,source,training_generation_id,description,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        id, userId, spec.projectId ?? ds.project_id, spec.name, model.loraFamily ?? 'z-image', res.lora.url, spec.triggerWord ?? null, 1, 'trained', ctx.genId,
        `Trained on dataset "${ds.name}" (${images.length} images, ${spec.steps} steps)`, Date.now(),
      );
      return { assets: [], extra: { loraId: id, loraUrl: res.lora.url } };
    },
  };
}

// ───────────────────────────── Lifecycle ─────────────────────────────

export interface GenerationRow {
  id: string; user_id: string; project_id: string | null; batch_id: string | null; task: string; kind: string | null; model_id: string; provider: string; endpoint: string | null;
  prompt: string; final_prompt: string | null; params_json: string; status: string; progress: string | null; provider_request_id: string | null;
  provider_status_url: string | null; provider_response_url: string | null; estimated_cost: number | null; actual_cost: number | null; cost_source: string | null;
  error: string | null; output_asset_ids: string; result_json: string | null; created_at: number; started_at: number | null; finished_at: number | null;
}

export function generationDto(r: GenerationRow) {
  const result = parseJson<Record<string, unknown>>(r.result_json, {});
  return {
    id: r.id,
    projectId: r.project_id,
    task: r.task,
    kind: r.kind,
    modelId: r.model_id,
    provider: r.provider,
    endpoint: r.endpoint,
    prompt: r.prompt,
    finalPrompt: r.final_prompt,
    params: parseJson<Record<string, unknown>>(r.params_json, {}),
    status: r.status as 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled',
    progress: r.progress,
    estimatedCost: r.estimated_cost,
    actualCost: r.actual_cost,
    costSource: r.cost_source,
    error: r.error,
    warnings: (result.warnings as string[] | undefined) ?? [],
    extra: result.extra ?? null,
    outputAssetIds: parseJson<string[]>(r.output_asset_ids, []),
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export function getGeneration(userId: string, id: string) {
  const r = getDb().get<GenerationRow>('SELECT * FROM generations WHERE id = ? AND user_id = ?', id, userId);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'Generation not found');
  return generationDto(r);
}

export async function estimateJob(userId: string, spec: JobSpec) {
  const plan = await planJob(userId, spec);
  return {
    task: plan.task,
    model: { id: plan.model.id, name: plan.model.name, provider: plan.model.provider },
    calls: plan.calls.length,
    estimate: plan.estimate,
    finalPrompt: plan.finalPrompt,
    warnings: plan.warnings,
  };
}

/** Validate, budget-check, persist and start a job. Returns immediately (poll the generation). */
export async function createJob(userId: string, spec: JobSpec) {
  const plan = await planJob(userId, spec);
  for (const c of plan.calls) getSecret(userId, c.model.provider); // fail fast if a key is missing
  assertWithinBudget(userId, plan.estimate.usd);
  const id = newId('gen_');
  const db = getDb();
  db.run(
    `INSERT INTO generations (id,user_id,project_id,task,kind,model_id,provider,endpoint,prompt,final_prompt,params_json,status,estimated_cost,cost_source,result_json,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, userId, plan.projectId, plan.task, plan.kind, plan.model.id, plan.model.provider, plan.model.endpoint, plan.prompt, plan.finalPrompt,
    JSON.stringify(spec), 'queued', plan.estimate.usd, plan.estimate.source, JSON.stringify({ warnings: plan.warnings }), Date.now(),
  );
  void execute(id, userId, plan);
  return getGeneration(userId, id);
}

async function execute(id: string, userId: string, plan: Plan, resume?: { requestId: string; statusUrl: string | null; responseUrl: string | null; endpoint: string }) {
  const db = getDb();
  const ac = new AbortController();
  running.set(id, ac);
  const timeout = setTimeout(() => ac.abort(), config.jobTimeoutMs);
  let reported = 0, reportedAny = false, callIndex = 0;
  db.run(`UPDATE generations SET status='running', started_at=COALESCE(started_at, ?) WHERE id=?`, Date.now(), id);
  const ctx: Ctx = {
    genId: id,
    userId,
    signal: ac.signal,
    progress: (msg) => { db.run('UPDATE generations SET progress=? WHERE id=?', msg, id); },
    async call(model, req) {
      const adapter = getProvider(model.provider);
      const apiKey = getSecret(userId, model.provider);
      const idx = callIndex++;
      const rctx = {
        apiKey,
        signal: ac.signal,
        onProgress: ctx.progress,
        onSubmitted: (h: { requestId: string; statusUrl?: string; responseUrl?: string; endpoint: string }) => {
          db.run('UPDATE generations SET provider_request_id=?, provider_status_url=?, provider_response_url=?, endpoint=? WHERE id=?', `${idx}:${h.requestId}`, h.statusUrl ?? null, h.responseUrl ?? null, h.endpoint, id);
        },
      };
      const res = idx === 0 && resume && adapter.resume ? await adapter.resume(model, resume, req, rctx) : await adapter.run(model, req, rctx);
      if (typeof res.cost === 'number') { reported += res.cost; reportedAny = true; }
      return res;
    },
  };
  try {
    const out = await plan.execute(ctx);
    const actual = reportedAny ? reported : plan.estimate.usd;
    const prev = parseJson<Record<string, unknown>>(db.get<{ result_json: string }>('SELECT result_json FROM generations WHERE id=?', id)?.result_json, {});
    db.run(
      `UPDATE generations SET status='succeeded', progress=NULL, actual_cost=?, cost_source=?, output_asset_ids=?, result_json=?, finished_at=? WHERE id=?`,
      actual, reportedAny ? 'provider' : `estimate:${plan.estimate.source}`, JSON.stringify(out.assets.map((a) => a.id)),
      JSON.stringify({ ...prev, extra: out.extra ?? null }), Date.now(), id,
    );
  } catch (e) {
    const canceled = ac.signal.aborted && db.get<{ status: string }>('SELECT status FROM generations WHERE id=?', id)?.status === 'canceled';
    const msg = (e as Error).message ?? String(e);
    // Charged calls before failure still count; otherwise nothing is charged (provider failures are not billed).
    db.run(
      `UPDATE generations SET status=?, progress=NULL, error=?, actual_cost=?, cost_source=?, finished_at=? WHERE id=?`,
      canceled ? 'canceled' : 'failed', canceled ? 'Canceled by user' : ac.signal.aborted ? 'Timed out' : msg, reportedAny ? reported : 0, reportedAny ? 'provider' : 'none', Date.now(), id,
    );
  } finally {
    clearTimeout(timeout);
    running.delete(id);
  }
}

export async function cancelJob(userId: string, id: string) {
  const g = getGeneration(userId, id);
  if (g.status !== 'queued' && g.status !== 'running') return g;
  getDb().run(`UPDATE generations SET status='canceled' WHERE id=?`, id);
  const row = getDb().get<GenerationRow>('SELECT * FROM generations WHERE id = ?', id)!;
  if (row.provider === 'fal' && row.provider_request_id && row.endpoint) {
    const { falCancel } = await import('../providers/fal.js');
    await falCancel(getSecret(userId, 'fal'), { requestId: row.provider_request_id.split(':').slice(1).join(':'), endpoint: row.endpoint });
  }
  running.get(id)?.abort();
  return getGeneration(userId, id);
}

/** On boot: resume single-call fal jobs, mark everything else as interrupted. */
export async function recoverJobs(log: (m: string) => void) {
  const db = getDb();
  const rows = db.all<GenerationRow>(`SELECT * FROM generations WHERE status IN ('queued','running')`);
  for (const r of rows) {
    const [idx, ...rest] = (r.provider_request_id ?? '').split(':');
    const resumable = r.provider === 'fal' && idx === '0' && rest.length && r.endpoint;
    if (!resumable) {
      db.run(`UPDATE generations SET status='failed', error='Interrupted by a server restart', finished_at=? WHERE id=?`, Date.now(), r.id);
      continue;
    }
    try {
      const spec = jobSpecSchema.parse(JSON.parse(r.params_json));
      const plan = await planJob(r.user_id, spec);
      if (plan.calls.length !== 1) throw new Error('multi-call job');
      log(`Resuming generation ${r.id}`);
      void execute(r.id, r.user_id, plan, { requestId: rest.join(':'), statusUrl: r.provider_status_url, responseUrl: r.provider_response_url, endpoint: r.endpoint! });
    } catch (e) {
      db.run(`UPDATE generations SET status='failed', error=?, finished_at=? WHERE id=?`, `Interrupted by a server restart (${(e as Error).message})`, Date.now(), r.id);
    }
  }
}

export function listGenerations(userId: string, f: { projectId?: string; status?: string; task?: string; limit?: number; offset?: number }) {
  const where = ['user_id = ?'];
  const params: (string | number)[] = [userId];
  if (f.projectId) { where.push('project_id = ?'); params.push(f.projectId); }
  if (f.status === 'active') where.push(`status IN ('queued','running')`);
  else if (f.status) { where.push('status = ?'); params.push(f.status); }
  if (f.task) { where.push('task = ?'); params.push(f.task); }
  const db = getDb();
  const total = db.get<{ n: number }>(`SELECT COUNT(*) n FROM generations WHERE ${where.join(' AND ')}`, ...params)?.n ?? 0;
  const items = db.all<GenerationRow>(`SELECT * FROM generations WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, Math.min(200, f.limit ?? 50), f.offset ?? 0);
  return { total, items: items.map(generationDto) };
}

export type { Frame };
