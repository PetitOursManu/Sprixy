import { zipSync } from 'fflate';
import { randomBytes } from 'node:crypto';
import { crop, packSheet, sliceGrid, upscaleInteger, type RGBAImage, type Frame } from '@sprixy/core';
import { encodePng, encodeGif, encodeWebp, encodeAnimatedWebp } from '../lib/images.js';
import { badRequest } from '../lib/errors.js';
import { getAssetRow, loadAssetImage, assetDto, type AssetRow } from './assets.js';

export const EXPORT_FORMATS = ['png', 'gif', 'webp', 'spritesheet', 'json', 'zip', 'godot', 'unity', 'phaser'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportOptions {
  scale?: number;
  fps?: number;
  /** For tilesets exported to Godot/Unity. */
  tileSize?: number;
  columns?: number;
}

export interface ExportResult {
  filename: string;
  mime: string;
  data: Buffer;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'asset';

interface Loaded {
  row: AssetRow;
  name: string;
  image: RGBAImage;
  frames: Frame[] | null;
  fps: number;
  tileSize?: number;
  wang?: WangMeta;
}

async function load(userId: string, id: string, opts: ExportOptions): Promise<Loaded> {
  const row = getAssetRow(userId, id);
  const dto = assetDto(row);
  return {
    row,
    name: slug(row.name),
    image: await loadAssetImage(row),
    frames: dto.frames,
    fps: opts.fps ?? (typeof dto.meta.fps === 'number' ? dto.meta.fps : 10),
    tileSize: opts.tileSize ?? (typeof dto.meta.tileSize === 'number' ? dto.meta.tileSize : undefined),
    wang: (dto.meta.wang as WangMeta | undefined) ?? undefined,
  };
}

function frameImages(a: Loaded): RGBAImage[] {
  if (a.frames?.length) return a.frames.map((f) => crop(a.image, f.rect));
  return [a.image];
}

function durations(a: Loaded): number[] {
  return (a.frames ?? [{ duration: undefined }]).map((f) => f.duration ?? Math.round(1000 / a.fps));
}

function scaledFrames(a: Loaded, scale: number): Frame[] {
  const frames = a.frames?.length ? a.frames : [{ name: 'frame_0', rect: { x: 0, y: 0, w: a.image.width, h: a.image.height } }];
  return frames.map((f) => ({ ...f, rect: { x: f.rect.x * scale, y: f.rect.y * scale, w: f.rect.w * scale, h: f.rect.h * scale } }));
}

/** TexturePacker "JSON Hash" — read natively by Phaser, PixiJS, Aseprite-compatible tooling. */
export function atlasJson(a: Loaded, imageFile: string, scale: number) {
  const frames: Record<string, unknown> = {};
  const fr = scaledFrames(a, scale);
  const ds = durations(a);
  fr.forEach((f, i) => {
    frames[f.name] = {
      frame: { x: f.rect.x, y: f.rect.y, w: f.rect.w, h: f.rect.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.rect.w, h: f.rect.h },
      sourceSize: { w: f.rect.w, h: f.rect.h },
      duration: ds[i] ?? Math.round(1000 / a.fps),
    };
  });
  return {
    frames,
    meta: {
      app: 'https://github.com/PetitOursManu/Sprixy',
      version: '1.0',
      image: imageFile,
      format: 'RGBA8888',
      size: { w: a.image.width * scale, h: a.image.height * scale },
      scale: String(scale),
      frameTags: a.frames?.length ? [{ name: a.name, from: 0, to: fr.length - 1, direction: 'forward' }] : [],
    },
  };
}

function godotSpriteFrames(a: Loaded, texPath: string, scale: number): string {
  const fr = scaledFrames(a, scale);
  const ds = durations(a);
  const subs = fr.map((f, i) => `[sub_resource type="AtlasTexture" id="AtlasTexture_${i}"]\natlas = ExtResource("1_tex")\nregion = Rect2(${f.rect.x}, ${f.rect.y}, ${f.rect.w}, ${f.rect.h})\n`).join('\n');
  const base = 1000 / a.fps;
  const framesBlock = fr.map((_, i) => `{\n"duration": ${(ds[i] / base).toFixed(3)},\n"texture": SubResource("AtlasTexture_${i}")\n}`).join(', ');
  return `[gd_resource type="SpriteFrames" load_steps=${fr.length + 2} format=3]

[ext_resource type="Texture2D" path="${texPath}" id="1_tex"]

${subs}
[resource]
animations = [{
"frames": [${framesBlock}],
"loop": true,
"name": &"${a.name}",
"speed": ${a.fps.toFixed(1)}
}]
`;
}

export interface WangMeta {
  type: 'corner';
  terrains: [string, string];
  tiles: { index: number; col: number; row: number; corners: { nw: 0 | 1; ne: 0 | 1; sw: 0 | 1; se: 0 | 1 } }[];
  columns: number;
}

function avgColor(img: RGBAImage, x0: number, y0: number, w: number, h: number): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * img.width + x) * 4;
    if (img.data[i + 3] < 128) continue;
    r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : [128, 128, 128];
}

/** Godot 4 TileSet. With Wang metadata, adds a "Match Corners" terrain set so TileMapLayer terrain painting works. */
function godotTileSet(texPath: string, img: RGBAImage, tile: number, wang?: WangMeta): string {
  const cols = Math.floor(img.width / tile), rows = Math.floor(img.height / tile);
  const tiles: string[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const t = crop(img, { x: x * tile, y: y * tile, w: tile, h: tile });
    let any = false;
    for (let i = 3; i < t.data.length; i += 4) if (t.data[i]) { any = true; break; }
    if (!any) continue;
    tiles.push(`${x}:${y}/0 = 0`);
    const w = wang?.tiles.find((wt) => wt.col === x && wt.row === y);
    if (w) {
      const c = w.corners;
      const center = c.nw + c.ne + c.sw + c.se >= 2 ? 1 : 0;
      tiles.push(
        `${x}:${y}/0/terrain_set = 0`,
        `${x}:${y}/0/terrain = ${center}`,
        `${x}:${y}/0/terrains_peering_bit/top_left_corner = ${c.nw}`,
        `${x}:${y}/0/terrains_peering_bit/top_right_corner = ${c.ne}`,
        `${x}:${y}/0/terrains_peering_bit/bottom_left_corner = ${c.sw}`,
        `${x}:${y}/0/terrains_peering_bit/bottom_right_corner = ${c.se}`,
      );
    }
  }
  let terrain = '';
  if (wang) {
    const full = (v: 0 | 1) => wang.tiles.find((t) => t.corners.nw === v && t.corners.ne === v && t.corners.sw === v && t.corners.se === v);
    const color = (v: 0 | 1) => {
      const t = full(v);
      const [r, g, b] = t ? avgColor(img, t.col * tile, t.row * tile, tile, tile) : [128, 128, 128];
      return `Color(${(r / 255).toFixed(3)}, ${(g / 255).toFixed(3)}, ${(b / 255).toFixed(3)}, 1)`;
    };
    terrain = `terrain_set_0/mode = 1
terrain_set_0/terrain_0/name = "${wang.terrains[0]}"
terrain_set_0/terrain_0/color = ${color(0)}
terrain_set_0/terrain_1/name = "${wang.terrains[1]}"
terrain_set_0/terrain_1/color = ${color(1)}
`;
  }
  return `[gd_resource type="TileSet" load_steps=3 format=3]

[ext_resource type="Texture2D" path="${texPath}" id="1_tex"]

[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]
texture = ExtResource("1_tex")
texture_region_size = Vector2i(${tile}, ${tile})
${tiles.join('\n')}

[resource]
tile_size = Vector2i(${tile}, ${tile})
${terrain}sources/0 = SubResource("TileSetAtlasSource_1")
`;
}

const xmlEsc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** Tiled tileset (.tsx) — with a corner wangset when Wang metadata exists. Phaser and many engines load Tiled maps. */
function tiledTileset(name: string, png: string, img: RGBAImage, tile: number, wang?: WangMeta): string {
  const cols = Math.floor(img.width / tile), rows = Math.floor(img.height / tile);
  const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  let wangsets = '';
  if (wang) {
    const full = (v: 0 | 1) => wang.tiles.find((t) => t.corners.nw === v && t.corners.ne === v && t.corners.sw === v && t.corners.se === v);
    const col = (v: 0 | 1) => { const t = full(v); return hex(t ? avgColor(img, t.col * tile, t.row * tile, tile, tile) : [128, 128, 128]); };
    // wangid order: top, top-right, right, bottom-right, bottom, bottom-left, left, top-left (colors are 1-based).
    const tilesXml = wang.tiles.map((t) => `   <wangtile tileid="${t.row * cols + t.col}" wangid="0,${t.corners.ne + 1},0,${t.corners.se + 1},0,${t.corners.sw + 1},0,${t.corners.nw + 1}"/>`).join('\n');
    wangsets = `
 <wangsets>
  <wangset name="${xmlEsc(name)}" type="corner" tile="-1">
   <wangcolor name="${xmlEsc(wang.terrains[0])}" color="${col(0)}" tile="${full(0) ? full(0)!.row * cols + full(0)!.col : -1}" probability="1"/>
   <wangcolor name="${xmlEsc(wang.terrains[1])}" color="${col(1)}" tile="${full(1) ? full(1)!.row * cols + full(1)!.col : -1}" probability="1"/>
${tilesXml}
  </wangset>
 </wangsets>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.11.0" name="${xmlEsc(name)}" tilewidth="${tile}" tileheight="${tile}" tilecount="${cols * rows}" columns="${cols}">
 <image source="${xmlEsc(png)}" width="${img.width}" height="${img.height}"/>${wangsets}
</tileset>
`;
}

const GODOT_IMPORT = (png: string) => `[remap]

importer="texture"
type="CompressedTexture2D"

[deps]

source_file="res://${png}"

[params]

compress/mode=0
mipmaps/generate=false
process/fix_alpha_border=false
detect_3d/compress_to=0
`;

/** Unity .meta with Point filtering, no compression, Multiple sprite mode and sprite rects (Y-up). */
function unityMeta(a: Loaded, scale: number, ppu: number): string {
  const guid = randomBytes(16).toString('hex');
  const fr = scaledFrames(a, scale);
  const H = a.image.height * scale;
  const sprites = fr.map((f, i) => `    - serializedVersion: 2
      name: ${a.name}_${i}
      rect:
        serializedVersion: 2
        x: ${f.rect.x}
        y: ${H - f.rect.y - f.rect.h}
        width: ${f.rect.w}
        height: ${f.rect.h}
      alignment: 7
      pivot: {x: 0.5, y: 0}
      border: {x: 0, y: 0, z: 0, w: 0}
      outline: []
      physicsShape: []
      tessellationDetail: 0
      bones: []
      spriteID: ${randomBytes(16).toString('hex')}
      internalID: ${21300000 + i * 2}
      vertices: []
      indices:
      edges: []
      weights: []`).join('\n');
  return `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 12
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
    sRGBTexture: 1
  isReadable: 0
  textureFormat: 1
  maxTextureSize: 2048
  textureSettings:
    serializedVersion: 2
    filterMode: 0
    aniso: 1
    mipBias: 0
    wrapU: 1
    wrapV: 1
    wrapW: 1
  nPOTScale: 0
  lightmap: 0
  compressionQuality: 50
  spriteMode: 2
  spriteExtrude: 1
  spriteMeshType: 0
  alignment: 7
  spritePivot: {x: 0.5, y: 0}
  spritePixelsToUnits: ${ppu}
  alphaUsage: 1
  alphaIsTransparency: 1
  textureType: 8
  textureShape: 1
  platformSettings:
  - serializedVersion: 3
    buildTarget: DefaultTexturePlatform
    maxTextureSize: 2048
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 0
    compressionQuality: 50
    crunchedCompression: 0
  spriteSheet:
    serializedVersion: 2
    sprites:
${sprites}
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

function phaserAnims(a: Loaded, atlasKey: string) {
  const fr = scaledFrames(a, 1);
  return {
    anims: [
      {
        key: a.name,
        type: 'frame',
        frames: fr.map((f, i) => ({ key: atlasKey, frame: f.name, duration: durations(a)[i] ?? 0 })),
        frameRate: a.fps,
        repeat: -1,
      },
    ],
  };
}

function phaserSnippet(a: Loaded): string {
  return `// Phaser 3/4 — load the atlas and animation exported by Sprixy
// preload():
this.load.atlas('${a.name}', 'assets/${a.name}.png', 'assets/${a.name}.json');
this.load.animation('${a.name}_anims', 'assets/${a.name}_anims.json');
// create():
// Pixel art: set { pixelArt: true } in your game config to keep nearest-neighbour filtering.
const sprite = this.add.sprite(100, 100, '${a.name}');
sprite.play('${a.name}');
`;
}

const enc = (s: string) => new TextEncoder().encode(s);

function readme(a: Loaded, target: string, files: string[]): string {
  return `# ${a.row.name} — exported by Sprixy for ${target}

Files:
${files.map((f) => `- ${f}`).join('\n')}

Native size: ${a.image.width}×${a.image.height}px${a.frames?.length ? `, ${a.frames.length} frames @ ${a.fps} fps` : ''}.
Pixel art tip: always use nearest-neighbour / point filtering and integer scaling.
`;
}

export async function exportAsset(userId: string, id: string, format: ExportFormat, opts: ExportOptions = {}): Promise<ExportResult> {
  const scale = Math.max(1, Math.min(32, Math.floor(opts.scale ?? 1)));
  const a = await load(userId, id, opts);
  const base = scale > 1 ? `${a.name}@${scale}x` : a.name;

  switch (format) {
    case 'png':
      return { filename: `${base}.png`, mime: 'image/png', data: await encodePng(a.image, scale) };
    case 'webp': {
      const frames = frameImages(a);
      if (frames.length > 1) return { filename: `${base}.webp`, mime: 'image/webp', data: await encodeAnimatedWebp(frames, durations(a), scale) };
      return { filename: `${base}.webp`, mime: 'image/webp', data: await encodeWebp(a.image, scale) };
    }
    case 'gif':
      return { filename: `${base}.gif`, mime: 'image/gif', data: encodeGif(frameImages(a), durations(a), scale) };
    case 'json':
      return { filename: `${base}.json`, mime: 'application/json', data: Buffer.from(JSON.stringify(atlasJson(a, `${base}.png`, scale), null, 2)) };
    case 'spritesheet': {
      // Re-pack frames (or the whole image) into a clean sheet + JSON, zipped together.
      const frames = frameImages(a);
      const sheet = packSheet(frames, { columns: opts.columns ?? Math.min(frames.length, 8), names: (a.frames ?? []).map((f) => f.name), durations: durations(a) });
      const packed: Loaded = { ...a, image: sheet.image, frames: sheet.frames };
      const zip = zipSync({
        [`${base}.png`]: new Uint8Array(await encodePng(sheet.image, scale)),
        [`${base}.json`]: enc(JSON.stringify(atlasJson(packed, `${base}.png`, scale), null, 2)),
      });
      return { filename: `${base}_spritesheet.zip`, mime: 'application/zip', data: Buffer.from(zip) };
    }
    case 'zip': {
      const frames = frameImages(a);
      const files: Record<string, Uint8Array> = {
        [`${base}.png`]: new Uint8Array(await encodePng(a.image, scale)),
        [`${base}.webp`]: new Uint8Array(frames.length > 1 ? await encodeAnimatedWebp(frames, durations(a), scale) : await encodeWebp(a.image, scale)),
        [`${base}.json`]: enc(JSON.stringify({ ...atlasJson(a, `${base}.png`, scale), sprixy: assetDto(a.row) }, null, 2)),
      };
      if (frames.length > 1) {
        files[`${base}.gif`] = new Uint8Array(encodeGif(frames, durations(a), scale));
        for (const [i, f] of frames.entries()) files[`frames/${a.name}_${String(i).padStart(3, '0')}.png`] = new Uint8Array(await encodePng(f, scale));
      }
      if (a.row.kind === 'tileset' || a.row.kind === 'texture') {
        files[`${base}.tsx`] = enc(tiledTileset(a.name, `${base}.png`, scale > 1 ? upscaleInteger(a.image, scale) : a.image, (a.tileSize ?? 16) * scale, a.wang));
      }
      return { filename: `${base}.zip`, mime: 'application/zip', data: Buffer.from(zipSync(files)) };
    }
    case 'godot': {
      const png = `${a.name}.png`;
      const files: Record<string, Uint8Array> = { [png]: new Uint8Array(await encodePng(a.image, scale)), [`${png}.import`]: enc(GODOT_IMPORT(`sprites/${png}`)) };
      const names = [png, `${png}.import`];
      if (a.row.kind === 'tileset' || a.row.kind === 'texture') {
        const tile = (a.tileSize ?? 16) * scale;
        files[`${a.name}_tileset.tres`] = enc(godotTileSet(`res://sprites/${png}`, scale > 1 ? upscaleInteger(a.image, scale) : a.image, tile, a.wang));
        names.push(`${a.name}_tileset.tres`);
      } else {
        files[`${a.name}_frames.tres`] = enc(godotSpriteFrames(a, `res://sprites/${png}`, scale));
        names.push(`${a.name}_frames.tres`);
      }
      files['README.md'] = enc(readme(a, 'Godot 4', names) + `\nCopy the files into \`res://sprites/\` (paths in the .tres files assume this folder).\nUse an AnimatedSprite2D with the SpriteFrames resource, or a TileMapLayer with the TileSet.\nProject Settings → Rendering → Textures → Default Texture Filter = Nearest.\n`);
      return { filename: `${a.name}_godot.zip`, mime: 'application/zip', data: Buffer.from(zipSync(files)) };
    }
    case 'unity': {
      const png = `${a.name}.png`;
      let ua = a;
      if ((a.row.kind === 'tileset' || a.row.kind === 'texture') && !a.frames?.length) {
        const tile = a.tileSize ?? 16;
        const sl = sliceGrid(a.image, { frameWidth: tile, frameHeight: tile });
        ua = { ...a, frames: sl.frames };
      }
      const ppu = (a.tileSize ?? Math.min(a.image.width, a.image.height, 32)) * scale;
      const files: Record<string, Uint8Array> = {
        [png]: new Uint8Array(await encodePng(a.image, scale)),
        [`${png}.meta`]: enc(unityMeta(ua, scale, ppu)),
      };
      files['README.md'] = enc(readme(ua, 'Unity', [png, `${png}.meta`]) + `\nCopy both files together into your Assets folder: the .meta configures Point filtering, no compression and slices the sprites (Sprite Mode: Multiple, ${ppu} pixels per unit).\nFor animations, select the sliced sprites and drag them into the scene to create an Animation Clip.\n`);
      return { filename: `${a.name}_unity.zip`, mime: 'application/zip', data: Buffer.from(zipSync(files)) };
    }
    case 'phaser': {
      const png = `${a.name}.png`;
      const files: Record<string, Uint8Array> = {
        [png]: new Uint8Array(await encodePng(a.image, scale)),
        [`${a.name}.json`]: enc(JSON.stringify(atlasJson(a, png, scale), null, 2)),
        [`${a.name}_anims.json`]: enc(JSON.stringify(phaserAnims(a, a.name), null, 2)),
        ['load-example.js']: enc(phaserSnippet(a)),
      };
      if (a.row.kind === 'tileset' || a.row.kind === 'texture') {
        // Tiled tileset (with a corner wangset for autotiles) — build maps in Tiled, load them in Phaser.
        files[`${a.name}.tsx`] = enc(tiledTileset(a.name, png, scale > 1 ? upscaleInteger(a.image, scale) : a.image, (a.tileSize ?? 16) * scale, a.wang));
      }
      files['README.md'] = enc(readme(a, 'Phaser', Object.keys(files)));
      return { filename: `${a.name}_phaser.zip`, mime: 'application/zip', data: Buffer.from(zipSync(files)) };
    }
    default:
      throw badRequest(`Unknown export format ${format}`);
  }
}

/** Export several assets into one archive (one sub-folder per asset). */
export async function exportBatch(userId: string, ids: string[], format: ExportFormat, opts: ExportOptions = {}): Promise<ExportResult> {
  if (!ids.length) throw badRequest('No assets selected');
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const id of ids.slice(0, 500)) {
    const r = await exportAsset(userId, id, format, opts);
    let name = r.filename;
    let n = 1;
    while (used.has(name)) name = r.filename.replace(/(\.[^.]+)$/, `_${n++}$1`);
    used.add(name);
    files[name] = new Uint8Array(r.data);
  }
  return { filename: `sprixy_export_${format}_${Date.now()}.zip`, mime: 'application/zip', data: Buffer.from(zipSync(files, { level: 0 })) };
}
