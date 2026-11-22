import type { RGBAImage } from './image.js';
import { createImage } from './image.js';

/** Nearest-neighbour resize (no interpolation — keeps hard pixel edges). */
export function resizeNearest(img: RGBAImage, width: number, height: number): RGBAImage {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  const out = createImage(width, height);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const srcY = Math.min(img.height - 1, Math.floor((y + 0.5) * sy));
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(img.width - 1, Math.floor((x + 0.5) * sx));
      const si = (srcY * img.width + srcX) * 4;
      const di = (y * width + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

/** Integer upscale (each pixel becomes a `factor`×`factor` block). */
export function upscaleInteger(img: RGBAImage, factor: number): RGBAImage {
  factor = Math.max(1, Math.floor(factor));
  if (factor === 1) return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  return resizeNearest(img, img.width * factor, img.height * factor);
}

/** Fit inside a box keeping aspect ratio, nearest-neighbour. */
export function fitNearest(img: RGBAImage, maxWidth: number, maxHeight: number): RGBAImage {
  const s = Math.min(maxWidth / img.width, maxHeight / img.height);
  return resizeNearest(img, Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s)));
}
