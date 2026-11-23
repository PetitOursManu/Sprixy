import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { crop, type Frame } from '@sprixy/core';
import { getDb, parseJson } from '../db/index.js';
import { requireUser } from '../auth.js';
import { notFound, badRequest } from '../lib/errors.js';
import { readStored } from '../lib/storage.js';
import { decodeImage, encodePng } from '../lib/images.js';
import { getTags, type AssetRow, type AssetMeta } from '../services/assets.js';
import { normalizeArtDirection, paletteOf } from '../services/artDirection.js';

/**
 * The catalog: a read-only view of the assets of the projects a user shares with connected apps (Mocky…).
 * Catalog tokens (scope "catalog") can call nothing else. Images are served at an integer scale so pixel art stays crisp
 * in apps that smooth images when they resize them.
 */

/** Longest side of a catalog image unless the caller asks otherwise, and the hard cap. */
const DEFAULT_SIZE = 512;
const MAX_SIDE = 2048;

const SHARED = `a.user_id = ? AND a.deleted_at IS NULL AND p.catalog_shared = 1 AND p.archived = 0`;

type Row = AssetRow & { project_name: string };

function frameCount(r: AssetRow): number {
  return parseJson<Frame[] | null>(r.frames_json, null)?.length ?? 1;
}

/** Native size of what the image endpoint returns: one frame for animations and sheets. */
function frameSize(r: AssetRow): { w: number; h: number } {
  const f = parseJson<Frame[] | null>(r.frames_json, null)?.[0];
  return f ? { w: f.rect.w, h: f.rect.h } : { w: r.width, h: r.height };
}

/** Integer factor that brings the longest side to about `size`, never above MAX_SIDE. */
export function catalogScale(w: number, h: number, size = DEFAULT_SIZE): number {
  const side = Math.max(w, h, 1);
  return Math.max(1, Math.min(Math.floor(MAX_SIDE / side), Math.max(1, Math.round(size / side))));
}

function itemDto(r: Row, owner: string) {
  const meta = parseJson<AssetMeta>(r.meta_json, {});
  const { w, h } = frameSize(r);
  const scale = catalogScale(w, h);
  const v = r.updated_at;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    projectId: r.project_id,
    projectName: r.project_name,
    /** Native pixel size of one frame. */
    width: w,
    height: h,
    frames: frameCount(r),
    fps: typeof meta.fps === 'number' ? meta.fps : null,
    tags: getTags(r.id),
    description: typeof meta.prompt === 'string' ? meta.prompt : '',
    palette: Array.isArray(meta.palette) ? meta.palette.slice(0, 64) : [],
    pixelArt: true,
    /** Ready-to-use PNG, upscaled ×scale with nearest-neighbour (`size` and `scale` query parameters change it). */
    image: { url: `/api/v1/catalog/assets/${r.id}/image?v=${v}`, width: w * scale, height: h * scale, scale },
    thumbnailUrl: `/api/v1/catalog/assets/${r.id}/image?size=128&v=${v}`,
    credit: { author: owner, source: 'Sprixy' },
    updatedAt: r.updated_at,
  };
}

function ownerName(userId: string): string {
  return getDb().get<{ name: string }>('SELECT name FROM users WHERE id = ?', userId)?.name ?? 'Sprixy';
}

function sharedRow(userId: string, id: string): Row {
  const r = getDb().get<Row>(`SELECT a.*, p.name project_name FROM assets a JOIN projects p ON p.id = a.project_id WHERE a.id = ? AND ${SHARED}`, id, userId);
  if (!r) throw notFound('Asset');
  return r;
}

export async function catalogRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/v1/catalog', {
    schema: { tags: ['catalog'], summary: 'Projects shared with connected apps, with their art direction summary (catalog tokens allowed)' },
  }, async (req) => {
    const u = requireUser(req);
    const rows = getDb().all<{ id: string; name: string; description: string; art_direction: string; n: number }>(
      `SELECT p.id, p.name, p.description, p.art_direction,
         (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id AND a.deleted_at IS NULL) n
       FROM projects p WHERE p.user_id = ? AND p.catalog_shared = 1 AND p.archived = 0 ORDER BY p.updated_at DESC`, u.id,
    );
    return {
      owner: { name: u.name },
      projects: rows.map((p) => {
        const ad = normalizeArtDirection(parseJson(p.art_direction, {}));
        return {
          id: p.id, name: p.name, description: p.description, assetCount: p.n,
          palette: paletteOf(ad), perspective: ad.perspective, spriteSize: ad.spriteSize,
        };
      }),
    };
  });

  r.get('/api/v1/catalog/assets', {
    schema: {
      tags: ['catalog'], summary: 'Search the shared assets (catalog tokens allowed)',
      querystring: z.object({
        q: z.string().max(200).optional().describe('Words matched against the name, the tags and the prompt'),
        kind: z.string().optional(), projectId: z.string().optional(), tag: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(24), offset: z.coerce.number().int().min(0).default(0),
      }),
    },
  }, async (req) => {
    const u = requireUser(req);
    const q = req.query;
    const where = [SHARED];
    const params: (string | number)[] = [u.id];
    if (q.kind) { where.push('a.kind = ?'); params.push(q.kind); }
    if (q.projectId) { where.push('a.project_id = ?'); params.push(q.projectId); }
    if (q.tag) { where.push('EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND t.tag = ?)'); params.push(q.tag.toLowerCase()); }
    // Every word must match somewhere: "goblin archer" finds "archer" tagged "goblin".
    for (const word of (q.q ?? '').toLowerCase().split(/\s+/).map((w) => w.replace(/[%_]/g, '')).filter((w) => w.length > 1).slice(0, 8)) {
      where.push(`(LOWER(a.name) LIKE ? OR LOWER(a.meta_json) LIKE ? OR LOWER(p.name) LIKE ? OR EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND t.tag LIKE ?))`);
      const like = `%${word}%`;
      params.push(like, like, like, like);
    }
    const db = getDb();
    const from = `FROM assets a JOIN projects p ON p.id = a.project_id WHERE ${where.join(' AND ')}`;
    const total = db.get<{ n: number }>(`SELECT COUNT(*) n ${from}`, ...params)?.n ?? 0;
    const rows = db.all<Row>(`SELECT a.*, p.name project_name ${from} ORDER BY a.favorite DESC, a.updated_at DESC LIMIT ? OFFSET ?`, ...params, q.limit, q.offset);
    const owner = ownerName(u.id);
    return { total, items: rows.map((row) => itemDto(row, owner)) };
  });

  r.get('/api/v1/catalog/assets/:id', {
    schema: { tags: ['catalog'], summary: 'One shared asset (catalog tokens allowed)', params: z.object({ id: z.string() }) },
  }, async (req) => {
    const u = requireUser(req);
    return itemDto(sharedRow(u.id, req.params.id), ownerName(u.id));
  });

  r.get('/api/v1/catalog/assets/:id/image', {
    schema: {
      tags: ['catalog'], summary: 'PNG of a shared asset, upscaled by a whole number with nearest-neighbour (catalog tokens allowed)',
      params: z.object({ id: z.string() }),
      querystring: z.object({
        size: z.coerce.number().int().min(16).max(MAX_SIDE).optional().describe(`Wanted longest side in pixels (default ${DEFAULT_SIZE}); rounded to a whole multiple of the native size`),
        scale: z.coerce.number().int().min(1).max(64).optional().describe('Exact integer factor, instead of size'),
        frame: z.coerce.number().int().min(0).default(0).describe('Frame of an animation or sheet'),
        v: z.string().optional(),
      }),
    },
  }, async (req, reply) => {
    const u = requireUser(req);
    const row = sharedRow(u.id, req.params.id);
    let img = await decodeImage(await readStored(row.file));
    const frames = parseJson<Frame[] | null>(row.frames_json, null);
    if (frames?.length) {
      const f = frames[req.query.frame];
      if (!f) throw badRequest(`This asset has ${frames.length} frames`);
      img = crop(img, f.rect);
    }
    const side = Math.max(img.width, img.height);
    const scale = req.query.scale ? Math.min(req.query.scale, Math.max(1, Math.floor(MAX_SIDE / side))) : catalogScale(img.width, img.height, req.query.size);
    reply.header('Cache-Control', 'private, max-age=86400').header('X-Pixel-Scale', String(scale)).type('image/png');
    return encodePng(img, scale);
  });
}
