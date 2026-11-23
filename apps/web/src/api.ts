/** Thin fetch wrapper around the Sprixy REST API (session cookie auth). */

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined || isForm ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `HTTP ${res.status}`, e?.details);
  }
  return data as T;
}

export const get = <T,>(p: string) => api<T>('GET', p);
export const post = <T,>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const put = <T,>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {});
export const patch = <T,>(p: string, b?: unknown) => api<T>('PATCH', p, b ?? {});
export const del = <T,>(p: string) => api<T>('DELETE', p);

export function qs(q: Record<string, string | number | boolean | undefined | null>): string {
  const p = Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
}

/** Trigger a browser download of a GET or POST endpoint returning a file. */
export async function download(path: string, body?: unknown): Promise<void> {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try { msg = (await res.json()).error?.message ?? msg; } catch { /* binary */ }
    throw new ApiError(res.status, 'DOWNLOAD_FAILED', msg);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'sprixy-export';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Types (mirror the server DTOs) ──
export interface User { id: string; email: string; name: string; role: 'admin' | 'user' }

export interface Frame { name: string; rect: { x: number; y: number; w: number; h: number }; duration?: number }

export interface Asset {
  id: string;
  projectId: string;
  parentId: string | null;
  generationId: string | null;
  kind: string;
  name: string;
  width: number;
  height: number;
  frames: Frame[] | null;
  meta: { palette?: string[]; fps?: number; prompt?: string; modelId?: string; direction?: string; tileSize?: number; [k: string]: unknown };
  favorite: boolean;
  tags: string[];
  hasSource: boolean;
  hasEditorDoc: boolean;
  fileUrl: string;
  sourceUrl: string | null;
  createdAt: number;
  updatedAt: number;
  variantCount?: number;
}

export interface AssetDetail extends Asset { variants: Asset[]; parent: Asset | null }

export type Perspective = 'side' | 'top-down' | 'three-quarter' | 'isometric' | 'front';
export interface ArtDirection {
  palette: { presetId?: string; colors: string[]; enforce: boolean; maxColors: number };
  referenceAssetIds: string[];
  models: { image?: string; edit?: string; animate?: string; removeBg?: string };
  loras: { loraId: string; scale: number }[];
  spriteSize: { width: number; height: number };
  iconSize: { width: number; height: number };
  tileSize: number;
  sceneSize: { width: number; height: number };
  perspective: Perspective;
  lighting: 'flat' | 'top-left' | 'top-right' | 'top' | 'rim' | 'dramatic' | 'ambient';
  shading: 'flat' | 'cel' | 'soft' | 'dithered';
  detail: 'minimal' | 'low' | 'medium' | 'high';
  outline: 'none' | 'black' | 'dark-colored' | 'selective';
  dither: Dither;
  styleNotes: string;
  negativePrompt: string;
}
export type Dither = 'none' | 'floyd-steinberg' | 'atkinson' | 'bayer2' | 'bayer4' | 'bayer8';

export interface Project {
  id: string;
  name: string;
  description: string;
  artDirection: ArtDirection;
  effectivePalette: string[];
  coverUrl: string | null;
  archived: boolean;
  /** Visible to connected apps (Mocky…) through read-only catalog tokens. */
  catalogShared: boolean;
  assetCount?: number;
  createdAt: number;
  updatedAt: number;
}

export type Capability = 'txt2img' | 'img2img' | 'edit' | 'animate' | 'removeBg' | 'train';
export interface Model {
  id: string;
  provider: 'fal' | 'openrouter';
  name: string;
  description: string;
  capabilities: Capability[];
  endpoint: string;
  loraFamily?: string;
  maxLoras?: number;
  maxRefs?: number;
  pricing: { unit: string; usd: number; loraUsd?: number; note?: string; perResolution?: Record<string, number> };
  quality: number;
  speed: number;
  tags: string[];
  size?: string;
  singleImage?: boolean;
  dynamic?: boolean;
  available: boolean;
}

export interface Generation {
  id: string;
  projectId: string | null;
  task: 'generate' | 'variant' | 'directions' | 'animate' | 'removeBg' | 'inpaint' | 'train';
  kind: string | null;
  modelId: string;
  provider: string;
  endpoint: string | null;
  prompt: string;
  finalPrompt: string | null;
  params: Record<string, unknown>;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  progress: string | null;
  estimatedCost: number | null;
  actualCost: number | null;
  costSource: string | null;
  error: string | null;
  warnings: string[];
  extra: Record<string, unknown> | null;
  outputAssetIds: string[];
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface Estimate {
  task: string;
  model: { id: string; name: string; provider: string };
  calls: number;
  estimate: { usd: number | null; source: 'live' | 'catalog' | 'unknown'; breakdown: string };
  finalPrompt: string;
  warnings: string[];
}

export interface Lora {
  id: string;
  projectId: string | null;
  name: string;
  family: string;
  path: string;
  triggerWord: string | null;
  defaultScale: number;
  source: 'preset' | 'import' | 'trained';
  description: string;
  url?: string;
  license?: string;
  createdAt: number;
}

export interface ProcessOp { op: string; label: string; description: string; params: Record<string, string> }
export interface PalettePreset { id: string; name: string; author: string; colors: string[] }
export interface Meta { processOps: ProcessOp[]; palettes: PalettePreset[]; kinds: { kind: string; label: string; transparent: boolean }[]; exportFormats: string[] }

export function fmtUsd(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined) return '—';
  if (v === 0) return '$0';
  if (v < 0.0001) return '<$0.0001';
  return `$${v.toFixed(v >= 1 ? 2 : digits)}`;
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}
