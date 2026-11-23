import type { RGBAImage, RGBA } from './image.js';
import { cloneImage } from './image.js';
import { redmeanDistance, rgbToHsl } from './color.js';

export interface FloodRemoveOptions {
  /** Color tolerance 0..100 (perceptual-ish). */
  tolerance?: number;
  /** Seeds; defaults to the four corners plus edge midpoints. */
  seeds?: [number, number][];
  /** If true, removes every pixel matching the background color, not only connected ones. */
  global?: boolean;
  /** Soften the cut-out edge by 1px partial alpha (off by default for pixel art). */
  feather?: boolean;
}

function toleranceToDistance(t: number): number {
  // redmean distance squared roughly spans 0..(3*255^2*3); map 0..100 to a useful range.
  const x = Math.max(0, Math.min(100, t)) / 100;
  return (x * 255) ** 2 * 3;
}

/**
 * Deterministic (free) background removal: flood-fill from image borders and clear pixels
 * similar to the seed colors. Works very well for sprites generated on a flat background.
 */
export function removeBackgroundFlood(img: RGBAImage, opts: FloodRemoveOptions = {}): RGBAImage {
  const out = cloneImage(img);
  const { width: w, height: h, data: d } = out;
  const maxDist = toleranceToDistance(opts.tolerance ?? 12);
  const seeds = opts.seeds ?? [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1], [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)],
  ];
  const visited = new Uint8Array(w * h);
  const seedColors: RGBA[] = [];
  for (const [sx, sy] of seeds) {
    const i = (sy * w + sx) * 4;
    if (d[i + 3] === 0) continue;
    seedColors.push([d[i], d[i + 1], d[i + 2], d[i + 3]]);
  }
  if (seedColors.length === 0) return out;
  const matches = (i: number) => {
    if (d[i + 3] === 0) return true;
    for (const c of seedColors) if (redmeanDistance(d[i], d[i + 1], d[i + 2], c[0], c[1], c[2]) <= maxDist) return true;
    return false;
  };

  if (opts.global) {
    for (let p = 0; p < w * h; p++) if (matches(p * 4)) d[p * 4 + 3] = 0;
    return out;
  }

  const stack: number[] = [];
  for (const [sx, sy] of seeds) stack.push(sy * w + sx);
  // Also seed every border pixel that matches, so enclosed corners don't break the fill.
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (!matches(i)) continue;
    d[i + 3] = 0;
    const x = p % w, y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  if (opts.feather) {
    const alpha = new Uint8ClampedArray(w * h);
    for (let p = 0; p < w * h; p++) alpha[p] = d[p * 4 + 3];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (alpha[p] === 0) continue;
        let clear = 0;
        if (x > 0 && alpha[p - 1] === 0) clear++;
        if (x < w - 1 && alpha[p + 1] === 0) clear++;
        if (y > 0 && alpha[p - w] === 0) clear++;
        if (y < h - 1 && alpha[p + w] === 0) clear++;
        if (clear >= 2) d[p * 4 + 3] = 160;
      }
    }
  }
  return out;
}

/** Remove a specific color (chroma key). */
export function chromaKey(img: RGBAImage, color: [number, number, number], tolerance = 10): RGBAImage {
  const out = cloneImage(img);
  const d = out.data;
  const maxDist = toleranceToDistance(tolerance);
  for (let i = 0; i < d.length; i += 4) {
    if (redmeanDistance(d[i], d[i + 1], d[i + 2], color[0], color[1], color[2]) <= maxDist) d[i + 3] = 0;
  }
  return out;
}

/** Binarize alpha: pixel art needs fully opaque or fully transparent pixels. */
export function hardenAlpha(img: RGBAImage, threshold = 127): RGBAImage {
  const out = cloneImage(img);
  const d = out.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > threshold ? 255 : 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 0) d[i] = d[i + 1] = d[i + 2] = 0;
  return out;
}

/** Use an external grayscale mask (e.g. from BiRefNet) as alpha channel. */
export function applyMask(img: RGBAImage, mask: RGBAImage, threshold?: number): RGBAImage {
  if (mask.width !== img.width || mask.height !== img.height) throw new Error('Mask size mismatch');
  const out = cloneImage(img);
  // A cutout (RGBA with transparency) is read through its alpha channel; an opaque image is read as a
  // grayscale mask. The mode is decided once for the whole mask, never per pixel.
  let useAlpha = false;
  for (let i = 3; i < mask.data.length; i += 4) if (mask.data[i] < 255) { useAlpha = true; break; }
  for (let i = 0; i < out.data.length; i += 4) {
    const m = useAlpha ? mask.data[i + 3] : Math.round(0.2126 * mask.data[i] + 0.7152 * mask.data[i + 1] + 0.0722 * mask.data[i + 2]);
    const a = Math.round((out.data[i + 3] * m) / 255);
    out.data[i + 3] = threshold === undefined ? a : a > threshold ? 255 : 0;
  }
  return out;
}

/** Median color of the four corner patches — the real background color an AI model painted. */
export function estimateBackgroundColor(img: RGBAImage, patch = 6): [number, number, number] {
  const { width: w, height: h, data: d } = img;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const p = Math.max(1, Math.min(patch, Math.floor(Math.min(w, h) / 4)));
  for (const [cx, cy] of [[0, 0], [w - p, 0], [0, h - p], [w - p, h - p]]) {
    for (let y = cy; y < cy + p; y++) for (let x = cx; x < cx + p; x++) {
      const i = (y * w + x) * 4;
      rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
    }
  }
  const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return [med(rs), med(gs), med(bs)];
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export interface KeyRegionOptions {
  /** Key (background) color; estimate it with estimateBackgroundColor on the raw image. */
  key: [number, number, number];
  /** Max hue difference in degrees (default 16). */
  hueTolerance?: number;
  /** Pixel saturation must be at least this fraction of the key saturation (default 0.55). */
  minSaturationRatio?: number;
}

/**
 * Remove regions tinted with the key color that a plain flood fill misses: drop shadows painted in a darker
 * shade of the background, and background enclosed between limbs. Grows from transparent pixels (and the
 * border) through pixels whose hue matches the key and that are strongly saturated — so desaturated or
 * differently-hued parts of the subject are preserved.
 */
export function removeKeyColorRegions(img: RGBAImage, opts: KeyRegionOptions): RGBAImage {
  const out = cloneImage(img);
  const { width: w, height: h, data: d } = out;
  const [kh, ks] = rgbToHsl(opts.key[0], opts.key[1], opts.key[2]);
  if (ks < 0.25) return out; // grey/white key: hue is meaningless
  const tol = opts.hueTolerance ?? 16;
  const minSat = Math.max(0.3, ks * (opts.minSaturationRatio ?? 0.55));
  const cache = new Map<number, boolean>();
  const isKey = (i: number) => {
    const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let v = cache.get(k);
    if (v === undefined) {
      const [hh, ss, ll] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      v = ss >= minSat && ll > 0.08 && ll < 0.92 && hueDistance(hh, kh) <= tol;
      cache.set(k, v);
    }
    return v;
  };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let p = 0; p < w * h; p++) {
    const x = p % w, y = (p - x) / w;
    if (d[p * 4 + 3] === 0 || x === 0 || y === 0 || x === w - 1 || y === h - 1) stack.push(p);
  }
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (d[i + 3] !== 0) {
      if (!isKey(i)) continue;
      d[i + 3] = 0;
    }
    const x = p % w, y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return out;
}
