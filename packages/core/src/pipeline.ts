/**
 * Declarative, deterministic processing pipeline. Every step is free (no AI call) and runs
 * identically on the server, in the browser editor and through the MCP / REST API.
 */
import type { RGBAImage } from './image.js';
import { trim, flipHorizontal, flipVertical, resizeCanvas, crop } from './image.js';
import { hexToRgb } from './color.js';
import { applyPalette, reduceColors, paletteFromHex, type DitherMode } from './quantize.js';
import { resizeNearest, upscaleInteger } from './resize.js';
import { pixelize, type CellSampling } from './pixelize.js';
import { removeBackgroundFlood, chromaKey, hardenAlpha } from './background.js';
import { removeOrphans, fillPinholes, despeckle, addOutline } from './outline.js';
import { adjustHsl, replaceColors, paletteSwap, brightnessContrast } from './recolor.js';
import { makeSeamless } from './tile.js';
import { getPalettePreset } from './palettes.js';

export type ProcessStep =
  | { op: 'removeBackground'; tolerance?: number; global?: boolean }
  | { op: 'chromaKey'; color: string; tolerance?: number }
  | { op: 'hardenAlpha'; threshold?: number }
  | { op: 'pixelize'; width?: number; height?: number; sampling?: CellSampling }
  | { op: 'resize'; width: number; height: number }
  | { op: 'scale'; factor: number }
  | { op: 'reduceColors'; maxColors: number; dither?: DitherMode; ditherStrength?: number }
  | { op: 'applyPalette'; palette?: string[]; presetId?: string; dither?: DitherMode; ditherStrength?: number }
  | { op: 'removeOrphans'; minNeighbors?: number }
  | { op: 'fillPinholes' }
  | { op: 'despeckle' }
  | { op: 'outline'; color?: string | 'auto'; mode?: 'outer' | 'inner'; diagonal?: boolean }
  | { op: 'trim'; padding?: number }
  | { op: 'canvas'; width: number; height: number; anchor?: 'center' | 'top-left' | 'bottom-center' }
  | { op: 'crop'; x: number; y: number; width: number; height: number }
  | { op: 'flip'; direction: 'horizontal' | 'vertical' }
  | { op: 'hsl'; hue?: number; saturation?: number; lightness?: number }
  | { op: 'brightnessContrast'; brightness?: number; contrast?: number }
  | { op: 'replaceColors'; mapping: Record<string, string> }
  | { op: 'paletteSwap'; palette?: string[]; presetId?: string }
  | { op: 'seamless'; band?: number };

export type ProcessOp = ProcessStep['op'];

function resolvePalette(step: { palette?: string[]; presetId?: string }): string[] {
  if (step.palette && step.palette.length) return step.palette;
  if (step.presetId) {
    const p = getPalettePreset(step.presetId);
    if (!p) throw new Error(`Unknown palette preset "${step.presetId}"`);
    return p.colors;
  }
  throw new Error('A palette (hex list) or presetId is required');
}

export function runStep(img: RGBAImage, step: ProcessStep): RGBAImage {
  switch (step.op) {
    case 'removeBackground': return removeBackgroundFlood(img, { tolerance: step.tolerance, global: step.global });
    case 'chromaKey': return chromaKey(img, hexToRgb(step.color), step.tolerance);
    case 'hardenAlpha': return hardenAlpha(img, step.threshold);
    case 'pixelize': return pixelize(img, { width: step.width, height: step.height, sampling: step.sampling });
    case 'resize': return resizeNearest(img, step.width, step.height);
    case 'scale': return step.factor >= 1 ? upscaleInteger(img, step.factor) : resizeNearest(img, img.width * step.factor, img.height * step.factor);
    case 'reduceColors': return reduceColors(img, step.maxColors, { dither: step.dither, ditherStrength: step.ditherStrength }).image;
    case 'applyPalette': return applyPalette(img, paletteFromHex(resolvePalette(step)), { dither: step.dither, ditherStrength: step.ditherStrength });
    case 'removeOrphans': return removeOrphans(img, step.minNeighbors);
    case 'fillPinholes': return fillPinholes(img);
    case 'despeckle': return despeckle(img);
    case 'outline': {
      const color = !step.color || step.color === 'auto' ? (step.color === 'auto' ? 'auto' : undefined) : ([...hexToRgb(step.color), 255] as [number, number, number, number]);
      return addOutline(img, { color, mode: step.mode, diagonal: step.diagonal });
    }
    case 'trim': return trim(img, step.padding);
    case 'canvas': return resizeCanvas(img, step.width, step.height, step.anchor);
    case 'crop': return crop(img, { x: step.x, y: step.y, w: step.width, h: step.height });
    case 'flip': return step.direction === 'horizontal' ? flipHorizontal(img) : flipVertical(img);
    case 'hsl': return adjustHsl(img, step);
    case 'brightnessContrast': return brightnessContrast(img, step.brightness, step.contrast);
    case 'replaceColors': return replaceColors(img, step.mapping);
    case 'paletteSwap': return paletteSwap(img, resolvePalette(step));
    case 'seamless': return makeSeamless(img, step.band);
    default: {
      const never: never = step;
      throw new Error(`Unknown process op ${(never as { op: string }).op}`);
    }
  }
}

export function runPipeline(img: RGBAImage, steps: ProcessStep[]): RGBAImage {
  return steps.reduce((acc, s) => runStep(acc, s), img);
}

/** Human-readable catalogue of operations (used by UI forms, REST docs and MCP tool descriptions). */
export const PROCESS_OPS: { op: ProcessOp; label: string; description: string; params: Record<string, string> }[] = [
  { op: 'removeBackground', label: 'Remove background', description: 'Flood-fill from the borders and clear pixels matching the background color (free, deterministic).', params: { tolerance: 'number 0-100 (default 12)', global: 'boolean — remove matching color everywhere' } },
  { op: 'chromaKey', label: 'Chroma key', description: 'Make a given color transparent.', params: { color: 'hex', tolerance: 'number 0-100' } },
  { op: 'hardenAlpha', label: 'Harden alpha', description: 'Binarize alpha (pixel art has no semi-transparency).', params: { threshold: 'number 0-255 (default 127)' } },
  { op: 'pixelize', label: 'Pixelize to grid', description: 'Snap onto a true pixel grid. With width/height: exact output size; without: auto-detect the pseudo-pixel grid.', params: { width: 'int', height: 'int', sampling: 'mode | center | average' } },
  { op: 'resize', label: 'Resize (nearest)', description: 'Resize without interpolation.', params: { width: 'int', height: 'int' } },
  { op: 'scale', label: 'Scale (nearest)', description: 'Integer upscale or fractional downscale without interpolation.', params: { factor: 'number' } },
  { op: 'reduceColors', label: 'Reduce colors', description: 'Median-cut + k-means palette reduction.', params: { maxColors: 'int 2-256', dither: 'none | floyd-steinberg | atkinson | bayer2 | bayer4 | bayer8', ditherStrength: '0-1' } },
  { op: 'applyPalette', label: 'Apply palette', description: 'Map colors to a fixed palette (custom hex list or preset).', params: { palette: 'hex[]', presetId: 'pico-8 | db16 | db32 | endesga-32 | sweetie-16 | resurrect-64 | gameboy | nes | apollo', dither: 'dither mode', ditherStrength: '0-1' } },
  { op: 'removeOrphans', label: 'Remove orphan pixels', description: 'Delete isolated opaque pixels.', params: { minNeighbors: 'int 1-8 (default 1)' } },
  { op: 'fillPinholes', label: 'Fill pinholes', description: 'Fill single transparent holes inside the sprite.', params: {} },
  { op: 'despeckle', label: 'Despeckle', description: 'Replace single off-color pixels by their dominant neighbour color.', params: {} },
  { op: 'outline', label: 'Outline', description: 'Add a 1px outline (outer grows canvas by 1px per side; inner recolors edge pixels).', params: { color: "hex | 'auto'", mode: 'outer | inner', diagonal: 'boolean' } },
  { op: 'trim', label: 'Trim', description: 'Crop to content bounds.', params: { padding: 'int' } },
  { op: 'canvas', label: 'Canvas size', description: 'Pad/crop canvas to a size.', params: { width: 'int', height: 'int', anchor: 'center | top-left | bottom-center' } },
  { op: 'crop', label: 'Crop', description: 'Crop a rectangle.', params: { x: 'int', y: 'int', width: 'int', height: 'int' } },
  { op: 'flip', label: 'Flip', description: 'Mirror the image.', params: { direction: 'horizontal | vertical' } },
  { op: 'hsl', label: 'Hue / Saturation / Lightness', description: 'Shift hue (degrees), scale saturation, offset lightness.', params: { hue: 'degrees', saturation: 'multiplier', lightness: '-1..1' } },
  { op: 'brightnessContrast', label: 'Brightness / Contrast', description: 'Adjust brightness and contrast.', params: { brightness: '-1..1', contrast: '-1..1' } },
  { op: 'replaceColors', label: 'Replace colors', description: 'Exact color mapping.', params: { mapping: '{ "#from": "#to" }' } },
  { op: 'paletteSwap', label: 'Palette swap (recolor)', description: 'Recolor by mapping luminance ramps onto a target palette.', params: { palette: 'hex[]', presetId: 'preset id' } },
  { op: 'seamless', label: 'Make seamless', description: 'Cross-fade borders so the texture tiles.', params: { band: 'int px' } },
];
