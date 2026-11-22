import sharp from 'sharp';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { RGBAImage } from '@sprixy/core';
import { upscaleInteger } from '@sprixy/core';
import { badRequest } from './errors.js';

/** Decode any image (PNG, JPEG, WebP, GIF first frame...) into RGBA. */
export async function decodeImage(buf: Buffer | Uint8Array): Promise<RGBAImage> {
  try {
    const { data, info } = await sharp(buf, { animated: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
  } catch (e) {
    throw badRequest(`Unable to decode image: ${(e as Error).message}`);
  }
}

function rawInput(img: RGBAImage) {
  return { raw: { width: img.width, height: img.height, channels: 4 as const } };
}

export async function encodePng(img: RGBAImage, scale = 1): Promise<Buffer> {
  const src = scale > 1 ? upscaleInteger(img, scale) : img;
  return sharp(Buffer.from(src.data.buffer, src.data.byteOffset, src.data.byteLength), rawInput(src))
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

export async function encodeWebp(img: RGBAImage, scale = 1): Promise<Buffer> {
  const src = scale > 1 ? upscaleInteger(img, scale) : img;
  return sharp(Buffer.from(src.data.buffer, src.data.byteOffset, src.data.byteLength), rawInput(src)).webp({ lossless: true }).toBuffer();
}

/** Animated WebP from equally sized frames. */
export async function encodeAnimatedWebp(frames: RGBAImage[], durationsMs: number[], scale = 1, loop = 0): Promise<Buffer> {
  if (frames.length === 0) throw badRequest('No frames');
  const fs = scale > 1 ? frames.map((f) => upscaleInteger(f, scale)) : frames;
  const w = fs[0].width, h = fs[0].height;
  const stacked = Buffer.alloc(w * h * 4 * fs.length);
  fs.forEach((f, i) => {
    if (f.width !== w || f.height !== h) throw badRequest('All frames must have the same size');
    Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength).copy(stacked, i * w * h * 4);
  });
  return sharp(stacked, { raw: { width: w, height: h * fs.length, channels: 4, pageHeight: h } as never })
    .webp({ lossless: true, loop, delay: durationsMs.map((d) => Math.max(20, Math.round(d))) })
    .toBuffer();
}

/** Animated GIF with 1-bit transparency (perfect for pixel art). */
export function encodeGif(frames: RGBAImage[], durationsMs: number[], scale = 1, loop = 0): Buffer {
  if (frames.length === 0) throw badRequest('No frames');
  const gif = GIFEncoder();
  frames.forEach((frame, i) => {
    const f = scale > 1 ? upscaleInteger(frame, scale) : frame;
    const rgba = new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength);
    const palette = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true, clearAlpha: true, clearAlphaThreshold: 127 });
    const index = applyPalette(rgba, palette, 'rgba4444');
    const transparentIndex = palette.findIndex((c: number[]) => c[3] === 0);
    gif.writeFrame(index, f.width, f.height, {
      palette,
      delay: Math.max(20, Math.round(durationsMs[i] ?? 100)),
      repeat: loop === 0 ? 0 : loop,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: 2,
    });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

/** Flatten transparency onto a solid color (needed before sending sprites to video models). */
export function flattenOnColor(img: RGBAImage, color: [number, number, number]): RGBAImage {
  const out = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    d[i] = Math.round(d[i] * a + color[0] * (1 - a));
    d[i + 1] = Math.round(d[i + 1] * a + color[1] * (1 - a));
    d[i + 2] = Math.round(d[i + 2] * a + color[2] * (1 - a));
    d[i + 3] = 255;
  }
  return out;
}

export async function fetchBinary(url: string, init?: RequestInit): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const meta = url.slice(5, comma);
    const payload = url.slice(comma + 1);
    return meta.includes(';base64') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export function toDataUri(buf: Buffer, mime = 'image/png'): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}
