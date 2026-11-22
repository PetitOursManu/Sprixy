/** Pure pixel operations on a single cel (RGBA buffer). `color === null` erases. */
import type { RGBA } from './doc';

export function inBounds(w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

export function getRGBA(cel: Uint8ClampedArray, w: number, x: number, y: number): RGBA {
  const i = (y * w + x) * 4;
  return [cel[i], cel[i + 1], cel[i + 2], cel[i + 3]];
}

function put(cel: Uint8ClampedArray, w: number, h: number, x: number, y: number, color: RGBA | null): void {
  if (!inBounds(w, h, x, y)) return;
  const i = (y * w + x) * 4;
  if (color === null) {
    cel[i] = cel[i + 1] = cel[i + 2] = cel[i + 3] = 0;
  } else {
    cel[i] = color[0]; cel[i + 1] = color[1]; cel[i + 2] = color[2]; cel[i + 3] = color[3];
  }
}

/** Square brush of `size` pixels centred on (x, y); optionally mirrored horizontally. */
export function plot(cel: Uint8ClampedArray, w: number, h: number, x: number, y: number, size: number, color: RGBA | null, mirrorX = false): void {
  const off = Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const px = x - off + dx, py = y - off + dy;
      put(cel, w, h, px, py, color);
      if (mirrorX) put(cel, w, h, w - 1 - px, py, color);
    }
  }
}

/** Bresenham line, calling `cb` for every pixel (inclusive). */
export function bresenham(x0: number, y0: number, x1: number, y1: number, cb: (x: number, y: number) => void): void {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cb(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function drawLine(cel: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, x1: number, y1: number, size: number, color: RGBA | null, mirrorX = false): void {
  bresenham(x0, y0, x1, y1, (x, y) => plot(cel, w, h, x, y, size, color, mirrorX));
}

export function drawRect(cel: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, x1: number, y1: number, size: number, color: RGBA | null, filled: boolean, mirrorX = false): void {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  if (filled) {
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) plot(cel, w, h, x, y, 1, color, mirrorX);
    return;
  }
  drawLine(cel, w, h, ax, ay, bx, ay, size, color, mirrorX);
  drawLine(cel, w, h, ax, by, bx, by, size, color, mirrorX);
  drawLine(cel, w, h, ax, ay, ax, by, size, color, mirrorX);
  drawLine(cel, w, h, bx, ay, bx, by, size, color, mirrorX);
}

function same(cel: Uint8ClampedArray, i: number, t: RGBA): boolean {
  if (cel[i + 3] === 0 && t[3] === 0) return true; // every transparent pixel is "the same"
  return cel[i] === t[0] && cel[i + 1] === t[1] && cel[i + 2] === t[2] && cel[i + 3] === t[3];
}

/** Bucket fill: contiguous (4-connected) or global (every pixel of the same color). Returns true if anything changed. */
export function floodFill(cel: Uint8ClampedArray, w: number, h: number, x: number, y: number, color: RGBA | null, global = false): boolean {
  if (!inBounds(w, h, x, y)) return false;
  const target = getRGBA(cel, w, x, y);
  const fill: RGBA = color ?? [0, 0, 0, 0];
  const noop = (fill[3] === 0 && target[3] === 0) || (fill[0] === target[0] && fill[1] === target[1] && fill[2] === target[2] && fill[3] === target[3]);
  if (noop) return false;
  if (global) {
    let changed = false;
    for (let i = 0; i < cel.length; i += 4) {
      if (same(cel, i, target)) {
        cel[i] = fill[0]; cel[i + 1] = fill[1]; cel[i + 2] = fill[2]; cel[i + 3] = fill[3];
        changed = true;
      }
    }
    return changed;
  }
  const visited = new Uint8Array(w * h);
  const stack = [y * w + x];
  let changed = false;
  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (!same(cel, i, target)) continue;
    cel[i] = fill[0]; cel[i + 1] = fill[1]; cel[i + 2] = fill[2]; cel[i + 3] = fill[3];
    changed = true;
    const px = p % w, py = (p - px) / w;
    if (px > 0) stack.push(p - 1);
    if (px < w - 1) stack.push(p + 1);
    if (py > 0) stack.push(p - w);
    if (py < h - 1) stack.push(p + w);
  }
  return changed;
}

export interface Rect { x: number; y: number; w: number; h: number }

export function normRect(x0: number, y0: number, x1: number, y1: number, w: number, h: number): Rect | null {
  const ax = Math.max(0, Math.min(x0, x1)), ay = Math.max(0, Math.min(y0, y1));
  const bx = Math.min(w - 1, Math.max(x0, x1)), by = Math.min(h - 1, Math.max(y0, y1));
  if (bx < ax || by < ay) return null;
  return { x: ax, y: ay, w: bx - ax + 1, h: by - ay + 1 };
}

export function copyRect(cel: Uint8ClampedArray, w: number, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const s = ((r.y + y) * w + r.x) * 4;
    out.set(cel.subarray(s, s + r.w * 4), y * r.w * 4);
  }
  return out;
}

export function clearRect(cel: Uint8ClampedArray, w: number, r: Rect): void {
  for (let y = 0; y < r.h; y++) {
    const s = ((r.y + y) * w + r.x) * 4;
    cel.fill(0, s, s + r.w * 4);
  }
}

/** Paste `src` (sw×sh) at (dx, dy); transparent source pixels keep the destination. */
export function pasteOver(cel: Uint8ClampedArray, w: number, h: number, src: Uint8ClampedArray, sw: number, sh: number, dx: number, dy: number): void {
  for (let y = 0; y < sh; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= h) continue;
    for (let x = 0; x < sw; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= w) continue;
      const si = (y * sw + x) * 4;
      if (src[si + 3] === 0) continue;
      const di = (ty * w + tx) * 4;
      cel[di] = src[si]; cel[di + 1] = src[si + 1]; cel[di + 2] = src[si + 2]; cel[di + 3] = src[si + 3];
    }
  }
}
