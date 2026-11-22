/**
 * Editor document model: a fixed-size canvas with layers (shared by all frames) and frames
 * (each frame holds one cel — an RGBA buffer — per layer). Straight (non-premultiplied) alpha.
 */
export type RGBA = [number, number, number, number];

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
}

export interface EFrame {
  id: string;
  /** milliseconds */
  duration: number;
  cels: Record<string, Uint8ClampedArray>;
  /** Bumped on every pixel change (composite cache key). */
  rev: number;
}

export interface Doc {
  width: number;
  height: number;
  /** Bottom → top. */
  layers: Layer[];
  frames: EFrame[];
}

let counter = 0;
export function uid(prefix = 'l'): string {
  counter++;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyCel(w: number, h: number): Uint8ClampedArray {
  return new Uint8ClampedArray(w * h * 4);
}

export function celOf(doc: Doc, frame: EFrame, layerId: string): Uint8ClampedArray {
  let c = frame.cels[layerId];
  if (!c) {
    c = emptyCel(doc.width, doc.height);
    frame.cels[layerId] = c;
  }
  return c;
}

export function cloneDoc(doc: Doc): Doc {
  return {
    width: doc.width,
    height: doc.height,
    layers: doc.layers.map((l) => ({ ...l })),
    frames: doc.frames.map((f) => ({
      id: f.id,
      duration: f.duration,
      rev: f.rev,
      cels: Object.fromEntries(Object.entries(f.cels).map(([k, v]) => [k, v.slice()])),
    })),
  };
}

export function newDoc(width: number, height: number, frames: Uint8ClampedArray[] = [], durations: number[] = []): Doc {
  const layer: Layer = { id: uid('ly'), name: 'Layer 1', visible: true, opacity: 1 };
  const fs = (frames.length ? frames : [emptyCel(width, height)]).map((data, i) => ({
    id: uid('fr'),
    duration: durations[i] ?? 100,
    rev: 0,
    cels: { [layer.id]: data },
  }));
  return { width, height, layers: [layer], frames: fs };
}

/** Source-over composite of the visible layers of a frame. */
export function compositeFrame(doc: Doc, frame: EFrame): Uint8ClampedArray {
  const out = new Uint8ClampedArray(doc.width * doc.height * 4);
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const cel = frame.cels[layer.id];
    if (!cel) continue;
    blendOver(out, cel, layer.opacity);
  }
  return out;
}

/** dst = src over dst (straight alpha), src scaled by opacity. */
export function blendOver(dst: Uint8ClampedArray, src: Uint8ClampedArray, opacity = 1): void {
  for (let i = 0; i < src.length; i += 4) {
    const sa = src[i + 3];
    if (sa === 0) continue;
    const a = (sa / 255) * opacity;
    if (a >= 0.999) {
      dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; dst[i + 3] = 255;
      continue;
    }
    const da = dst[i + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa <= 0) continue;
    dst[i] = (src[i] * a + dst[i] * da * (1 - a)) / oa;
    dst[i + 1] = (src[i + 1] * a + dst[i + 1] * da * (1 - a)) / oa;
    dst[i + 2] = (src[i + 2] * a + dst[i + 2] * da * (1 - a)) / oa;
    dst[i + 3] = oa * 255;
  }
}

export function isEmpty(cel: Uint8ClampedArray): boolean {
  for (let i = 3; i < cel.length; i += 4) if (cel[i] !== 0) return false;
  return true;
}

// ── Serialization ──

export interface SerializedDoc {
  format: 'sprixy-editor';
  version: 1;
  width: number;
  height: number;
  layers: Layer[];
  frames: { id: string; duration: number; cels: Record<string, string | null> }[];
}

export function bytesToBase64(u8: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode(...u8.subarray(i, i + chunk));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Run-length encode RGBA pixels as [count(u16 LE), r, g, b, a] records — tiny for pixel art. */
export function rleEncode(data: Uint8ClampedArray): Uint8Array {
  const out: number[] = [];
  const n = data.length / 4;
  let i = 0;
  while (i < n) {
    const p = i * 4;
    let run = 1;
    while (i + run < n && run < 65535) {
      const q = (i + run) * 4;
      if (data[q] !== data[p] || data[q + 1] !== data[p + 1] || data[q + 2] !== data[p + 2] || data[q + 3] !== data[p + 3]) break;
      run++;
    }
    out.push(run & 255, run >> 8, data[p], data[p + 1], data[p + 2], data[p + 3]);
    i += run;
  }
  return new Uint8Array(out);
}

export function rleDecode(bytes: Uint8Array, pixelCount: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixelCount * 4);
  let o = 0;
  for (let i = 0; i + 5 < bytes.length + 0 && o < out.length; i += 6) {
    const run = bytes[i] | (bytes[i + 1] << 8);
    for (let k = 0; k < run && o < out.length; k++) {
      out[o++] = bytes[i + 2]; out[o++] = bytes[i + 3]; out[o++] = bytes[i + 4]; out[o++] = bytes[i + 5];
    }
  }
  return out;
}

export function serializeDoc(doc: Doc): SerializedDoc {
  return {
    format: 'sprixy-editor',
    version: 1,
    width: doc.width,
    height: doc.height,
    layers: doc.layers.map((l) => ({ ...l })),
    frames: doc.frames.map((f) => ({
      id: f.id,
      duration: f.duration,
      cels: Object.fromEntries(doc.layers.map((l) => {
        const c = f.cels[l.id];
        return [l.id, c && !isEmpty(c) ? bytesToBase64(rleEncode(c)) : null];
      })),
    })),
  };
}

export function deserializeDoc(raw: unknown): Doc | null {
  const d = raw as SerializedDoc | null;
  if (!d || d.format !== 'sprixy-editor' || d.version !== 1) return null;
  if (!Number.isInteger(d.width) || !Number.isInteger(d.height) || d.width <= 0 || d.height <= 0) return null;
  if (!Array.isArray(d.layers) || !Array.isArray(d.frames) || !d.layers.length || !d.frames.length) return null;
  const px = d.width * d.height;
  return {
    width: d.width,
    height: d.height,
    layers: d.layers.map((l) => ({ id: String(l.id), name: String(l.name ?? 'Layer'), visible: l.visible !== false, opacity: typeof l.opacity === 'number' ? Math.max(0, Math.min(1, l.opacity)) : 1 })),
    frames: d.frames.map((f) => ({
      id: String(f.id ?? uid('fr')),
      duration: typeof f.duration === 'number' && f.duration > 0 ? f.duration : 100,
      rev: 0,
      cels: Object.fromEntries(d.layers.map((l) => {
        const b = f.cels?.[l.id];
        return [l.id, b ? rleDecode(base64ToBytes(b), px) : emptyCel(d.width, d.height)];
      })),
    })),
  };
}

// ── Image I/O (browser) ──

export async function loadImageRGBA(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not load image (${res.status})`);
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return { width: id.width, height: id.height, data: id.data };
}

export function cropRGBA(src: Uint8ClampedArray, sw: number, sh: number, x: number, y: number, w: number, h: number, outW = w, outH = h): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let yy = 0; yy < Math.min(h, outH); yy++) {
    const sy = y + yy;
    if (sy < 0 || sy >= sh) continue;
    for (let xx = 0; xx < Math.min(w, outW); xx++) {
      const sx = x + xx;
      if (sx < 0 || sx >= sw) continue;
      const si = (sy * sw + sx) * 4, di = (yy * outW + xx) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
    }
  }
  return out;
}

export function rgbaToPngDataUrl(width: number, height: number, data: Uint8ClampedArray): string {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  const id = ctx.createImageData(width, height);
  id.data.set(data);
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}

export function hexToRgba(hex: string): RGBA {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

export function rgbaToHex(c: RGBA): string {
  return '#' + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function uniqueColors(data: Uint8ClampedArray, max = 64): string[] {
  const set = new Set<string>();
  for (let i = 0; i < data.length && set.size < max; i += 4) {
    if (data[i + 3] < 128) continue;
    set.add(rgbaToHex([data[i], data[i + 1], data[i + 2], 255]));
  }
  return [...set];
}
