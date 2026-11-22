import { z } from 'zod';
import type { ProcessStep, DitherMode } from '@sprixy/core';
import { getPalettePreset } from '@sprixy/core';

export const ASSET_KINDS = ['sprite', 'character', 'object', 'environment', 'tileset', 'texture', 'ui', 'icon', 'spritesheet', 'animation', 'import'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const GENERATABLE_KINDS = ['sprite', 'character', 'object', 'environment', 'tileset', 'texture', 'ui', 'icon'] as const;
export type GeneratableKind = (typeof GENERATABLE_KINDS)[number];

const size = z.object({ width: z.number().int().min(4).max(1024), height: z.number().int().min(4).max(1024) });

export const artDirectionSchema = z.object({
  palette: z
    .object({
      presetId: z.string().optional(),
      colors: z.array(z.string().regex(/^#?[0-9a-fA-F]{6}$/)).max(256).default([]),
      /** Force every generated asset onto this palette. */
      enforce: z.boolean().default(true),
      /** When no palette is set: max colors after reduction. */
      maxColors: z.number().int().min(2).max(256).default(24),
    })
    .default({ colors: [], enforce: true, maxColors: 24 }),
  referenceAssetIds: z.array(z.string()).max(4).default([]),
  models: z
    .object({
      image: z.string().optional(),
      edit: z.string().optional(),
      animate: z.string().optional(),
      removeBg: z.string().optional(),
    })
    .default({}),
  loras: z.array(z.object({ loraId: z.string(), scale: z.number().min(0).max(4) })).max(3).default([]),
  spriteSize: size.default({ width: 32, height: 32 }),
  iconSize: size.default({ width: 16, height: 16 }),
  tileSize: z.number().int().min(4).max(256).default(16),
  sceneSize: size.default({ width: 320, height: 180 }),
  perspective: z.enum(['side', 'top-down', 'three-quarter', 'isometric', 'front']).default('side'),
  lighting: z.enum(['flat', 'top-left', 'top-right', 'top', 'rim', 'dramatic', 'ambient']).default('top-left'),
  shading: z.enum(['flat', 'cel', 'soft', 'dithered']).default('cel'),
  detail: z.enum(['minimal', 'low', 'medium', 'high']).default('medium'),
  outline: z.enum(['none', 'black', 'dark-colored', 'selective']).default('dark-colored'),
  dither: z.enum(['none', 'floyd-steinberg', 'atkinson', 'bayer2', 'bayer4', 'bayer8']).default('none'),
  styleNotes: z.string().max(1000).default(''),
  negativePrompt: z.string().max(1000).default(''),
});

export type ArtDirection = z.infer<typeof artDirectionSchema>;

export function normalizeArtDirection(input: unknown): ArtDirection {
  const parsed = artDirectionSchema.safeParse(input ?? {});
  return parsed.success ? parsed.data : artDirectionSchema.parse({});
}

/** Effective palette (explicit colors win over preset). */
export function paletteOf(ad: ArtDirection): string[] {
  if (ad.palette.colors.length) return ad.palette.colors.map((c) => (c.startsWith('#') ? c : `#${c}`));
  if (ad.palette.presetId) return getPalettePreset(ad.palette.presetId)?.colors ?? [];
  return [];
}

/** Key color used as generation background so the free flood-fill remover can cut sprites out. */
export const KEY_BG = { name: 'magenta', hex: '#ff00ff', rgb: [255, 0, 255] as [number, number, number] };

const PERSPECTIVE: Record<ArtDirection['perspective'], string> = {
  side: 'side view (2D platformer perspective)',
  'top-down': 'top-down view (orthographic, seen from above)',
  'three-quarter': '3/4 top-down view (classic JRPG perspective)',
  isometric: 'isometric view (2:1 isometric pixel art)',
  front: 'front view',
};
const LIGHTING: Record<ArtDirection['lighting'], string> = {
  flat: 'flat even lighting',
  'top-left': 'light source from the top-left',
  'top-right': 'light source from the top-right',
  top: 'light from above',
  rim: 'rim lighting',
  dramatic: 'dramatic high-contrast lighting',
  ambient: 'soft ambient lighting',
};
const SHADING: Record<ArtDirection['shading'], string> = {
  flat: 'flat colors, no shading',
  cel: 'cel shading with 2-3 tones per color',
  soft: 'soft hand-placed shading',
  dithered: 'dithered shading',
};
const DETAIL: Record<ArtDirection['detail'], string> = {
  minimal: 'minimalist, very few details, readable silhouette',
  low: 'low detail, chunky shapes',
  medium: 'moderate detail',
  high: 'highly detailed pixel work',
};
const OUTLINE: Record<ArtDirection['outline'], string> = {
  none: 'no outline',
  black: 'clean 1-pixel black outline',
  'dark-colored': '1-pixel outline in darker shades of each color',
  selective: 'selective outlining (sel-out)',
};

export interface KindSpec {
  transparent: boolean;
  label: string;
  template: (subject: string, ad: ArtDirection, size: { width: number; height: number }) => string;
  defaultSize: (ad: ArtDirection) => { width: number; height: number };
  anchor: 'center' | 'bottom-center';
  seamless?: boolean;
}

export const KIND_SPECS: Record<GeneratableKind, KindSpec> = {
  sprite: {
    transparent: true,
    label: 'Sprite',
    anchor: 'center',
    defaultSize: (ad) => ad.spriteSize,
    template: (s, ad, sz) => `pixel art game sprite of ${s}, ${sz.width}x${sz.height} pixel sprite, ${PERSPECTIVE[ad.perspective]}, single subject centered, full view`,
  },
  character: {
    transparent: true,
    label: 'Character',
    anchor: 'bottom-center',
    defaultSize: (ad) => ad.spriteSize,
    template: (s, ad, sz) => `pixel art game character sprite of ${s}, ${sz.width}x${sz.height} pixel character, ${PERSPECTIVE[ad.perspective]}, full body, standing idle pose, centered, single character`,
  },
  object: {
    transparent: true,
    label: 'Object / item',
    anchor: 'bottom-center',
    defaultSize: (ad) => ad.spriteSize,
    template: (s, ad, sz) => `pixel art game object: ${s}, ${sz.width}x${sz.height} pixel prop, ${PERSPECTIVE[ad.perspective]}, single object centered`,
  },
  icon: {
    transparent: true,
    label: 'Icon',
    anchor: 'center',
    defaultSize: (ad) => ad.iconSize,
    template: (s, _ad, sz) => `pixel art game inventory icon of ${s}, ${sz.width}x${sz.height} pixel icon, bold readable silhouette, centered, front view`,
  },
  ui: {
    transparent: true,
    label: 'UI element',
    anchor: 'center',
    defaultSize: (ad) => ({ width: ad.spriteSize.width * 2, height: ad.spriteSize.height }),
    template: (s) => `pixel art game user interface element: ${s}, flat front view, crisp edges, no text`,
  },
  environment: {
    transparent: false,
    label: 'Environment / background',
    anchor: 'center',
    defaultSize: (ad) => ad.sceneSize,
    template: (s, ad) => `pixel art game background scene: ${s}, ${PERSPECTIVE[ad.perspective]}, wide establishing view, game level backdrop, no characters, no text`,
  },
  texture: {
    transparent: false,
    label: 'Texture (tileable)',
    anchor: 'center',
    seamless: true,
    defaultSize: (ad) => ({ width: ad.tileSize * 2, height: ad.tileSize * 2 }),
    template: (s) => `seamless tileable pixel art texture of ${s}, fills the entire frame edge to edge, top-down, repeating pattern, no border`,
  },
  tileset: {
    transparent: false,
    label: 'Tileset',
    anchor: 'center',
    defaultSize: (ad) => ({ width: ad.tileSize * 8, height: ad.tileSize * 8 }),
    template: (s, ad) => `pixel art game tileset sheet for ${s}, ${PERSPECTIVE[ad.perspective]}, organized grid of ${ad.tileSize}x${ad.tileSize} tiles with ground, edges, corners and variations, aligned to a strict grid, no gaps, no text`,
  },
};

/** Compose the final prompt from the art direction (keeps every asset of a project coherent). */
export function buildPrompt(kind: GeneratableKind, subject: string, ad: ArtDirection, opts: { size: { width: number; height: number }; triggerWords?: string[]; extra?: string }): string {
  const spec = KIND_SPECS[kind];
  const palette = paletteOf(ad);
  const parts = [
    ...(opts.triggerWords ?? []).filter(Boolean),
    spec.template(subject.trim(), ad, opts.size),
    SHADING[ad.shading],
    LIGHTING[ad.lighting],
    DETAIL[ad.detail],
    spec.transparent ? OUTLINE[ad.outline] : '',
    palette.length ? `limited ${palette.length}-color palette${ad.palette.presetId ? ` (${getPalettePreset(ad.palette.presetId)?.name ?? ''} palette)` : ''}` : `limited color palette`,
    'crisp hard-edged pixels, no anti-aliasing, no blur, no gradients',
    ad.styleNotes,
    opts.extra ?? '',
    spec.transparent ? `isolated on a plain flat solid ${KEY_BG.name} (${KEY_BG.hex}) background, nothing else in the background` : '',
  ];
  return parts.filter((p) => p && p.trim()).join(', ');
}

/** Long side ~1024px, multiple of 16, same aspect as the native target size. */
export function generationSize(target: { width: number; height: number }, longSide = 1024): { width: number; height: number } {
  const r = target.width / target.height;
  let w = r >= 1 ? longSide : longSide * r;
  let h = r >= 1 ? longSide / r : longSide;
  // keep within ~1.1 MP
  const scale = Math.min(1, Math.sqrt(1_100_000 / (w * h)));
  w *= scale; h *= scale;
  return { width: Math.max(256, Math.round(w / 16) * 16), height: Math.max(256, Math.round(h / 16) * 16) };
}

export interface PostProcessOptions {
  removeBackground: 'flood' | 'ai' | 'none';
  pixelize: boolean;
  palette: 'project' | 'auto' | 'none' | 'source';
  maxColors?: number;
  outline: boolean;
  cleanup: boolean;
  seamless?: boolean;
  dither?: DitherMode;
}

/** Palette steps derived from art direction + options (deterministic). */
export function paletteSteps(ad: ArtDirection, opts: PostProcessOptions, sourcePalette?: string[]): ProcessStep[] {
  const dither = opts.dither ?? ad.dither;
  if (opts.palette === 'none') return [];
  if (opts.palette === 'source' && sourcePalette?.length) return [{ op: 'applyPalette', palette: sourcePalette, dither: 'none' }];
  const pal = paletteOf(ad);
  if (opts.palette === 'project' && pal.length && ad.palette.enforce) return [{ op: 'applyPalette', palette: pal, dither }];
  return [{ op: 'reduceColors', maxColors: opts.maxColors ?? ad.palette.maxColors, dither }];
}
