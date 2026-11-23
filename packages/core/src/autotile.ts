import type { RGBAImage } from './image.js';
import { createImage } from './image.js';
import { rgbToHsl, hslToRgb } from './color.js';

/** Corner terrain of a Wang tile: 0 = lower terrain (A), 1 = upper terrain (B). */
export interface WangTile {
  index: number;
  col: number;
  row: number;
  corners: { nw: 0 | 1; ne: 0 | 1; sw: 0 | 1; se: 0 | 1 };
}

export interface WangOptions {
  tileSize: number;
  /** Deterministic seed for the organic border shape. */
  seed?: number;
  /** 0..1 — how wavy the transition is (0 = straight diagonal/bilinear edges). */
  roughness?: number;
  /** Darken upper-terrain pixels along the border (classic grass/cliff lip). */
  edge?: boolean;
  columns?: number;
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise in [-1, 1]. */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * s(fx), bot = c + (d - c) * s(fx);
  return (top + (bot - top) * s(fy)) * 2 - 1;
}

function sampleWrapped(tex: RGBAImage, x: number, y: number): [number, number, number, number] {
  const tx = ((x % tex.width) + tex.width) % tex.width;
  const ty = ((y % tex.height) + tex.height) % tex.height;
  const i = (ty * tex.width + tx) * 4;
  return [tex.data[i], tex.data[i + 1], tex.data[i + 2], tex.data[i + 3]];
}

/**
 * Build a 16-tile Wang corner tileset (2 terrains) from two seamless textures.
 * Tile index = NW·1 + NE·2 + SW·4 + SE·8 (1 = upper terrain). Borders between tiles always line up because
 * the terrain field depends only on corner values on tile edges; noise is windowed to zero on the edges and
 * only shapes the interior, so any valid placement of tiles is seamless.
 */
export function buildWangTileset(lower: RGBAImage, upper: RGBAImage, opts: WangOptions): { image: RGBAImage; tiles: WangTile[]; columns: number; rows: number } {
  const T = Math.max(4, Math.floor(opts.tileSize));
  const cols = opts.columns ?? 4;
  const rows = Math.ceil(16 / cols);
  const seed = opts.seed ?? 1;
  const rough = Math.max(0, Math.min(1, opts.roughness ?? 0.55));
  const out = createImage(T * cols, T * rows);
  const tiles: WangTile[] = [];
  const darkCache = new Map<number, [number, number, number]>();
  const darken = (r: number, g: number, b: number): [number, number, number] => {
    const k = (r << 16) | (g << 8) | b;
    let v = darkCache.get(k);
    if (!v) { const [h, s, l] = rgbToHsl(r, g, b); v = hslToRgb(h, Math.min(1, s * 1.05), l * 0.7); darkCache.set(k, v); }
    return v;
  };

  for (let index = 0; index < 16; index++) {
    const nw = (index & 1) as 0 | 1, ne = ((index >> 1) & 1) as 0 | 1, sw = ((index >> 2) & 1) as 0 | 1, se = ((index >> 3) & 1) as 0 | 1;
    const col = index % cols, row = Math.floor(index / cols);
    tiles.push({ index, col, row, corners: { nw, ne, sw, se } });
    const ox = col * T, oy = row * T;
    const mask = new Uint8Array(T * T);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const u = (x + 0.5) / T, v = (y + 0.5) / T;
        const top = nw + (ne - nw) * u, bot = sw + (se - sw) * u;
        let f = top + (bot - top) * v;
        // Organic interior: noise vanishes on tile borders so neighbours always match.
        const window = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
        f += rough * 0.45 * window * (valueNoise(x / (T / 3), y / (T / 3), seed + index * 7) * 0.7 + valueNoise(x / (T / 7), y / (T / 7), seed + 99 + index) * 0.3);
        mask[y * T + x] = f >= 0.5 ? 1 : 0;
      }
    }
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const isUpper = mask[y * T + x] === 1;
        let [r, g, b, a] = sampleWrapped(isUpper ? upper : lower, ox + x, oy + y);
        if (isUpper && opts.edge !== false) {
          // Lip: upper pixel whose lower neighbour (or any 4-neighbour inside the tile) is lower terrain.
          const near = (dx: number, dy: number) => {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= T || ny >= T) return false;
            return mask[ny * T + nx] === 0;
          };
          if (near(0, 1) || near(1, 0) || near(-1, 0) || near(0, -1)) [r, g, b] = darken(r, g, b);
        }
        const i = ((oy + y) * out.width + (ox + x)) * 4;
        out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = a;
      }
    }
  }
  return { image: out, tiles, columns: cols, rows };
}
