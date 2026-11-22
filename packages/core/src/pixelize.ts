import type { RGBAImage } from './image.js';
import { createImage } from './image.js';

export interface PixelGrid {
  /** Size of one "logical" pixel in source pixels (may be fractional). */
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  /** 0..1, how confident the detector is that a grid exists. */
  confidence: number;
}

function edgeProfile(img: RGBAImage, axis: 'x' | 'y'): Float64Array {
  const { width: w, height: h, data: d } = img;
  const len = axis === 'x' ? w : h;
  const prof = new Float64Array(len);
  if (axis === 'x') {
    for (let y = 0; y < h; y++) {
      for (let x = 1; x < w; x++) {
        const i = (y * w + x) * 4, j = i - 4;
        prof[x] += Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]) + Math.abs(d[i + 3] - d[j + 3]);
      }
    }
  } else {
    const row = w * 4;
    for (let y = 1; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, j = i - row;
        prof[y] += Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]) + Math.abs(d[i + 3] - d[j + 3]);
      }
    }
  }
  return prof;
}

function detectAxis(rawProf: Float64Array, minScale: number, maxScale: number): { scale: number; offset: number; score: number } {
  const n = rawProf.length;
  // Binarize: count edge *positions* rather than energy so a few high-contrast edges cannot dominate.
  let peak = 0;
  for (let i = 1; i < n; i++) if (rawProf[i] > peak) peak = rawProf[i];
  const prof = new Float64Array(n);
  for (let i = 1; i < n; i++) prof[i] = rawProf[i] > peak * 0.04 ? 1 : 0;
  let total = 0;
  for (let i = 1; i < n; i++) total += prof[i];
  const mean = total / Math.max(1, n - 1);
  if (mean <= 0) return { scale: 1, offset: 0, score: 0 };
  const results: { scale: number; offset: number; score: number }[] = [];
  for (let s = minScale; s <= maxScale + 1e-9; s += 0.25) {
    if (s * 3 > n) break;
    // AI outputs are rarely perfectly aligned: for larger cells accept ±1px around each grid line.
    const half = s >= 6 ? 1 : 0;
    const chance = (half * 2 + 1) / s;
    let bestScore = -1, bestOffset = 0;
    const steps = Math.max(1, Math.ceil(s * 2));
    for (let oi = 0; oi < steps; oi++) {
      const o = (oi / steps) * s;
      let covered = 0;
      for (let p = o; p < n; p += s) {
        const idx = Math.round(p);
        for (let j = idx - half; j <= idx + half; j++) if (j > 0 && j < n) covered += prof[j];
      }
      // Fraction of all edge energy that lies on grid lines, corrected for what chance would give.
      const coverage = covered / total;
      const score = (coverage - chance) / (1 - chance);
      if (score > bestScore) { bestScore = score; bestOffset = o; }
    }
    results.push({ scale: s, offset: bestOffset, score: bestScore });
  }
  if (results.length === 0) return { scale: 1, offset: 0, score: 0 };
  const best = results.reduce((a, b) => (b.score > a.score ? b : a));
  // Divisors of the true scale also cover every edge: prefer the LARGEST scale close to the best score.
  let pick = best;
  for (const r of results) {
    const ratio = r.scale / best.scale;
    const nearInteger = Math.abs(ratio - Math.round(ratio)) < 0.06;
    if (nearInteger && r.score >= best.score * 0.92 && r.scale > pick.scale) pick = r;
  }
  return { ...pick, offset: pick.offset % pick.scale };
}

/** Detect the pseudo-pixel grid in an upscaled / AI-generated "pixel art" image. */
export function detectPixelGrid(img: RGBAImage, opts: { minScale?: number; maxScale?: number } = {}): PixelGrid {
  const minScale = opts.minScale ?? 2;
  const maxScale = opts.maxScale ?? Math.max(4, Math.min(64, Math.floor(Math.min(img.width, img.height) / 8)));
  const ax = detectAxis(edgeProfile(img, 'x'), minScale, maxScale);
  const ay = detectAxis(edgeProfile(img, 'y'), minScale, maxScale);
  // Pixel art is (almost always) square-pixel: reconcile axes if close.
  let sx = ax.scale, sy = ay.scale;
  if (Math.abs(sx - sy) / Math.max(sx, sy) < 0.15) {
    const s = ax.score >= ay.score ? sx : sy;
    sx = s; sy = s;
  }
  const confidence = Math.max(0, Math.min(1, Math.min(ax.score, ay.score)));
  return { scaleX: sx, scaleY: sy, offsetX: ax.offset % sx, offsetY: ay.offset % sy, confidence };
}

export type CellSampling = 'mode' | 'center' | 'average';

export interface PixelizeOptions {
  /** Target output size. If omitted, uses `grid` or auto-detection. */
  width?: number;
  height?: number;
  grid?: Pick<PixelGrid, 'scaleX' | 'scaleY' | 'offsetX' | 'offsetY'>;
  sampling?: CellSampling;
  /** Fraction of each cell border ignored when sampling (0..0.45). */
  inset?: number;
  /** Cells whose transparent fraction exceeds this become fully transparent. */
  transparencyCutoff?: number;
}

/**
 * Snap an image onto a true pixel grid: every output pixel represents one cell of the source.
 * Cells are sampled by majority vote (mode) which removes AI blur / anti-aliasing.
 */
export function pixelize(img: RGBAImage, opts: PixelizeOptions = {}): RGBAImage {
  let scaleX: number, scaleY: number, offX = 0, offY = 0, outW: number, outH: number;
  if (opts.width && opts.height) {
    outW = Math.max(1, Math.round(opts.width));
    outH = Math.max(1, Math.round(opts.height));
    scaleX = img.width / outW;
    scaleY = img.height / outH;
  } else {
    const g = opts.grid ?? detectPixelGrid(img);
    scaleX = Math.max(1, g.scaleX);
    scaleY = Math.max(1, g.scaleY);
    offX = g.offsetX;
    offY = g.offsetY;
    outW = Math.max(1, Math.floor((img.width - offX) / scaleX + 0.01));
    outH = Math.max(1, Math.floor((img.height - offY) / scaleY + 0.01));
  }
  const sampling = opts.sampling ?? 'mode';
  const inset = Math.max(0, Math.min(0.45, opts.inset ?? 0.2));
  const cutoff = opts.transparencyCutoff ?? 0.5;
  const out = createImage(outW, outH);
  const d = img.data;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();

  for (let cy = 0; cy < outH; cy++) {
    const y0f = offY + cy * scaleY;
    const y0 = Math.floor(y0f + scaleY * inset);
    const y1 = Math.max(y0 + 1, Math.ceil(y0f + scaleY * (1 - inset)));
    for (let cx = 0; cx < outW; cx++) {
      const x0f = offX + cx * scaleX;
      const x0 = Math.floor(x0f + scaleX * inset);
      const x1 = Math.max(x0 + 1, Math.ceil(x0f + scaleX * (1 - inset)));
      const oi = (cy * outW + cx) * 4;

      if (sampling === 'center') {
        const sx = Math.min(img.width - 1, Math.floor(x0f + scaleX / 2));
        const sy = Math.min(img.height - 1, Math.floor(y0f + scaleY / 2));
        const si = (sy * img.width + sx) * 4;
        out.data[oi] = d[si]; out.data[oi + 1] = d[si + 1]; out.data[oi + 2] = d[si + 2];
        out.data[oi + 3] = d[si + 3] >= 128 ? 255 : 0;
        continue;
      }

      let total = 0, transparent = 0, sr = 0, sg = 0, sb = 0;
      buckets.clear();
      for (let y = y0; y < y1 && y < img.height; y++) {
        for (let x = x0; x < x1 && x < img.width; x++) {
          const si = (y * img.width + x) * 4;
          total++;
          if (d[si + 3] < 128) { transparent++; continue; }
          if (sampling === 'average') { sr += d[si]; sg += d[si + 1]; sb += d[si + 2]; continue; }
          const key = ((d[si] >> 3) << 10) | ((d[si + 1] >> 3) << 5) | (d[si + 2] >> 3);
          const e = buckets.get(key);
          if (e) { e.n++; e.r += d[si]; e.g += d[si + 1]; e.b += d[si + 2]; }
          else buckets.set(key, { n: 1, r: d[si], g: d[si + 1], b: d[si + 2] });
        }
      }
      if (total === 0 || transparent / total > cutoff) continue; // stays transparent
      const opaque = total - transparent;
      if (sampling === 'average') {
        out.data[oi] = Math.round(sr / opaque); out.data[oi + 1] = Math.round(sg / opaque); out.data[oi + 2] = Math.round(sb / opaque);
        out.data[oi + 3] = 255;
        continue;
      }
      let best: { n: number; r: number; g: number; b: number } | null = null;
      for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
      if (!best) continue;
      out.data[oi] = Math.round(best.r / best.n);
      out.data[oi + 1] = Math.round(best.g / best.n);
      out.data[oi + 2] = Math.round(best.b / best.n);
      out.data[oi + 3] = 255;
    }
  }
  return out;
}
