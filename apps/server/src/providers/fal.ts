import type { ProviderAdapter, ModelDef, TaskRequest, TaskResult, RunContext, CostEstimate, ImageInput, ResumeHandle } from './types.js';
import { megapixels } from './types.js';
import { FAL_MODELS } from './catalog.js';
import { ProviderError } from '../lib/errors.js';

const QUEUE = 'https://queue.fal.run';
const PLATFORM = 'https://api.fal.ai/v1';
const STORAGE = 'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3';

const auth = (key: string) => ({ Authorization: `Key ${key}` });

async function falJson<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) {
    const b = body as { error?: { message?: string } | string; detail?: unknown; message?: string };
    const msg = typeof b === 'object' && b
      ? (typeof b.error === 'object' ? b.error?.message : b.error) ?? b.message ?? (b.detail ? JSON.stringify(b.detail) : undefined)
      : undefined;
    throw new ProviderError('fal', `${what} failed (${res.status}): ${msg ?? String(text).slice(0, 300)}`, res.status, body);
  }
  return body as T;
}

/** Upload bytes to fal storage; falls back to a data URI if the upload API is unavailable. */
export async function falUpload(key: string, img: ImageInput | { data: Buffer; mime: string }, fileName = 'input'): Promise<string> {
  try {
    const init = await fetch(STORAGE, {
      method: 'POST',
      headers: { ...auth(key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: img.mime, file_name: `${fileName}.${img.mime.split('/')[1] ?? 'bin'}` }),
    });
    const { upload_url, file_url } = await falJson<{ upload_url: string; file_url: string }>(init, 'Storage initiate');
    const put = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': img.mime }, body: new Uint8Array(img.data) });
    if (!put.ok) throw new Error(`upload PUT ${put.status}`);
    return file_url;
  } catch (e) {
    if (img.mime === 'application/zip') throw e; // trainers need a real URL
    return `data:${img.mime};base64,${img.data.toString('base64')}`;
  }
}

/** Live unit prices (cached 6h per endpoint). */
const priceCache = new Map<string, { at: number; unitPrice: number; unit: string }>();
async function livePrice(endpoint: string, key?: string): Promise<{ unitPrice: number; unit: string } | null> {
  const hit = priceCache.get(endpoint);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit;
  if (!key) return null;
  try {
    const res = await fetch(`${PLATFORM}/models/pricing?endpoint_id=${encodeURIComponent(endpoint)}`, { headers: auth(key), signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { prices?: { endpoint_id: string; unit_price: number; unit: string }[] };
    const p = body.prices?.find((x) => x.endpoint_id === endpoint);
    if (!p || typeof p.unit_price !== 'number') return null;
    const v = { at: Date.now(), unitPrice: p.unit_price, unit: String(p.unit ?? '') };
    priceCache.set(endpoint, v);
    return v;
  } catch {
    return null;
  }
}

/** Pick the concrete fal endpoint for a request (LoRA / edit variants live on separate endpoints). */
export function resolveEndpoint(model: ModelDef, req: TaskRequest): string {
  const hasLoras = 'loras' in req && !!req.loras?.length;
  if (req.task === 'edit') {
    if (!model.editEndpoint) throw new ProviderError('fal', `${model.name} does not support editing`);
    return hasLoras && model.editLoraEndpoint ? model.editLoraEndpoint : model.editEndpoint;
  }
  return hasLoras && model.loraEndpoint ? model.loraEndpoint : model.endpoint;
}

function imageSize(w?: number, h?: number) {
  if (!w || !h) return undefined;
  return { width: Math.round(w / 16) * 16 || 16, height: Math.round(h / 16) * 16 || 16 };
}

async function buildInput(model: ModelDef, req: TaskRequest, key: string): Promise<Record<string, unknown>> {
  switch (req.task) {
    case 'txt2img':
      return {
        prompt: req.prompt,
        image_size: imageSize(req.width, req.height),
        num_images: req.numImages,
        seed: req.seed,
        output_format: 'png',
        enable_safety_checker: true,
        ...(req.loras?.length ? { loras: req.loras.map((l) => ({ path: l.path, scale: l.scale })) } : {}),
      };
    case 'edit': {
      const urls = await Promise.all(req.images.slice(0, model.maxRefs ?? 4).map((im, i) => falUpload(key, im, `ref${i}`)));
      return {
        prompt: req.prompt,
        image_urls: urls,
        ...(req.width && req.height ? { image_size: imageSize(req.width, req.height) } : {}),
        num_images: req.numImages,
        seed: req.seed,
        output_format: 'png',
        enable_safety_checker: true,
        ...(req.loras?.length ? { loras: req.loras.map((l) => ({ path: l.path, scale: l.scale })) } : {}),
      };
    }
    case 'img2img':
      return {
        prompt: req.prompt,
        image_url: await falUpload(key, req.image, 'source'),
        strength: req.strength,
        ...(req.width && req.height ? { image_size: imageSize(req.width, req.height) } : {}),
        num_images: req.numImages,
        seed: req.seed,
        output_format: 'png',
        enable_safety_checker: true,
        ...(req.loras?.length ? { loras: req.loras.map((l) => ({ path: l.path, scale: l.scale })) } : {}),
      };
    case 'animate': {
      const image_url = await falUpload(key, req.image, 'frame');
      if (model.endpoint.startsWith('wan/v2.6')) {
        return { prompt: req.prompt, image_url, resolution: req.resolution === '1080p' ? '1080p' : '720p', duration: '5', negative_prompt: req.negativePrompt, enable_prompt_expansion: false, seed: req.seed };
      }
      return {
        prompt: req.prompt,
        image_url,
        num_frames: Math.max(17, Math.min(161, req.numFrames)),
        frames_per_second: Math.max(4, Math.min(60, req.fps)),
        resolution: ['480p', '580p', '720p'].includes(req.resolution) ? req.resolution : '480p',
        aspect_ratio: 'auto',
        negative_prompt: req.negativePrompt,
        seed: req.seed,
        enable_safety_checker: false,
      };
    }
    case 'removeBg':
      return { image_url: await falUpload(key, req.image, 'cutout'), model: 'General Use (Light)', operating_resolution: '1024x1024', output_format: 'png', refine_foreground: true };
    case 'train': {
      const zipUrl = await falUpload(key, { data: req.zip, mime: 'application/zip' }, 'dataset');
      if (model.endpoint === 'fal-ai/flux-lora-fast-training') {
        return { images_data_url: zipUrl, trigger_word: req.triggerWord, is_style: req.isStyle ?? true, steps: req.steps, create_masks: !req.isStyle };
      }
      if (model.endpoint === 'fal-ai/z-image-trainer') {
        return { image_data_url: zipUrl, default_caption: req.defaultCaption, steps: Math.max(100, Math.round(req.steps / 100) * 100), learning_rate: req.learningRate ?? 1e-4, training_type: req.trainingType ?? 'style' };
      }
      return { image_data_url: zipUrl, default_caption: req.defaultCaption, steps: req.steps, learning_rate: req.learningRate ?? 5e-5, output_lora_format: 'fal' };
    }
  }
}

function parseOutput(body: Record<string, unknown>): TaskResult {
  const images: TaskResult['images'] = [];
  const pushImg = (v: unknown) => {
    if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') images.push({ url: (v as { url: string }).url });
  };
  if (Array.isArray(body.images)) body.images.forEach(pushImg);
  if (body.image) pushImg(body.image);
  const video = body.video && typeof body.video === 'object' ? { url: String((body.video as { url: string }).url) } : undefined;
  const lf = body.diffusers_lora_file as { url?: string } | undefined;
  const cf = body.config_file as { url?: string } | undefined;
  return {
    images,
    video,
    lora: lf?.url ? { url: lf.url, configUrl: cf?.url } : undefined,
    seed: typeof body.seed === 'number' ? body.seed : undefined,
    raw: body,
  };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Cancelled')); }, { once: true });
  });

function appBase(endpoint: string): string {
  // Status/result URLs only use owner/app (subpaths return 405).
  const parts = endpoint.split('/');
  return parts.slice(0, 2).join('/');
}

async function waitForResult(handle: ResumeHandle, ctx: RunContext, pollMs: number): Promise<TaskResult> {
  const base = `${QUEUE}/${appBase(handle.endpoint)}/requests/${handle.requestId}`;
  const statusUrl = handle.statusUrl ?? `${base}/status`;
  const responseUrl = handle.responseUrl ?? base;
  let lastPos: unknown;
  for (;;) {
    await sleep(pollMs, ctx.signal);
    const res = await fetch(`${statusUrl}${statusUrl.includes('?') ? '&' : '?'}logs=0`, { headers: auth(ctx.apiKey), signal: ctx.signal });
    const st = await falJson<{ status: string; queue_position?: number; error?: string }>(res, 'Status');
    if (st.status === 'IN_QUEUE') {
      if (st.queue_position !== lastPos) ctx.onProgress(`In queue (position ${st.queue_position ?? '?'})`);
      lastPos = st.queue_position;
      continue;
    }
    if (st.status === 'IN_PROGRESS') { ctx.onProgress('Generating…'); continue; }
    if (st.status === 'COMPLETED') {
      if (st.error) throw new ProviderError('fal', st.error);
      const out = await fetch(responseUrl, { headers: auth(ctx.apiKey), signal: ctx.signal });
      return parseOutput(await falJson<Record<string, unknown>>(out, 'Result'));
    }
    throw new ProviderError('fal', `Unexpected status ${st.status}`);
  }
}

export function falAdapter(pollMs = 1500): ProviderAdapter {
  return {
    id: 'fal',
    name: 'fal.ai',
    website: 'https://fal.ai',
    keyHelpUrl: 'https://fal.ai/dashboard/keys',

    async validateKey(key) {
      // Any authenticated Platform API call: invalid keys get 401/403.
      const res = await fetch(`${PLATFORM}/models/pricing?endpoint_id=fal-ai/z-image/turbo`, { headers: auth(key), signal: AbortSignal.timeout(10_000) });
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'fal.ai rejected this key (401/403).' };
      if (!res.ok) return { ok: false, message: `fal.ai returned HTTP ${res.status}` };
      const info: Record<string, unknown> = {};
      try {
        const bill = await fetch(`${PLATFORM}/account/billing?expand=credits`, { headers: auth(key), signal: AbortSignal.timeout(8000) });
        if (bill.ok) {
          const b = (await bill.json()) as { username?: string; credits?: { current_balance?: number; currency?: string } };
          info.username = b.username;
          info.balance = b.credits?.current_balance;
          info.currency = b.credits?.currency;
        }
      } catch { /* billing scope is optional */ }
      return { ok: true, message: 'Key accepted by fal.ai', info };
    },

    async listModels() {
      return FAL_MODELS;
    },

    async getBalance(key) {
      try {
        const res = await fetch(`${PLATFORM}/account/billing?expand=credits`, { headers: auth(key), signal: AbortSignal.timeout(8000) });
        if (res.status === 401 || res.status === 403) {
          return { ok: false, reason: 'forbidden', message: 'fal.ai only shows the balance to ADMIN-scope keys. Add a read-only billing key (an ADMIN key) in Settings.' };
        }
        if (!res.ok) return { ok: false, reason: 'unavailable', message: `fal.ai billing API returned HTTP ${res.status}` };
        const b = (await res.json()) as { credits?: { current_balance?: number; currency?: string } };
        const v = b.credits?.current_balance;
        if (typeof v !== 'number') return { ok: false, reason: 'unavailable', message: 'fal.ai did not return a balance' };
        return { ok: true, usd: v, detail: b.credits?.currency && b.credits.currency !== 'USD' ? b.credits.currency : undefined };
      } catch (e) {
        return { ok: false, reason: 'unavailable', message: (e as Error).message };
      }
    },

    async estimate(model, req, key): Promise<CostEstimate> {
      const endpoint = resolveEndpoint(model, req);
      const live = await livePrice(endpoint, key);
      const p = model.pricing;
      const hasLoras = 'loras' in req && !!req.loras?.length;
      const unitUsd = (u: string) => (live && live.unit.toLowerCase().includes(u) ? live.unitPrice : null);
      switch (req.task) {
        case 'txt2img':
        case 'img2img':
        case 'edit': {
          const w = ('width' in req && req.width) || 1024;
          const h = ('height' in req && req.height) || 1024;
          let mp = megapixels(w, h) * req.numImages;
          if (req.task === 'edit' && p.countsInputMegapixels) mp += req.images.length * 1;
          const liveMp = unitUsd('megapixel') ?? unitUsd('mp');
          const liveImg = unitUsd('image');
          if (liveMp !== null) return { usd: liveMp * mp, source: 'live', breakdown: `${mp.toFixed(2)} MP × $${liveMp}/MP (${endpoint})` };
          if (liveImg !== null) return { usd: liveImg * req.numImages, source: 'live', breakdown: `${req.numImages} image(s) × $${liveImg} (${endpoint})` };
          const price = hasLoras ? p.loraUsd ?? p.usd : p.usd;
          return { usd: price * mp, source: 'catalog', breakdown: `${mp.toFixed(2)} MP × $${price}/MP (list price)` };
        }
        case 'animate': {
          const rate = p.perResolution?.[req.resolution] ?? p.usd;
          const seconds = model.endpoint.startsWith('wan/v2.6') ? 5 : req.numFrames / (p.billingFps ?? req.fps);
          return { usd: rate * seconds, source: 'catalog', breakdown: `${seconds.toFixed(2)} s × $${rate}/s @ ${req.resolution}` };
        }
        case 'removeBg': {
          if (live && live.unitPrice >= 0) return { usd: live.unitPrice, source: 'live', breakdown: `1 × $${live.unitPrice} per ${live.unit}` };
          return { usd: p.usd, source: 'catalog', breakdown: `≈ $${p.usd} per image (approximate)` };
        }
        case 'train': {
          const steps = model.endpoint === 'fal-ai/z-image-trainer' ? Math.max(100, Math.round(req.steps / 100) * 100) : req.steps;
          return { usd: p.usd * steps, source: 'catalog', breakdown: `${steps} steps × $${p.usd}/step (${p.note ?? ''})` };
        }
      }
    },

    async run(model, req, ctx) {
      const endpoint = resolveEndpoint(model, req);
      ctx.onProgress('Uploading inputs…');
      const input = await buildInput(model, req, ctx.apiKey);
      ctx.onProgress('Submitting to fal.ai…');
      const res = await fetch(`${QUEUE}/${endpoint}`, {
        method: 'POST',
        headers: { ...auth(ctx.apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: ctx.signal,
      });
      const sub = await falJson<{ request_id: string; status_url?: string; response_url?: string }>(res, 'Submit');
      const handle = { requestId: sub.request_id, statusUrl: sub.status_url, responseUrl: sub.response_url, endpoint };
      ctx.onSubmitted(handle);
      return waitForResult(handle, ctx, pollMs);
    },

    async resume(_model, handle, _req, ctx) {
      return waitForResult(handle, ctx, pollMs);
    },
  };
}

export async function falCancel(key: string, handle: ResumeHandle): Promise<void> {
  const url = `${QUEUE}/${appBase(handle.endpoint)}/requests/${handle.requestId}/cancel`;
  await fetch(url, { method: 'PUT', headers: auth(key) }).catch(() => undefined);
}
