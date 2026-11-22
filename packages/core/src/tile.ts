import type { RGBAImage } from './image.js';
import { createImage, blit, cloneImage } from './image.js';

/** Wrap-offset the image by half its size so seams appear in the middle (classic tile check). */
export function offsetWrap(img: RGBAImage, dx = Math.floor(img.width / 2), dy = Math.floor(img.height / 2)): RGBAImage {
  const out = createImage(img.width, img.height);
  const { width: w, height: h } = img;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = (((y + dy) % h) * w + ((x + dx) % w)) * 4;
      for (let c = 0; c < 4; c++) out.data[di + c] = img.data[si + c];
    }
  }
  return out;
}

/**
 * Make a texture seamless by cross-fading each border band with the opposite side.
 * `band` is the blend width in pixels. Run palette reduction afterwards for pixel art.
 */
export function makeSeamless(img: RGBAImage, band = Math.max(1, Math.floor(Math.min(img.width, img.height) / 8))): RGBAImage {
  const out = cloneImage(img);
  const { width: w, height: h } = img;
  const d = out.data;
  // Horizontal seam
  for (let y = 0; y < h; y++) {
    for (let k = 0; k < band; k++) {
      const t = 0.5 * (1 - k / band);
      const li = (y * w + k) * 4, ri = (y * w + (w - 1 - k)) * 4;
      for (let c = 0; c < 4; c++) {
        const l = d[li + c], r = d[ri + c];
        d[li + c] = l * (1 - t) + r * t;
        d[ri + c] = r * (1 - t) + l * t;
      }
    }
  }
  // Vertical seam
  for (let x = 0; x < w; x++) {
    for (let k = 0; k < band; k++) {
      const t = 0.5 * (1 - k / band);
      const ti = (k * w + x) * 4, bi = ((h - 1 - k) * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = d[ti + c], b = d[bi + c];
        d[ti + c] = a * (1 - t) + b * t;
        d[bi + c] = b * (1 - t) + a * t;
      }
    }
  }
  return out;
}

/** Repeat a tile into an n×m preview. */
export function tilePreview(img: RGBAImage, cols = 3, rows = 3): RGBAImage {
  const out = createImage(img.width * cols, img.height * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) blit(out, img, x * img.width, y * img.height);
  return out;
}

/** Seam score: mean absolute difference between opposite edges (0 = perfectly tileable). */
export function seamScore(img: RGBAImage): number {
  const { width: w, height: h, data: d } = img;
  let sum = 0, n = 0;
  for (let y = 0; y < h; y++) {
    const a = (y * w) * 4, b = (y * w + w - 1) * 4;
    for (let c = 0; c < 3; c++) sum += Math.abs(d[a + c] - d[b + c]);
    n += 3;
  }
  for (let x = 0; x < w; x++) {
    const a = x * 4, b = ((h - 1) * w + x) * 4;
    for (let c = 0; c < 3; c++) sum += Math.abs(d[a + c] - d[b + c]);
    n += 3;
  }
  return sum / n / 255;
}
