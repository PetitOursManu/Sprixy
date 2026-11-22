import type { RGBAImage } from './image.js';
import { cloneImage } from './image.js';
import { hexToRgb, rgbToHsl, hslToRgb, type RGB } from './color.js';
import { extractPalette, PaletteMatcher } from './quantize.js';

/** Rotate hue / scale saturation / shift lightness of every opaque pixel. */
export function adjustHsl(img: RGBAImage, opts: { hue?: number; saturation?: number; lightness?: number }): RGBAImage {
  const out = cloneImage(img);
  const d = out.data;
  const dh = opts.hue ?? 0, ds = opts.saturation ?? 1, dl = opts.lightness ?? 0;
  const cache = new Map<number, RGB>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let c = cache.get(key);
    if (!c) {
      const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      c = hslToRgb(h + dh, Math.max(0, Math.min(1, s * ds)), Math.max(0, Math.min(1, l + dl)));
      cache.set(key, c);
    }
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
  }
  return out;
}

/** Exact color replacement map: { '#ff0000': '#00ff00' }. */
export function replaceColors(img: RGBAImage, mapping: Record<string, string>): RGBAImage {
  const out = cloneImage(img);
  const d = out.data;
  const m = new Map<number, RGB>();
  for (const [from, to] of Object.entries(mapping)) {
    const f = hexToRgb(from);
    m.set((f[0] << 16) | (f[1] << 8) | f[2], hexToRgb(to));
  }
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const t = m.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    if (t) { d[i] = t[0]; d[i + 1] = t[1]; d[i + 2] = t[2]; }
  }
  return out;
}

/**
 * Palette swap: map the image's own colors onto a target palette by sorted luminance
 * ramps (keeps shading structure). Great for recolor variants (enemy tiers, team colors…).
 */
export function paletteSwap(img: RGBAImage, target: string[]): RGBAImage {
  const targetRgb = target.map(hexToRgb);
  const source = extractPalette(img, Math.max(2, targetRgb.length));
  if (source.length === 0 || targetRgb.length === 0) return cloneImage(img);
  const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const s = [...source].sort((a, b) => lum(a) - lum(b));
  const t = [...targetRgb].sort((a, b) => lum(a) - lum(b));
  const map = new Map<number, RGB>();
  s.forEach((c, i) => {
    const ti = s.length === 1 ? 0 : Math.round((i / (s.length - 1)) * (t.length - 1));
    map.set((c[0] << 16) | (c[1] << 8) | c[2], t[ti]);
  });
  const matcher = new PaletteMatcher(source);
  const out = cloneImage(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const src = matcher.nearest(d[i], d[i + 1], d[i + 2]);
    const c = map.get((src[0] << 16) | (src[1] << 8) | src[2])!;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
  }
  return out;
}

/** Brightness (-1..1) and contrast (-1..1). */
export function brightnessContrast(img: RGBAImage, brightness = 0, contrast = 0): RGBAImage {
  const out = cloneImage(img);
  const d = out.data;
  const f = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) d[i + c] = f * (d[i + c] + brightness * 255 - 128) + 128;
  }
  return out;
}
