import type { RGBAImage, Rect } from './image.js';
import { createImage, crop, blit, contentBounds } from './image.js';

export interface Frame {
  name: string;
  rect: Rect;
  /** Display duration in milliseconds (animations). */
  duration?: number;
}

export interface SliceGridOptions {
  /** Either frame size... */
  frameWidth?: number;
  frameHeight?: number;
  /** ...or a column / row count. */
  columns?: number;
  rows?: number;
  margin?: number;
  spacing?: number;
  /** Skip fully transparent cells. */
  skipEmpty?: boolean;
}

/** Cut a sheet into a regular grid of frames. */
export function sliceGrid(img: RGBAImage, opts: SliceGridOptions): { frames: Frame[]; images: RGBAImage[] } {
  const margin = opts.margin ?? 0, spacing = opts.spacing ?? 0;
  let fw = opts.frameWidth ?? 0, fh = opts.frameHeight ?? 0;
  if (!fw) {
    if (!opts.columns) throw new Error('sliceGrid needs frameWidth or columns');
    fw = Math.floor((img.width - margin * 2 - spacing * (opts.columns - 1)) / opts.columns);
  }
  if (!fh) {
    if (!opts.rows) throw new Error('sliceGrid needs frameHeight or rows');
    fh = Math.floor((img.height - margin * 2 - spacing * (opts.rows - 1)) / opts.rows);
  }
  if (fw <= 0 || fh <= 0) throw new Error('Invalid frame size');
  const cols = opts.columns ?? Math.floor((img.width - margin * 2 + spacing) / (fw + spacing));
  const rows = opts.rows ?? Math.floor((img.height - margin * 2 + spacing) / (fh + spacing));
  const frames: Frame[] = [];
  const images: RGBAImage[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rect = { x: margin + c * (fw + spacing), y: margin + r * (fh + spacing), w: fw, h: fh };
      const im = crop(img, rect);
      if (opts.skipEmpty && !contentBounds(im)) continue;
      frames.push({ name: `frame_${frames.length}`, rect });
      images.push(im);
    }
  }
  return { frames, images };
}

/**
 * Automatically detect sprites on a transparent sheet using connected components,
 * merging nearby components (e.g. a sword detached from its character).
 */
export function autoSlice(img: RGBAImage, opts: { mergeDistance?: number; minArea?: number; alphaThreshold?: number } = {}): { frames: Frame[]; images: RGBAImage[] } {
  const { width: w, height: h, data: d } = img;
  const thr = opts.alphaThreshold ?? 0;
  const labels = new Int32Array(w * h).fill(-1);
  const boxes: { x0: number; y0: number; x1: number; y1: number; area: number }[] = [];
  const stack: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (labels[p] !== -1 || d[p * 4 + 3] <= thr) continue;
    const id = boxes.length;
    const box = { x0: w, y0: h, x1: -1, y1: -1, area: 0 };
    stack.push(p);
    labels[p] = id;
    while (stack.length) {
      const q = stack.pop()!;
      const x = q % w, y = (q - x) / w;
      box.area++;
      if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (labels[n] !== -1 || d[n * 4 + 3] <= thr) continue;
          labels[n] = id;
          stack.push(n);
        }
      }
    }
    boxes.push(box);
  }
  const merge = opts.mergeDistance ?? 2;
  let merged = boxes.slice();
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i], b = merged[j];
        if (a.x0 - merge <= b.x1 && b.x0 - merge <= a.x1 && a.y0 - merge <= b.y1 && b.y0 - merge <= a.y1) {
          merged[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), area: a.area + b.area };
          merged.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  const minArea = opts.minArea ?? 4;
  merged = merged.filter((b) => b.area >= minArea);
  // Sort in reading order: group into rows by vertical overlap.
  merged.sort((a, b) => a.y0 - b.y0);
  const rows: (typeof merged)[] = [];
  for (const b of merged) {
    const row = rows.find((r) => r.some((o) => b.y0 <= o.y1 && o.y0 <= b.y1));
    if (row) row.push(b); else rows.push([b]);
  }
  const ordered = rows.flatMap((r) => r.sort((a, b) => a.x0 - b.x0));
  const frames: Frame[] = ordered.map((b, i) => ({ name: `frame_${i}`, rect: { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 } }));
  return { frames, images: frames.map((f) => crop(img, f.rect)) };
}

export type AlignMode = 'center' | 'bottom' | 'none';

/**
 * Normalize frames to a common size, aligning their content (bounding box) on a shared anchor.
 * 'bottom' keeps feet on the same baseline — the usual choice for character animations.
 */
export function alignFrames(images: RGBAImage[], opts: { mode?: AlignMode; padding?: number; width?: number; height?: number } = {}): RGBAImage[] {
  if (images.length === 0) return [];
  const mode = opts.mode ?? 'bottom';
  const pad = opts.padding ?? 0;
  if (mode === 'none') {
    const W = opts.width ?? Math.max(...images.map((i) => i.width));
    const H = opts.height ?? Math.max(...images.map((i) => i.height));
    return images.map((im) => { const o = createImage(W, H); blit(o, im, 0, 0); return o; });
  }
  const parts = images.map((im) => {
    const b = contentBounds(im);
    return b ? crop(im, b) : createImage(1, 1);
  });
  const W = opts.width ?? Math.max(...parts.map((p) => p.width)) + pad * 2;
  const H = opts.height ?? Math.max(...parts.map((p) => p.height)) + pad * 2;
  return parts.map((p) => {
    const o = createImage(W, H);
    const x = Math.floor((W - p.width) / 2);
    const y = mode === 'center' ? Math.floor((H - p.height) / 2) : H - pad - p.height;
    blit(o, p, x, y);
    return o;
  });
}

export interface PackOptions {
  columns?: number;
  padding?: number;
  /** Extrude-free spacing between frames (px). */
  spacing?: number;
  names?: string[];
  durations?: number[];
}

/** Pack frames into a sheet. Uniform-size frames are laid on a grid; otherwise a shelf packer is used. */
export function packSheet(images: RGBAImage[], opts: PackOptions = {}): { image: RGBAImage; frames: Frame[]; columns: number; rows: number } {
  if (images.length === 0) throw new Error('No frames to pack');
  const spacing = opts.spacing ?? 0;
  const padding = opts.padding ?? 0;
  const uniform = images.every((i) => i.width === images[0].width && i.height === images[0].height);
  const frames: Frame[] = [];
  if (uniform) {
    const fw = images[0].width, fh = images[0].height;
    const cols = Math.max(1, Math.min(images.length, opts.columns ?? Math.ceil(Math.sqrt(images.length))));
    const rows = Math.ceil(images.length / cols);
    const sheet = createImage(padding * 2 + cols * fw + (cols - 1) * spacing, padding * 2 + rows * fh + (rows - 1) * spacing);
    images.forEach((im, i) => {
      const x = padding + (i % cols) * (fw + spacing);
      const y = padding + Math.floor(i / cols) * (fh + spacing);
      blit(sheet, im, x, y);
      frames.push({ name: opts.names?.[i] ?? `frame_${i}`, rect: { x, y, w: fw, h: fh }, duration: opts.durations?.[i] });
    });
    return { image: sheet, frames, columns: cols, rows };
  }
  // Shelf packing, width bounded by sqrt(total area)
  const area = images.reduce((s, i) => s + (i.width + spacing) * (i.height + spacing), 0);
  const maxW = Math.max(Math.ceil(Math.sqrt(area) * 1.2), ...images.map((i) => i.width));
  let x = padding, y = padding, shelfH = 0, sheetW = 0;
  const pos: { x: number; y: number }[] = [];
  for (const im of images) {
    if (x + im.width > maxW + padding && x > padding) { x = padding; y += shelfH + spacing; shelfH = 0; }
    pos.push({ x, y });
    x += im.width + spacing;
    shelfH = Math.max(shelfH, im.height);
    sheetW = Math.max(sheetW, x - spacing);
  }
  const sheet = createImage(sheetW + padding, y + shelfH + padding);
  images.forEach((im, i) => {
    blit(sheet, im, pos[i].x, pos[i].y);
    frames.push({ name: opts.names?.[i] ?? `frame_${i}`, rect: { x: pos[i].x, y: pos[i].y, w: im.width, h: im.height }, duration: opts.durations?.[i] });
  });
  return { image: sheet, frames, columns: 0, rows: 0 };
}
