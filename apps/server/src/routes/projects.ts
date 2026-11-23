import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getDb, parseJson } from '../db/index.js';
import { requireUser } from '../auth.js';
import { newId } from '../lib/crypto.js';
import { notFound, badRequest } from '../lib/errors.js';
import { artDirectionSchema, normalizeArtDirection, paletteOf, KIND_SPECS, GENERATABLE_KINDS } from '../services/artDirection.js';
import { deleteAsset, assertProject } from '../services/assets.js';

interface ProjectRow {
  id: string; name: string; description: string; art_direction: string; cover_asset_id: string | null; archived: number; catalog_shared: number; created_at: number; updated_at: number;
}

export function projectDto(p: ProjectRow & { asset_count?: number }) {
  const ad = normalizeArtDirection(parseJson(p.art_direction, {}));
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    artDirection: ad,
    effectivePalette: paletteOf(ad),
    coverUrl: p.cover_asset_id ? `/api/v1/assets/${p.cover_asset_id}/file` : null,
    archived: !!p.archived,
    /** Visible to connected apps (Mocky…) through catalog tokens. */
    catalogShared: !!p.catalog_shared,
    assetCount: p.asset_count ?? undefined,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

const idParam = z.object({ id: z.string() });

/** Art direction patches are merged onto the stored value, then validated as a whole. */
const adPatch = z.record(z.string(), z.unknown()).describe('Partial art direction: palette, referenceAssetIds, models, loras, spriteSize, iconSize, tileSize, sceneSize, perspective, lighting, shading, detail, outline, dither, styleNotes, negativePrompt');

function mergeArtDirection(base: Record<string, unknown>, patch: Record<string, unknown>) {
  const parsed = artDirectionSchema.safeParse({ ...base, ...patch });
  if (!parsed.success) throw badRequest('Invalid art direction', parsed.error.issues);
  return parsed.data;
}

export async function projectRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/v1/projects', {
    schema: { tags: ['projects'], summary: 'List projects', querystring: z.object({ archived: z.coerce.boolean().optional() }) },
  }, async (req) => {
    const u = requireUser(req);
    const rows = getDb().all<ProjectRow & { asset_count: number }>(
      `SELECT p.*, (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id AND a.deleted_at IS NULL) asset_count
       FROM projects p WHERE p.user_id = ? AND p.archived = ? ORDER BY p.updated_at DESC`, u.id, req.query.archived ? 1 : 0,
    );
    return { items: rows.map(projectDto) };
  });

  r.post('/api/v1/projects', {
    schema: {
      tags: ['projects'], summary: 'Create a project (with optional art direction)',
      body: z.object({ name: z.string().min(1).max(120), description: z.string().max(2000).default(''), artDirection: adPatch.optional() }),
    },
  }, async (req) => {
    const u = requireUser(req);
    const id = newId('prj_');
    const now = Date.now();
    const ad = mergeArtDirection({}, req.body.artDirection ?? {});
    getDb().run('INSERT INTO projects (id,user_id,name,description,art_direction,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', id, u.id, req.body.name, req.body.description, JSON.stringify(ad), now, now);
    return projectDto(getDb().get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id)!);
  });

  r.get('/api/v1/projects/:id', { schema: { tags: ['projects'], summary: 'Get a project', params: idParam } }, async (req) => {
    const u = requireUser(req);
    const p = getDb().get<ProjectRow>('SELECT * FROM projects WHERE id = ? AND user_id = ?', req.params.id, u.id);
    if (!p) throw notFound('Project');
    return projectDto(p);
  });

  r.patch('/api/v1/projects/:id', {
    schema: {
      tags: ['projects'], summary: 'Update project name, description, archive flag, cover, sharing with connected apps',
      params: idParam,
      body: z.object({
        name: z.string().min(1).max(120).optional(), description: z.string().max(2000).optional(), archived: z.boolean().optional(), coverAssetId: z.string().nullable().optional(),
        catalogShared: z.boolean().optional().describe('Share the assets of this project with connected apps (Mocky…) through catalog tokens'),
      }),
    },
  }, async (req) => {
    const u = requireUser(req);
    const p = getDb().get<ProjectRow>('SELECT * FROM projects WHERE id = ? AND user_id = ?', req.params.id, u.id);
    if (!p) throw notFound('Project');
    getDb().run('UPDATE projects SET name=?, description=?, archived=?, cover_asset_id=?, catalog_shared=?, updated_at=? WHERE id=?',
      req.body.name ?? p.name, req.body.description ?? p.description, req.body.archived === undefined ? p.archived : req.body.archived ? 1 : 0,
      req.body.coverAssetId === undefined ? p.cover_asset_id : req.body.coverAssetId,
      req.body.catalogShared === undefined ? p.catalog_shared : req.body.catalogShared ? 1 : 0, Date.now(), p.id);
    return projectDto(getDb().get<ProjectRow>('SELECT * FROM projects WHERE id = ?', p.id)!);
  });

  r.get('/api/v1/projects/:id/art-direction', { schema: { tags: ['projects'], summary: 'Get the art direction of a project', params: idParam } }, async (req) => {
    const u = requireUser(req);
    const p = assertProject(u.id, req.params.id);
    const ad = normalizeArtDirection(parseJson(p.art_direction, {}));
    return { artDirection: ad, effectivePalette: paletteOf(ad), kinds: GENERATABLE_KINDS.map((k) => ({ kind: k, label: KIND_SPECS[k].label, defaultSize: KIND_SPECS[k].defaultSize(ad), transparent: KIND_SPECS[k].transparent })) };
  });

  r.put('/api/v1/projects/:id/art-direction', {
    schema: { tags: ['projects'], summary: 'Replace / merge the art direction (palette, references, models, LoRAs, resolution, perspective, lighting…)', params: idParam, body: adPatch },
  }, async (req) => {
    const u = requireUser(req);
    const p = assertProject(u.id, req.params.id);
    const merged = mergeArtDirection(normalizeArtDirection(parseJson(p.art_direction, {})), req.body);
    getDb().run('UPDATE projects SET art_direction = ?, updated_at = ? WHERE id = ?', JSON.stringify(merged), Date.now(), p.id);
    return { artDirection: merged, effectivePalette: paletteOf(merged) };
  });

  r.delete('/api/v1/projects/:id', { schema: { tags: ['projects'], summary: 'Delete a project and all its assets', params: idParam } }, async (req) => {
    const u = requireUser(req);
    assertProject(u.id, req.params.id);
    const ids = getDb().all<{ id: string }>('SELECT id FROM assets WHERE project_id = ?', req.params.id);
    for (const a of ids) await deleteAsset(u.id, a.id).catch(() => undefined);
    getDb().run('DELETE FROM projects WHERE id = ?', req.params.id);
    return { ok: true };
  });

  // Collections
  r.get('/api/v1/projects/:id/collections', { schema: { tags: ['collections'], summary: 'List collections of a project', params: idParam } }, async (req) => {
    const u = requireUser(req);
    assertProject(u.id, req.params.id);
    const items = getDb().all<{ id: string; name: string; description: string; created_at: number; n: number }>(
      'SELECT c.*, (SELECT COUNT(*) FROM collection_assets ca WHERE ca.collection_id = c.id) n FROM collections c WHERE c.project_id = ? ORDER BY c.name', req.params.id,
    );
    return { items: items.map((c) => ({ id: c.id, name: c.name, description: c.description, assetCount: c.n, createdAt: c.created_at })) };
  });

  r.post('/api/v1/projects/:id/collections', {
    schema: { tags: ['collections'], summary: 'Create a collection', params: idParam, body: z.object({ name: z.string().min(1).max(80), description: z.string().max(500).default('') }) },
  }, async (req) => {
    const u = requireUser(req);
    assertProject(u.id, req.params.id);
    const id = newId('col_');
    getDb().run('INSERT INTO collections (id,user_id,project_id,name,description,created_at) VALUES (?,?,?,?,?,?)', id, u.id, req.params.id, req.body.name, req.body.description, Date.now());
    return { id, name: req.body.name, description: req.body.description, assetCount: 0 };
  });

  r.patch('/api/v1/collections/:id', {
    schema: {
      tags: ['collections'], summary: 'Rename a collection / add or remove assets', params: idParam,
      body: z.object({ name: z.string().min(1).max(80).optional(), addAssetIds: z.array(z.string()).optional(), removeAssetIds: z.array(z.string()).optional() }),
    },
  }, async (req) => {
    const u = requireUser(req);
    const db = getDb();
    const c = db.get<{ id: string; name: string }>('SELECT * FROM collections WHERE id = ? AND user_id = ?', req.params.id, u.id);
    if (!c) throw notFound('Collection');
    db.tx(() => {
      if (req.body.name) db.run('UPDATE collections SET name = ? WHERE id = ?', req.body.name, c.id);
      for (const a of req.body.addAssetIds ?? []) {
        if (db.get('SELECT 1 FROM assets WHERE id = ? AND user_id = ?', a, u.id)) db.run('INSERT OR IGNORE INTO collection_assets (collection_id, asset_id, position) VALUES (?,?,?)', c.id, a, Date.now());
      }
      for (const a of req.body.removeAssetIds ?? []) db.run('DELETE FROM collection_assets WHERE collection_id = ? AND asset_id = ?', c.id, a);
    });
    return { ok: true };
  });

  r.delete('/api/v1/collections/:id', { schema: { tags: ['collections'], summary: 'Delete a collection (assets are kept)', params: idParam } }, async (req) => {
    const u = requireUser(req);
    getDb().run('DELETE FROM collections WHERE id = ? AND user_id = ?', req.params.id, u.id);
    return { ok: true };
  });
}
