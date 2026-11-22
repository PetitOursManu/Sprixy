/**
 * Minimal RGBA raster type shared by the server, the web editor and the MCP tools.
 * Pixel data is stored row-major, 4 bytes per pixel (straight, non-premultiplied alpha).
 */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type RGBA = [number, number, number, number];

export function createImage(width: number, height: number, fill?: RGBA): RGBAImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid image size ${width}x${height}`);
  }
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill && (fill[0] || fill[1] || fill[2] || fill[3])) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
    }
  }
  return { width, height, data };
}

export function fromData(width: number, height: number, data: ArrayLike<number>): RGBAImage {
  if (data.length !== width * height * 4) {
    throw new Error(`Buffer length ${data.length} does not match ${width}x${height} RGBA`);
  }
  return { width, height, data: new Uint8ClampedArray(data as ArrayLike<number>) };
}

export function cloneImage(img: RGBAImage): RGBAImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

export function getPixel(img: RGBAImage, x: number, y: number): RGBA {
  const i = (y * img.width + x) * 4;
  const d = img.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

export function setPixel(img: RGBAImage, x: number, y: number, c: RGBA): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0];
  img.data[i + 1] = c[1];
  img.data[i + 2] = c[2];
  img.data[i + 3] = c[3];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function crop(img: RGBAImage, r: Rect): RGBAImage {
  const out = createImage(Math.max(1, r.w), Math.max(1, r.h));
  for (let y = 0; y < r.h; y++) {
    const sy = r.y + y;
    if (sy < 0 || sy >= img.height) continue;
    for (let x = 0; x < r.w; x++) {
      const sx = r.x + x;
      if (sx < 0 || sx >= img.width) continue;
      const si = (sy * img.width + sx) * 4;
      const di = (y * out.width + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

/** Copy `src` into `dst` at (dx, dy). Uses "source-over" alpha compositing when `blend` is true. */
export function blit(dst: RGBAImage, src: RGBAImage, dx: number, dy: number, blend = false): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const si = (y * src.width + x) * 4;
      const di = (ty * dst.width + tx) * 4;
      const sa = src.data[si + 3];
      if (!blend || sa === 255) {
        dst.data[di] = src.data[si];
        dst.data[di + 1] = src.data[si + 1];
        dst.data[di + 2] = src.data[si + 2];
        dst.data[di + 3] = sa;
        continue;
      }
      if (sa === 0) continue;
      const a = sa / 255;
      const da = dst.data[di + 3] / 255;
      const oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++) {
        dst.data[di + c] = Math.round((src.data[si + c] * a + dst.data[di + c] * da * (1 - a)) / oa);
      }
      dst.data[di + 3] = Math.round(oa * 255);
    }
  }
}

/** Bounding box of pixels whose alpha is above `alphaThreshold`. Returns null for fully transparent images. */
export function contentBounds(img: RGBAImage, alphaThreshold = 0): Rect | null {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function trim(img: RGBAImage, padding = 0): RGBAImage {
  const b = contentBounds(img);
  if (!b) return createImage(1, 1);
  return crop(img, { x: b.x - padding, y: b.y - padding, w: b.w + padding * 2, h: b.h + padding * 2 });
}

export function flipHorizontal(img: RGBAImage): RGBAImage {
  const out = createImage(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const si = (y * img.width + x) * 4;
      const di = (y * img.width + (img.width - 1 - x)) * 4;
      for (let c = 0; c < 4; c++) out.data[di + c] = img.data[si + c];
    }
  }
  return out;
}

export function flipVertical(img: RGBAImage): RGBAImage {
  const out = createImage(img.width, img.height);
  const row = img.width * 4;
  for (let y = 0; y < img.height; y++) {
    out.data.set(img.data.subarray(y * row, (y + 1) * row), (img.height - 1 - y) * row);
  }
  return out;
}

/** Pad (or crop) the canvas to a given size, placing the image according to `anchor`. */
export function resizeCanvas(
  img: RGBAImage,
  width: number,
  height: number,
  anchor: 'center' | 'top-left' | 'bottom-center' = 'center',
): RGBAImage {
  const out = createImage(width, height);
  let dx = 0, dy = 0;
  if (anchor === 'center') {
    dx = Math.floor((width - img.width) / 2);
    dy = Math.floor((height - img.height) / 2);
  } else if (anchor === 'bottom-center') {
    dx = Math.floor((width - img.width) / 2);
    dy = height - img.height;
  }
  blit(out, img, dx, dy);
  return out;
}

/** Count unique opaque colors (alpha > 0). */
export function countColors(img: RGBAImage): number {
  const set = new Set<number>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    set.add(((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) >>> 0);
  }
  return set.size;
}

export function imagesEqual(a: RGBAImage, b: RGBAImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}
