import type { RGBAImage } from './image.js';
import { cloneImage } from './image.js';
import { hexToRgb, rgbToHex, rgbToOklab, type RGB } from './color.js';

export type DitherMode = 'none' | 'floyd-steinberg' | 'atkinson' | 'bayer2' | 'bayer4' | 'bayer8';

interface ColorCount {
  r: number;
  g: number;
  b: number;
  n: number;
}

function histogram(img: RGBAImage, alphaThreshold: number): ColorCount[] {
  const map = new Map<number, ColorCount>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= alphaThreshold) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    const e = map.get(key);
    if (e) e.n++;
    else map.set(key, { r: d[i], g: d[i + 1], b: d[i + 2], n: 1 });
  }
  return [...map.values()];
}

/**
 * Extract a palette of at most `maxColors` colors using weighted median cut,
 * refined with a few k-means iterations in OKLab space.
 */
export function extractPalette(img: RGBAImage, maxColors: number, opts: { alphaThreshold?: number; kmeansIterations?: number } = {}): RGB[] {
  const alphaThreshold = opts.alphaThreshold ?? 127;
  const colors = histogram(img, alphaThreshold);
  if (colors.length === 0) return [];
  if (colors.length <= maxColors) return colors.map((c) => [c.r, c.g, c.b]);

  type Box = { items: ColorCount[] };
  const boxes: Box[] = [{ items: colors }];
  const range = (items: ColorCount[]) => {
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (const c of items) {
      if (c.r < rmin) rmin = c.r; if (c.r > rmax) rmax = c.r;
      if (c.g < gmin) gmin = c.g; if (c.g > gmax) gmax = c.g;
      if (c.b < bmin) bmin = c.b; if (c.b > bmax) bmax = c.b;
    }
    return { r: rmax - rmin, g: gmax - gmin, b: bmax - bmin };
  };
  while (boxes.length < maxColors) {
    // Split the box with the largest (range * population) score.
    let best = -1, bestScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].items.length < 2) continue;
      const rg = range(boxes[i].items);
      const pop = boxes[i].items.reduce((s, c) => s + c.n, 0);
      const score = Math.max(rg.r, rg.g, rg.b) * Math.sqrt(pop);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    const box = boxes[best];
    const rg = range(box.items);
    const ch: 'r' | 'g' | 'b' = rg.r >= rg.g && rg.r >= rg.b ? 'r' : rg.g >= rg.b ? 'g' : 'b';
    box.items.sort((a, b) => a[ch] - b[ch]);
    const total = box.items.reduce((s, c) => s + c.n, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < box.items.length; i++) {
      acc += box.items[i].n;
      if (acc >= total / 2) { cut = Math.min(Math.max(i + 1, 1), box.items.length - 1); break; }
    }
    boxes.splice(best, 1, { items: box.items.slice(0, cut) }, { items: box.items.slice(cut) });
  }

  // Initial centroids (weighted averages), then k-means refinement in OKLab.
  let centroids = boxes.map((b) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const c of b.items) { r += c.r * c.n; g += c.g * c.n; bl += c.b * c.n; n += c.n; }
    return [r / n, g / n, bl / n] as [number, number, number];
  });
  const labs = colors.map((c) => rgbToOklab(c.r, c.g, c.b));
  const iterations = opts.kmeansIterations ?? 4;
  for (let it = 0; it < iterations; it++) {
    const cLabs = centroids.map((c) => rgbToOklab(c[0], c[1], c[2]));
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < colors.length; i++) {
      const l = labs[i];
      let bi = 0, bd = Infinity;
      for (let k = 0; k < cLabs.length; k++) {
        const d = (l[0] - cLabs[k][0]) ** 2 + (l[1] - cLabs[k][1]) ** 2 + (l[2] - cLabs[k][2]) ** 2;
        if (d < bd) { bd = d; bi = k; }
      }
      const c = colors[i];
      sums[bi][0] += c.r * c.n; sums[bi][1] += c.g * c.n; sums[bi][2] += c.b * c.n; sums[bi][3] += c.n;
    }
    centroids = centroids.map((c, k) => (sums[k][3] > 0 ? [sums[k][0] / sums[k][3], sums[k][1] / sums[k][3], sums[k][2] / sums[k][3]] : c));
  }
  const out: RGB[] = [];
  const seen = new Set<string>();
  for (const c of centroids) {
    const rgb: RGB = [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];
    const hex = rgbToHex(rgb);
    if (!seen.has(hex)) { seen.add(hex); out.push(rgb); }
  }
  return out;
}

export function paletteToHex(p: RGB[]): string[] {
  return p.map((c) => rgbToHex(c));
}

export function paletteFromHex(hex: string[]): RGB[] {
  return hex.map(hexToRgb);
}

/** Nearest-color matcher in OKLab with a memo cache. */
export class PaletteMatcher {
  private labs: [number, number, number][];
  private cache = new Map<number, number>();
  constructor(public readonly palette: RGB[]) {
    if (palette.length === 0) throw new Error('Palette is empty');
    this.labs = palette.map((c) => rgbToOklab(c[0], c[1], c[2]));
  }
  nearestIndex(r: number, g: number, b: number): number {
    r = Math.max(0, Math.min(255, Math.round(r)));
    g = Math.max(0, Math.min(255, Math.round(g)));
    b = Math.max(0, Math.min(255, Math.round(b)));
    const key = (r << 16) | (g << 8) | b;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const l = rgbToOklab(r, g, b);
    let bi = 0, bd = Infinity;
    for (let k = 0; k < this.labs.length; k++) {
      const p = this.labs[k];
      const d = (l[0] - p[0]) ** 2 + (l[1] - p[1]) ** 2 + (l[2] - p[2]) ** 2;
      if (d < bd) { bd = d; bi = k; }
    }
    if (this.cache.size < 1 << 18) this.cache.set(key, bi);
    return bi;
  }
  nearest(r: number, g: number, b: number): RGB {
    return this.palette[this.nearestIndex(r, g, b)];
  }
}

const BAYER2 = [[0, 2], [3, 1]];
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
function bayer8(): number[][] {
  const m: number[][] = [];
  for (let y = 0; y < 8; y++) {
    m.push([]);
    for (let x = 0; x < 8; x++) {
      const b4 = BAYER4[y % 4][x % 4];
      const b2 = BAYER2[Math.floor(y / 4)][Math.floor(x / 4)];
      m[y].push(4 * b4 + b2);
    }
  }
  return m;
}
const BAYER8 = bayer8();

export interface ApplyPaletteOptions {
  dither?: DitherMode;
  /** 0..1 — scales error diffusion / threshold amplitude. */
  ditherStrength?: number;
  /** Pixels with alpha <= threshold are left fully transparent; others become opaque. */
  alphaThreshold?: number;
}

/** Map every opaque pixel to the nearest palette color, with optional dithering. */
export function applyPalette(img: RGBAImage, palette: RGB[], opts: ApplyPaletteOptions = {}): RGBAImage {
  const dither = opts.dither ?? 'none';
  const strength = Math.max(0, Math.min(1, opts.ditherStrength ?? 1));
  const alphaThreshold = opts.alphaThreshold ?? 127;
  const matcher = new PaletteMatcher(palette);
  const out = cloneImage(img);
  const { width: w, height: h } = out;
  const d = out.data;

  if (dither === 'bayer2' || dither === 'bayer4' || dither === 'bayer8') {
    const m = dither === 'bayer2' ? BAYER2 : dither === 'bayer4' ? BAYER4 : BAYER8;
    const n = m.length * m.length;
    const spread = 48 * strength;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] <= alphaThreshold) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
        const t = ((m[y % m.length][x % m.length] + 0.5) / n - 0.5) * spread;
        const c = matcher.nearest(d[i] + t, d[i + 1] + t, d[i + 2] + t);
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }
    return out;
  }

  if (dither === 'floyd-steinberg' || dither === 'atkinson') {
    const buf = new Float32Array(w * h * 3);
    for (let p = 0; p < w * h; p++) {
      buf[p * 3] = d[p * 4];
      buf[p * 3 + 1] = d[p * 4 + 1];
      buf[p * 3 + 2] = d[p * 4 + 2];
    }
    const kernel: [number, number, number][] =
      dither === 'floyd-steinberg'
        ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
        : [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const i = p * 4;
        if (d[i + 3] <= alphaThreshold) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
        const r = buf[p * 3], g = buf[p * 3 + 1], b = buf[p * 3 + 2];
        const c = matcher.nearest(r, g, b);
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        const er = (r - c[0]) * strength, eg = (g - c[1]) * strength, eb = (b - c[2]) * strength;
        for (const [kx, ky, kw] of kernel) {
          const nx = x + kx, ny = y + ky;
          if (nx < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (d[q * 4 + 3] <= alphaThreshold) continue;
          buf[q * 3] += er * kw; buf[q * 3 + 1] += eg * kw; buf[q * 3 + 2] += eb * kw;
        }
      }
    }
    return out;
  }

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= alphaThreshold) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
    const c = matcher.nearest(d[i], d[i + 1], d[i + 2]);
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  return out;
}

/** Reduce an image to at most `maxColors` colors (extracting its own palette). */
export function reduceColors(img: RGBAImage, maxColors: number, opts: ApplyPaletteOptions = {}): { image: RGBAImage; palette: RGB[] } {
  const palette = extractPalette(img, maxColors, { alphaThreshold: opts.alphaThreshold });
  if (palette.length === 0) return { image: cloneImage(img), palette };
  return { image: applyPalette(img, palette, opts), palette };
}
