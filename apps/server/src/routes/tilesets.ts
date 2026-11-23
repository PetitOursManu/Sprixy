import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { buildWangTileset, resizeNearest } from '@sprixy/core';
import { requireUser } from '../auth.js';
import { badRequest } from '../lib/errors.js';
import { toDataUri, encodePng } from '../lib/images.js';
import { parseJson } from '../db/index.js';
import { assertProject, createAsset, getAssetRow, loadAssetImage, imagePalette } from '../services/assets.js';
import { normalizeArtDirection } from '../services/artDirection.js';

export async function tilesetRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/api/v1/tilesets/wang', {
    schema: {
      tags: ['processing'],
      summary: 'Build a 16-tile Wang corner autotile set (2 terrains) from two texture assets — free, deterministic. Exports to Godot terrains and Tiled wangsets',
      body: z.object({
        projectId: z.string(),
        lowerAssetId: z.string().describe('Texture of the lower / base terrain (e.g. dirt, water)'),
        upperAssetId: z.string().describe('Texture of the upper terrain (e.g. grass)'),
        lowerName: z.string().max(40).default('lower'),
        upperName: z.string().max(40).default('upper'),
        tileSize: z.number().int().min(4).max(128).optional(),
        seed: z.number().int().min(0).max(1_000_000).default(1),
        roughness: z.number().min(0).max(1).default(0.55),
        edge: z.boolean().default(true),
        name: z.string().max(200).optional(),
        preview: z.boolean().default(false),
      }),
    },
  }, async (req) => {
    const u = requireUser(req);
    const b = req.body;
    const p = assertProject(u.id, b.projectId);
    const ad = normalizeArtDirection(parseJson(p.art_direction, {}));
    const T = b.tileSize ?? ad.tileSize;
    const load = async (id: string) => {
      const row = getAssetRow(u.id, id);
      if (row.project_id !== b.projectId) throw badRequest('Both textures must belong to the project');
      let img = await loadAssetImage(row);
      // Textures larger than 4 tiles are reduced (nearest) so the pattern keeps a pixel-art scale.
      if (img.width > T * 4 || img.height > T * 4) img = resizeNearest(img, Math.min(img.width, T * 4), Math.min(img.height, T * 4));
      return img;
    };
    const [lower, upper] = await Promise.all([load(b.lowerAssetId), load(b.upperAssetId)]);
    const set = buildWangTileset(lower, upper, { tileSize: T, seed: b.seed, roughness: b.roughness, edge: b.edge });
    if (b.preview) return { preview: toDataUri(await encodePng(set.image)), width: set.image.width, height: set.image.height };
    return createAsset({
      userId: u.id, projectId: b.projectId, kind: 'tileset', name: b.name ?? `${b.upperName} over ${b.lowerName} · autotile`, image: set.image,
      meta: { tileSize: T, palette: imagePalette(set.image), wang: { type: 'corner', terrains: [b.lowerName, b.upperName], tiles: set.tiles, columns: set.columns }, sourceAssets: [b.lowerAssetId, b.upperAssetId] },
      tags: ['tileset', 'autotile'],
    });
  });
}
