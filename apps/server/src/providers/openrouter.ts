import type { ProviderAdapter, ModelDef, CostEstimate, TaskResult, ImageInput } from './types.js';
import { ProviderError } from '../lib/errors.js';

const API = 'https://openrouter.ai/api/v1';
const HEADERS = { 'HTTP-Referer': 'https://github.com/PetitOursManu/Sprixy', 'X-Title': 'Sprixy' };

interface OrModel {
  id: string;
  name: string;
  description?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: Record<string, string>;
}

let modelCache: { at: number; models: ModelDef[] } | null = null;

/** Typical output tokens for one generated image (Gemini-class models ≈ 1290). */
const TOKENS_PER_IMAGE = 1290;

function toModelDef(m: OrModel): ModelDef | null {
  const out = m.architecture?.output_modalities ?? [];
  if (!out.includes('image')) return null;
  if (m.id.startsWith('openrouter/')) return null;
  const pr = m.pricing ?? {};
  if (Object.values(pr).some((v) => Number(v) < 0)) return null;
  const perImage = Number(pr.image_output ?? pr.completion ?? 0);
  const caps: ModelDef['capabilities'] = ['txt2img'];
  if (m.architecture?.input_modalities?.includes('image')) caps.push('edit');
  return {
    id: `openrouter:${m.id}`,
    provider: 'openrouter',
    name: m.name,
    description: (m.description ?? '').slice(0, 280),
    capabilities: caps,
    endpoint: m.id,
    maxRefs: caps.includes('edit') ? 4 : 0,
    pricing: { unit: 'token', usd: perImage, note: perImage ? `≈ ${TOKENS_PER_IMAGE} output tokens per image; real cost recorded after run` : 'Cost reported after run' },
    quality: 4,
    speed: 3,
    tags: ['dynamic', ...(caps.includes('edit') ? ['edit', 'references'] : [])],
    dynamic: true,
  };
}

async function orJson<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* text */ }
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } })?.error?.message ?? String(text).slice(0, 300);
    throw new ProviderError('openrouter', `${what} failed (${res.status}): ${msg}`, res.status, body);
  }
  return body as T;
}

const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
function aspectRatio(w?: number, h?: number): string {
  if (!w || !h) return '1:1';
  const r = w / h;
  let best = '1:1', bd = Infinity;
  for (const s of RATIOS) {
    const [a, b] = s.split(':').map(Number);
    const d = Math.abs(Math.log(a / b) - Math.log(r));
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

const dataUrl = (im: ImageInput) => `data:${im.mime};base64,${im.data.toString('base64')}`;

function decodeImageUrl(url: string): { url?: string; data?: Buffer } {
  if (url.startsWith('data:')) return { data: Buffer.from(url.slice(url.indexOf(',') + 1), 'base64') };
  return { url };
}

export function openRouterAdapter(): ProviderAdapter {
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    website: 'https://openrouter.ai',
    keyHelpUrl: 'https://openrouter.ai/settings/keys',

    async validateKey(key) {
      const res = await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'OpenRouter rejected this key.' };
      if (!res.ok) return { ok: false, message: `OpenRouter returned HTTP ${res.status}` };
      const body = (await res.json()) as { data?: { label?: string; limit?: number | null; limit_remaining?: number | null; usage?: number; is_free_tier?: boolean } };
      return { ok: true, message: 'Key accepted by OpenRouter', info: { label: body.data?.label, limit: body.data?.limit, remaining: body.data?.limit_remaining, usage: body.data?.usage, freeTier: body.data?.is_free_tier } };
    },

    async getBalance(key) {
      const headers = { Authorization: `Bearer ${key}` };
      try {
        // Account credits (total purchased − total used).
        const res = await fetch(`${API}/credits`, { headers, signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const b = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } };
          if (typeof b.data?.total_credits === 'number' && typeof b.data.total_usage === 'number') {
            return { ok: true, usd: Math.max(0, b.data.total_credits - b.data.total_usage) };
          }
        }
        // Fallback: the key's own spending limit, when one is set.
        const k = await fetch(`${API}/key`, { headers, signal: AbortSignal.timeout(8000) });
        if (k.status === 401 || k.status === 403) return { ok: false, reason: 'forbidden', message: 'OpenRouter rejected this key.' };
        if (k.ok) {
          const d = (await k.json()) as { data?: { limit_remaining?: number | null } };
          if (typeof d.data?.limit_remaining === 'number') return { ok: true, usd: d.data.limit_remaining, detail: 'key limit' };
        }
        return { ok: false, reason: 'unavailable', message: 'OpenRouter did not return a balance for this key' };
      } catch (e) {
        return { ok: false, reason: 'unavailable', message: (e as Error).message };
      }
    },

    async listModels() {
      if (modelCache && Date.now() - modelCache.at < 3600_000) return modelCache.models;
      try {
        const res = await fetch(`${API}/models?output_modalities=image`, { signal: AbortSignal.timeout(10_000) });
        const body = await orJson<{ data: OrModel[] }>(res, 'List models');
        const models = body.data.map(toModelDef).filter((m): m is ModelDef => !!m);
        modelCache = { at: Date.now(), models };
        return models;
      } catch {
        return modelCache?.models ?? [];
      }
    },

    async estimate(model, req): Promise<CostEstimate> {
      const n = 'numImages' in req ? req.numImages : 1;
      if (model.pricing.usd > 0) {
        const usd = model.pricing.usd * TOKENS_PER_IMAGE * n;
        return { usd, source: 'catalog', breakdown: `≈ ${n} × ${TOKENS_PER_IMAGE} tokens × $${model.pricing.usd}/token (approximate)` };
      }
      return { usd: null, source: 'unknown', breakdown: 'OpenRouter reports the exact cost after generation' };
    },

    async run(model, req, ctx): Promise<TaskResult> {
      if (req.task !== 'txt2img' && req.task !== 'edit') throw new ProviderError('openrouter', `Task ${req.task} is not supported by OpenRouter models`);
      const refs = req.task === 'edit' ? req.images.map(dataUrl) : [];
      const headers = { Authorization: `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json', ...HEADERS };
      ctx.onProgress('Generating with OpenRouter…');
      ctx.onSubmitted({ requestId: `or-${Date.now()}`, endpoint: model.endpoint });

      // 1) Dedicated Images API
      const imgRes = await fetch(`${API}/images`, {
        method: 'POST',
        headers,
        signal: ctx.signal,
        body: JSON.stringify({
          model: model.endpoint,
          prompt: req.prompt,
          n: req.numImages,
          aspect_ratio: aspectRatio(req.width, req.height),
          output_format: 'png',
          response_format: 'b64_json',
          ...(req.seed !== undefined ? { seed: req.seed } : {}),
          ...(refs.length ? { input_references: refs.map((url) => ({ type: 'image_url', image_url: { url } })) } : {}),
        }),
      });
      if (imgRes.ok) {
        const body = (await imgRes.json()) as { data?: { b64_json?: string; url?: string }[]; usage?: { cost?: number } };
        const images = (body.data ?? []).map((d) => (d.b64_json ? { data: Buffer.from(d.b64_json, 'base64') } : { url: d.url }));
        if (images.length) return { images, cost: body.usage?.cost, raw: { usage: body.usage } };
      } else if (![400, 404, 405, 422].includes(imgRes.status)) {
        await orJson(imgRes, 'Images API');
      }

      // 2) Fallback: chat completions with image modality
      const content: unknown[] = [{ type: 'text', text: req.prompt }];
      for (const url of refs) content.push({ type: 'image_url', image_url: { url } });
      const chat = await fetch(`${API}/chat/completions`, {
        method: 'POST',
        headers,
        signal: ctx.signal,
        body: JSON.stringify({
          model: model.endpoint,
          modalities: ['image', 'text'],
          messages: [{ role: 'user', content }],
          image_config: { aspect_ratio: aspectRatio(req.width, req.height) },
        }),
      });
      const body = await orJson<{ choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[]; usage?: { cost?: number } }>(chat, 'Chat image generation');
      const images = (body.choices ?? [])
        .flatMap((c) => c.message?.images ?? [])
        .map((im) => im.image_url?.url)
        .filter((u): u is string => !!u)
        .map(decodeImageUrl);
      if (!images.length) throw new ProviderError('openrouter', 'The model returned no image');
      return { images, cost: body.usage?.cost, raw: { usage: body.usage } };
    },
  };
}
