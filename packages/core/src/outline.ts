import type { RGBAImage, RGBA } from './image.js';
import { cloneImage, createImage, blit } from './image.js';
import { rgbToHsl, hslToRgb } from './color.js';

const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/**
 * Remove "orphan" pixels: opaque pixels with fewer than `minNeighbors` opaque 8-neighbours
 * (stray noise left by AI generation or background removal).
 */
export function removeOrphans(img: RGBAImage, minNeighbors = 1): RGBAImage {
  const out = cloneImage(img);
  const { width: w, height: h } = img;
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img.data[(y * w + x) * 4 + 3]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a(x, y) === 0) continue;
      let n = 0;
      for (const [dx, dy] of N8) if (a(x + dx, y + dy) > 0) n++;
      if (n < minNeighbors) {
        const i = (y * w + x) * 4;
        out.data[i] = out.data[i + 1] = out.data[i + 2] = out.data[i + 3] = 0;
      }
    }
  }
  return out;
}

/** Fill single-pixel transparent holes fully surrounded (4-neighbourhood) by opaque pixels. */
export function fillPinholes(img: RGBAImage): RGBAImage {
  const out = cloneImage(img);
  const { width: w, height: h, data: d } = img;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] !== 0) continue;
      let r = 0, g = 0, b = 0, ok = true;
      for (const [dx, dy] of N4) {
        const j = ((y + dy) * w + (x + dx)) * 4;
        if (d[j + 3] === 0) { ok = false; break; }
        r += d[j]; g += d[j + 1]; b += d[j + 2];
      }
      if (!ok) continue;
      out.data[i] = Math.round(r / 4); out.data[i + 1] = Math.round(g / 4); out.data[i + 2] = Math.round(b / 4); out.data[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Remove isolated single pixels whose color differs from all 4-neighbours ("salt" noise),
 * replacing them with the most common neighbour color.
 */
export function despeckle(img: RGBAImage): RGBAImage {
  const out = cloneImage(img);
  const { width: w, height: h, data: d } = img;
  const key = (i: number) => (d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      const self = key(i);
      const counts = new Map<number, { n: number; i: number }>();
      let same = false;
      for (const [dx, dy] of N4) {
        const j = ((y + dy) * w + (x + dx)) * 4;
        const k = key(j);
        if (k === self) { same = true; break; }
        const e = counts.get(k);
        if (e) e.n++; else counts.set(k, { n: 1, i: j });
      }
      if (same) continue;
      let best: { n: number; i: number } | null = null;
      for (const e of counts.values()) if (!best || e.n > best.n) best = e;
      if (best && best.n >= 3 && d[best.i + 3] !== 0) {
        for (let c = 0; c < 4; c++) out.data[i + c] = d[best.i + c];
      }
    }
  }
  return out;
}

export interface OutlineOptions {
  /** Hex-free RGBA color; 'auto' darkens the neighbouring pixel color. */
  color?: RGBA | 'auto';
  /** 'outer' grows the sprite by one pixel; 'inner' recolors the sprite's border pixels. */
  mode?: 'outer' | 'inner';
  /** Use 8-neighbourhood (thicker diagonals) instead of 4. */
  diagonal?: boolean;
}

function darken(c: RGBA, amount = 0.45): RGBA {
  const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
  const [r, g, b] = hslToRgb(h, Math.min(1, s * 1.1), Math.max(0, l * (1 - amount)));
  return [r, g, b, 255];
}

/** Add a 1px outline around opaque content. Outer mode expands the canvas by 1px on each side. */
export function addOutline(img: RGBAImage, opts: OutlineOptions = {}): RGBAImage {
  const mode = opts.mode ?? 'outer';
  const nb = opts.diagonal ? N8 : N4;
  const color = opts.color ?? [20, 16, 24, 255];
  let src = img;
  if (mode === 'outer') {
    src = createImage(img.width + 2, img.height + 2);
    blit(src, img, 1, 1);
  }
  const out = cloneImage(src);
  const { width: w, height: h, data: d } = src;
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const isOpaque = d[i + 3] > 0;
      if (mode === 'outer' && isOpaque) continue;
      if (mode === 'inner' && !isOpaque) continue;
      let hit: number | null = null;
      for (const [dx, dy] of nb) {
        const nx = x + dx, ny = y + dy;
        const nOpaque = opaque(nx, ny);
        if (mode === 'outer' ? nOpaque : !nOpaque) { hit = nOpaque ? (ny * w + nx) * 4 : i; break; }
      }
      if (hit === null) continue;
      const c: RGBA = color === 'auto' ? darken([d[hit], d[hit + 1], d[hit + 2], 255]) : color;
      out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2]; out.data[i + 3] = c[3];
    }
  }
  return out;
}
