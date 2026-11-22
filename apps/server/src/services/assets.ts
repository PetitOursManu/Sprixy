import type { RGBAImage, Frame } from '@sprixy/core';
import { getDb, parseJson } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { notFound, badRequest } from '../lib/errors.js';
import { saveFile, readStored, overwriteFile, deleteStored } from '../lib/storage.js';
import { encodePng, decodeImage } from '../lib/images.js';
import type { AssetKind } from './artDirection.js';

export interface AssetRow {
  id: string;
  user_id: string;
  project_id: string;
  parent_id: string | null;
  generation_id: string | null;
  kind: AssetKind;
  name: string;
  file: string;
  source_file: string | null;
  width: number;
  height: number;
  frames_json: string | null;
  meta_json: string;
  favorite: number;
  editor_doc_file: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface AssetMeta {
  palette?: string[];
  direction?: string;
  directions?: string[];
  fps?: number;
  tileSize?: number;
  prompt?: string;
  modelId?: string;
  seed?: number;
  pipeline?: unknown[];
  [k: string]: unknown;
}

export function assetDto(r: AssetRow, tags?: string[]) {
  return {
    id: r.id,
    projectId: r.project_id,
    parentId: r.parent_id,
    generationId: r.generation_id,
    kind: r.kind,
    name: r.name,
    width: r.width,
    height: r.height,
    frames: parseJson<Frame[] | null>(r.frames_json, null),
    meta: parseJson<AssetMeta>(r.meta_json, {}),
    favorite: !!r.favorite,
    tags: tags ?? getTags(r.id),
    hasSource: !!r.source_file,
    hasEditorDoc: !!r.editor_doc_file,
    fileUrl: `/api/v1/assets/${r.id}/file?v=${r.updated_at}`,
    sourceUrl: r.source_file ? `/api/v1/assets/${r.id}/source` : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
export type AssetDto = ReturnType<typeof assetDto>;

export function getTags(assetId: string): string[] {
  return getDb().all<{ tag: string }>('SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY tag', assetId).map((r) => r.tag);
}

export function setTags(assetId: string, tags: string[]): void {
  const db = getDb();
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
  db.tx(() => {
    db.run('DELETE FROM asset_tags WHERE asset_id = ?', assetId);
    for (const t of clean) db.run('INSERT INTO asset_tags (asset_id, tag) VALUES (?, ?)', assetId, t);
  });
}

export function assertProject(userId: string, projectId: string): { id: string; art_direction: string; name: string } {
  const p = getDb().get<{ id: string; art_direction: string; name: string }>('SELECT id, art_direction, name FROM projects WHERE id = ? AND user_id = ?', projectId, userId);
  if (!p) throw notFound('Project');
  return p;
}

export function getAssetRow(userId: string, id: string): AssetRow {
  const r = getDb().get<AssetRow>('SELECT * FROM assets WHERE id = ? AND user_id = ? AND deleted_at IS NULL', id, userId);
  if (!r) throw notFound('Asset');
  return r;
}

export async function loadAssetImage(r: AssetRow): Promise<RGBAImage> {
  return decodeImage(await readStored(r.file));
}

export async function loadSourceImage(r: AssetRow): Promise<RGBAImage | null> {
  return r.source_file ? decodeImage(await readStored(r.source_file)) : null;
}

export interface CreateAssetInput {
  userId: string;
  projectId: string;
  kind: AssetKind;
  name: string;
  image: RGBAImage;
  source?: Buffer;
  parentId?: string | null;
  generationId?: string | null;
  frames?: Frame[] | null;
  meta?: AssetMeta;
  tags?: string[];
}

export async function createAsset(input: CreateAssetInput): Promise<AssetDto> {
  const png = await encodePng(input.image);
  const file = await saveFile(input.userId, 'assets', png, 'png');
  const source = input.source ? await saveFile(input.userId, 'sources', input.source, 'png') : null;
  const id = newId('ast_');
  const now = Date.now();
  getDb().run(
    `INSERT INTO assets (id,user_id,project_id,parent_id,generation_id,kind,name,file,source_file,width,height,frames_json,meta_json,favorite,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    id, input.userId, input.projectId, input.parentId ?? null, input.generationId ?? null, input.kind, input.name.slice(0, 200), file, source,
    input.image.width, input.image.height, input.frames ? JSON.stringify(input.frames) : null, JSON.stringify(input.meta ?? {}), now, now,
  );
  if (input.tags?.length) setTags(id, input.tags);
  getDb().run('UPDATE projects SET updated_at = ?, cover_asset_id = COALESCE(cover_asset_id, ?) WHERE id = ?', now, id, input.projectId);
  return assetDto(getAssetRow(input.userId, id));
}

/** Replace the pixels of an asset in place (editor save, deterministic processing). */
export async function replaceAssetImage(userId: string, id: string, image: RGBAImage, opts: { frames?: Frame[] | null; meta?: AssetMeta } = {}): Promise<AssetDto> {
  const r = getAssetRow(userId, id);
  await overwriteFile(r.file, await encodePng(image));
  const meta = opts.meta ? { ...parseJson<AssetMeta>(r.meta_json, {}), ...opts.meta } : parseJson<AssetMeta>(r.meta_json, {});
  const frames = opts.frames === undefined ? r.frames_json : opts.frames ? JSON.stringify(opts.frames) : null;
  getDb().run('UPDATE assets SET width=?, height=?, frames_json=?, meta_json=?, updated_at=? WHERE id=?', image.width, image.height, frames, JSON.stringify(meta), Date.now(), id);
  return assetDto(getAssetRow(userId, id));
}

export interface ListFilter {
  projectId?: string;
  kind?: string;
  tag?: string;
  favorite?: boolean;
  q?: string;
  parentId?: string;
  collectionId?: string;
  rootsOnly?: boolean;
  limit?: number;
  offset?: number;
  sort?: 'newest' | 'oldest' | 'name';
}

export function listAssets(userId: string, f: ListFilter) {
  const where = ['a.user_id = ?', 'a.deleted_at IS NULL'];
  const params: (string | number)[] = [userId];
  let join = '';
  if (f.projectId) { where.push('a.project_id = ?'); params.push(f.projectId); }
  if (f.kind) { where.push('a.kind = ?'); params.push(f.kind); }
  if (f.favorite) where.push('a.favorite = 1');
  if (f.parentId) { where.push('a.parent_id = ?'); params.push(f.parentId); }
  if (f.rootsOnly) where.push('a.parent_id IS NULL');
  if (f.tag) { where.push('EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND t.tag = ?)'); params.push(f.tag.toLowerCase()); }
  if (f.collectionId) { join = 'JOIN collection_assets ca ON ca.asset_id = a.id AND ca.collection_id = ?'; params.unshift(f.collectionId); }
  if (f.q) {
    where.push(`(a.name LIKE ? OR a.meta_json LIKE ? OR EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND t.tag LIKE ?))`);
    const like = `%${f.q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like);
  }
  const order = f.sort === 'oldest' ? 'a.created_at ASC' : f.sort === 'name' ? 'a.name COLLATE NOCASE ASC' : 'a.created_at DESC';
  const limit = Math.min(500, Math.max(1, f.limit ?? 100));
  const offset = Math.max(0, f.offset ?? 0);
  const db = getDb();
  const total = db.get<{ n: number }>(`SELECT COUNT(*) n FROM assets a ${join} WHERE ${where.join(' AND ')}`, ...params)?.n ?? 0;
  const rows = db.all<AssetRow & { variants: number }>(
    `SELECT a.*, (SELECT COUNT(*) FROM assets v WHERE v.parent_id = a.id AND v.deleted_at IS NULL) variants
     FROM assets a ${join} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  return { total, items: rows.map((r) => ({ ...assetDto(r), variantCount: r.variants })) };
}

export function updateAsset(userId: string, id: string, patch: { name?: string; favorite?: boolean; tags?: string[]; meta?: AssetMeta; kind?: AssetKind; parentId?: string | null; frames?: Frame[] | null }) {
  const r = getAssetRow(userId, id);
  const db = getDb();
  if (patch.parentId) {
    if (patch.parentId === id) throw badRequest('An asset cannot be its own parent');
    getAssetRow(userId, patch.parentId);
  }
  db.run(
    'UPDATE assets SET name=?, favorite=?, kind=?, meta_json=?, parent_id=?, frames_json=?, updated_at=? WHERE id=?',
    patch.name ?? r.name,
    patch.favorite === undefined ? r.favorite : patch.favorite ? 1 : 0,
    patch.kind ?? r.kind,
    patch.meta ? JSON.stringify({ ...parseJson<AssetMeta>(r.meta_json, {}), ...patch.meta }) : r.meta_json,
    patch.parentId === undefined ? r.parent_id : patch.parentId,
    patch.frames === undefined ? r.frames_json : patch.frames ? JSON.stringify(patch.frames) : null,
    Date.now(),
    id,
  );
  if (patch.tags) setTags(id, patch.tags);
  return assetDto(getAssetRow(userId, id));
}

export async function deleteAsset(userId: string, id: string): Promise<void> {
  const r = getAssetRow(userId, id);
  const db = getDb();
  db.run('UPDATE assets SET parent_id = ? WHERE parent_id = ?', r.parent_id, id);
  db.run('DELETE FROM assets WHERE id = ?', id);
  db.run('UPDATE projects SET cover_asset_id = NULL WHERE cover_asset_id = ?', id);
  await deleteStored(r.file);
  await deleteStored(r.source_file);
  await deleteStored(r.editor_doc_file);
}

export async function saveEditorDoc(userId: string, id: string, doc: unknown): Promise<void> {
  const r = getAssetRow(userId, id);
  const json = Buffer.from(JSON.stringify(doc));
  if (json.length > 30 * 1024 * 1024) throw badRequest('Editor document too large');
  if (r.editor_doc_file) await overwriteFile(r.editor_doc_file, json);
  else {
    const f = await saveFile(userId, 'editor', json, 'json');
    getDb().run('UPDATE assets SET editor_doc_file = ? WHERE id = ?', f, id);
  }
}

export async function loadEditorDoc(userId: string, id: string): Promise<unknown | null> {
  const r = getAssetRow(userId, id);
  if (!r.editor_doc_file) return null;
  return JSON.parse((await readStored(r.editor_doc_file)).toString('utf8'));
}

/** Distinct palette (hex) of an asset image — used to lock colors for variants/animations. */
export function imagePalette(img: RGBAImage, max = 256): string[] {
  const set = new Set<string>();
  const d = img.data;
  for (let i = 0; i < d.length && set.size < max; i += 4) {
    if (d[i + 3] < 128) continue;
    set.add('#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''));
  }
  return [...set];
}
