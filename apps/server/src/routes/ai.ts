import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { getDb } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { saveFile, deleteStored, readStored } from '../lib/storage.js';
import { decodeImage, encodePng } from '../lib/images.js';
import { PROVIDERS, listModels, DEFAULT_MODELS, getModel } from '../providers/registry.js';
import { PRESET_LORAS } from '../providers/catalog.js';
import type { Capability, ProviderId, TaskRequest } from '../providers/types.js';
import { hasKey, getSecret } from '../services/keys.js';
import { jobSpecSchema, createJob, estimateJob, getGeneration, listGenerations, cancelJob } from '../services/jobs.js';
import { getAssetRow, assertProject } from '../services/assets.js';
import { buildExternalTrainingExport } from '../services/datasets.js';

const idParam = z.object({ id: z.string() });

export async function aiRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── Providers & models ──
  r.get('/api/v1/providers', { schema: { tags: ['models'], summary: 'Supported AI providers and whether you configured a key' } }, async (req) => {
    const u = requireUser(req);
    return {
      items: Object.values(PROVIDERS).map((p) => ({ id: p.id, name: p.name, website: p.website, keyHelpUrl: p.keyHelpUrl, configured: hasKey(u.id, p.id) })),
    };
  });

  r.get('/api/v1/models', {
    schema: {
      tags: ['models'], summary: 'Model catalogue with capabilities, price, quality and speed',
      querystring: z.object({ capability: z.enum(['txt2img', 'img2img', 'edit', 'animate', 'removeBg', 'train']).optional(), provider: z.enum(['fal', 'openrouter']).optional() }),
    },
  }, async (req) => {
    const u = requireUser(req);
    const models = await listModels({ capability: req.query.capability as Capability | undefined, provider: req.query.provider as ProviderId | undefined });
    return { defaults: DEFAULT_MODELS, items: models.map((m) => ({ ...m, available: hasKey(u.id, m.provider) })) };
  });

  r.get('/api/v1/models/:id/price', {
    schema: { tags: ['models'], summary: 'Live unit price for a model (refreshed from the provider when possible)', params: idParam },
  }, async (req) => {
    const u = requireUser(req);
    const m = await getModel(req.params.id);
    const sample: TaskRequest = m.capabilities.includes('train')
      ? { task: 'train', zip: Buffer.alloc(0), steps: 1000 }
      : m.capabilities.includes('animate') ? { task: 'animate', prompt: '', image: { data: Buffer.alloc(0), mime: 'image/png' }, numFrames: 33, fps: 16, resolution: '480p' }
        : m.capabilities.includes('removeBg') ? { task: 'removeBg', image: { data: Buffer.alloc(0), mime: 'image/png' } }
          : { task: 'txt2img', prompt: '', width: 1024, height: 1024, numImages: 1 };
    let key: string | undefined;
    try { key = getSecret(u.id, m.provider); } catch { key = undefined; }
    return { model: m.id, sample: sample.task, estimate: await PROVIDERS[m.provider].estimate(m, sample, key) };
  });

  // ── Generations (jobs) ──
  r.post('/api/v1/generations/estimate', {
    schema: { tags: ['generations'], summary: 'Estimate the cost of a job without running it (also returns the final prompt)', body: jobSpecSchema },
  }, async (req) => estimateJob(requireUser(req).id, req.body));

  r.post('/api/v1/generations', {
    schema: {
      tags: ['generations'],
      summary: 'Start a job: generate | variant | directions | animate | removeBg | train. Returns immediately; poll GET /generations/:id',
      body: jobSpecSchema,
    },
  }, async (req, reply) => {
    const g = await createJob(requireUser(req).id, req.body);
    reply.code(202);
    return g;
  });

  r.get('/api/v1/generations', {
    schema: {
      tags: ['generations'], summary: 'Generation history',
      querystring: z.object({ projectId: z.string().optional(), status: z.string().optional(), task: z.string().optional(), limit: z.coerce.number().int().optional(), offset: z.coerce.number().int().optional() }),
    },
  }, async (req) => listGenerations(requireUser(req).id, req.query));

  r.get('/api/v1/generations/:id', { schema: { tags: ['generations'], summary: 'Generation status, cost and output assets', params: idParam } }, async (req) => getGeneration(requireUser(req).id, req.params.id));

  r.post('/api/v1/generations/:id/cancel', { schema: { tags: ['generations'], summary: 'Cancel a running job', params: idParam } }, async (req) => cancelJob(requireUser(req).id, req.params.id));

  // ── LoRAs ──
  r.get('/api/v1/loras', {
    schema: { tags: ['loras'], summary: 'Your LoRAs (imported / trained) and preset community LoRAs', querystring: z.object({ projectId: z.string().optional(), family: z.string().optional() }) },
  }, async (req) => {
    const u = requireUser(req);
    const rows = getDb().all<{ id: string; project_id: string | null; name: string; family: string; path: string; trigger_word: string | null; default_scale: number; source: string; description: string; created_at: number; training_generation_id: string | null }>(
      `SELECT * FROM loras WHERE user_id = ? ${req.query.projectId ? 'AND (project_id = ? OR project_id IS NULL)' : ''} ORDER BY created_at DESC`,
      ...(req.query.projectId ? [u.id, req.query.projectId] : [u.id]),
    );
    const mine = rows.map((l) => ({ id: l.id, projectId: l.project_id, name: l.name, family: l.family, path: l.path, triggerWord: l.trigger_word, defaultScale: l.default_scale, source: l.source, description: l.description, createdAt: l.created_at, trainingGenerationId: l.training_generation_id }));
    const presets = PRESET_LORAS.map((p) => ({ id: p.id, projectId: null, name: p.name, family: p.family, path: p.path, triggerWord: p.triggerWord ?? null, defaultScale: p.defaultScale, source: 'preset', description: p.description, url: p.url, license: p.license, createdAt: 0 }));
    const all = [...mine, ...presets];
    return { items: req.query.family ? all.filter((l) => l.family === req.query.family) : all };
  });

  r.post('/api/v1/loras', {
    schema: {
      tags: ['loras'], summary: 'Import a compatible LoRA by URL (.safetensors) or Hugging Face "owner/repo"',
      body: z.object({
        name: z.string().min(1).max(120), family: z.enum(['z-image', 'flux2-klein-4b', 'flux2-klein-9b', 'flux1']),
        path: z.string().min(3).max(1000).refine((p) => /^https:\/\//.test(p) || /^[\w.-]+\/[\w.-]+$/.test(p), 'Must be an https URL or a Hugging Face owner/repo id'),
        triggerWord: z.string().max(80).optional(), defaultScale: z.number().min(0).max(4).default(1), description: z.string().max(1000).default(''), projectId: z.string().optional(),
      }),
    },
  }, async (req) => {
    const u = requireUser(req);
    if (req.body.projectId) assertProject(u.id, req.body.projectId);
    const id = newId('lora_');
    getDb().run('INSERT INTO loras (id,user_id,project_id,name,family,path,trigger_word,default_scale,source,description,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, u.id, req.body.projectId ?? null, req.body.name, req.body.family, req.body.path, req.body.triggerWord ?? null, req.body.defaultScale, 'import', req.body.description, Date.now());
    return { id };
  });

  r.patch('/api/v1/loras/:id', {
    schema: { tags: ['loras'], summary: 'Update a LoRA (name, trigger, default scale, project)', params: idParam, body: z.object({ name: z.string().min(1).max(120).optional(), triggerWord: z.string().max(80).nullable().optional(), defaultScale: z.number().min(0).max(4).optional(), projectId: z.string().nullable().optional(), description: z.string().max(1000).optional() }) },
  }, async (req) => {
    const u = requireUser(req);
    const l = getDb().get<{ name: string; trigger_word: string | null; default_scale: number; project_id: string | null; description: string }>('SELECT * FROM loras WHERE id = ? AND user_id = ?', req.params.id, u.id);
    if (!l) throw notFound('LoRA');
    if (req.body.projectId) assertProject(u.id, req.body.projectId);
    getDb().run('UPDATE loras SET name=?, trigger_word=?, default_scale=?, project_id=?, description=? WHERE id=?',
      req.body.name ?? l.name, req.body.triggerWord === undefined ? l.trigger_word : req.body.triggerWord, req.body.defaultScale ?? l.default_scale,
      req.body.projectId === undefined ? l.project_id : req.body.projectId, req.body.description ?? l.description, req.params.id);
    return { ok: true };
  });

  r.delete('/api/v1/loras/:id', { schema: { tags: ['loras'], summary: 'Delete a LoRA', params: idParam } }, async (req) => {
    getDb().run('DELETE FROM loras WHERE id = ? AND user_id = ?', req.params.id, requireUser(req).id);
    return { ok: true };
  });

  // ── Datasets (for LoRA training) ──
  r.get('/api/v1/datasets', { schema: { tags: ['datasets'], summary: 'List training datasets' } }, async (req) => {
    const u = requireUser(req);
    const rows = getDb().all<{ id: string; name: string; description: string; default_caption: string; project_id: string | null; created_at: number; n: number; ok: number }>(
      `SELECT d.*, (SELECT COUNT(*) FROM dataset_images i WHERE i.dataset_id = d.id) n, (SELECT COUNT(*) FROM dataset_images i WHERE i.dataset_id = d.id AND i.rights_confirmed = 1) ok
       FROM datasets d WHERE d.user_id = ? ORDER BY d.created_at DESC`, u.id,
    );
    return { items: rows.map((d) => ({ id: d.id, name: d.name, description: d.description, defaultCaption: d.default_caption, projectId: d.project_id, imageCount: d.n, confirmedCount: d.ok, createdAt: d.created_at })) };
  });

  r.post('/api/v1/datasets', {
    schema: { tags: ['datasets'], summary: 'Create a dataset', body: z.object({ name: z.string().min(1).max(120), description: z.string().max(1000).default(''), defaultCaption: z.string().max(500).default(''), projectId: z.string().optional() }) },
  }, async (req) => {
    const u = requireUser(req);
    if (req.body.projectId) assertProject(u.id, req.body.projectId);
    const id = newId('ds_');
    getDb().run('INSERT INTO datasets (id,user_id,project_id,name,description,default_caption,created_at) VALUES (?,?,?,?,?,?,?)', id, u.id, req.body.projectId ?? null, req.body.name, req.body.description, req.body.defaultCaption, Date.now());
    return { id };
  });

  function ownDataset(userId: string, id: string) {
    const d = getDb().get<{ id: string; name: string; description: string; default_caption: string; project_id: string | null }>('SELECT * FROM datasets WHERE id = ? AND user_id = ?', id, userId);
    if (!d) throw notFound('Dataset');
    return d;
  }

  r.get('/api/v1/datasets/:id', { schema: { tags: ['datasets'], summary: 'Dataset with images', params: idParam } }, async (req) => {
    const u = requireUser(req);
    const d = ownDataset(u.id, req.params.id);
    const images = getDb().all<{ id: string; caption: string; source_note: string; rights_confirmed: number; created_at: number }>('SELECT * FROM dataset_images WHERE dataset_id = ? ORDER BY created_at', d.id);
    return {
      id: d.id, name: d.name, description: d.description, defaultCaption: d.default_caption, projectId: d.project_id,
      images: images.map((i) => ({ id: i.id, caption: i.caption, sourceNote: i.source_note, rightsConfirmed: !!i.rights_confirmed, url: `/api/v1/datasets/${d.id}/images/${i.id}`, createdAt: i.created_at })),
    };
  });

  r.patch('/api/v1/datasets/:id', {
    schema: { tags: ['datasets'], summary: 'Update dataset', params: idParam, body: z.object({ name: z.string().min(1).max(120).optional(), description: z.string().max(1000).optional(), defaultCaption: z.string().max(500).optional() }) },
  }, async (req) => {
    const u = requireUser(req);
    const d = ownDataset(u.id, req.params.id);
    getDb().run('UPDATE datasets SET name=?, description=?, default_caption=? WHERE id=?', req.body.name ?? d.name, req.body.description ?? d.description, req.body.defaultCaption ?? d.default_caption, d.id);
    return { ok: true };
  });

  r.delete('/api/v1/datasets/:id', { schema: { tags: ['datasets'], summary: 'Delete a dataset', params: idParam } }, async (req) => {
    const u = requireUser(req);
    const d = ownDataset(u.id, req.params.id);
    for (const i of getDb().all<{ file: string }>('SELECT file FROM dataset_images WHERE dataset_id = ?', d.id)) await deleteStored(i.file);
    getDb().run('DELETE FROM datasets WHERE id = ?', d.id);
    return { ok: true };
  });

  r.post('/api/v1/datasets/:id/images', {
    schema: {
      tags: ['datasets'], summary: 'Add images: from existing assets (JSON) — upload files via /datasets/:id/upload',
      params: idParam,
      body: z.object({ assetIds: z.array(z.string()).min(1).max(200), rightsConfirmed: z.literal(true, { message: 'You must confirm you are authorized to use these images for training' }), caption: z.string().max(500).default('') }),
    },
  }, async (req) => {
    const u = requireUser(req);
    const d = ownDataset(u.id, req.params.id);
    for (const aid of req.body.assetIds) {
      const a = getAssetRow(u.id, aid);
      const file = await saveFile(u.id, 'datasets', await readStored(a.file), 'png');
      getDb().run('INSERT INTO dataset_images (id,dataset_id,file,caption,source_note,rights_confirmed,created_at) VALUES (?,?,?,?,?,1,?)', newId('dsi_'), d.id, file, req.body.caption, `asset:${a.id}`, Date.now());
    }
    return { ok: true };
  });

  r.post('/api/v1/datasets/:id/upload', {
    schema: { tags: ['datasets'], summary: 'Upload training images (multipart: files + rightsConfirmed=true + caption? + sourceNote?)', params: idParam, consumes: ['multipart/form-data'] },
  }, async (req) => {
    const u = requireUser(req);
    const d = ownDataset(u.id, req.params.id);
    const files: Buffer[] = [];
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === 'file') files.push(await part.toBuffer());
      else fields[part.fieldname] = String(part.value);
    }
    if (fields.rightsConfirmed !== 'true') throw badRequest('You must confirm you own or are authorized to use these images for training (rightsConfirmed=true)');
    for (const f of files) {
      const png = await encodePng(await decodeImage(f));
      const file = await saveFile(u.id, 'datasets', png, 'png');
      getDb().run('INSERT INTO dataset_images (id,dataset_id,file,caption,source_note,rights_confirmed,created_at) VALUES (?,?,?,?,?,1,?)', newId('dsi_'), d.id, file, fields.caption ?? '', fields.sourceNote ?? 'upload', Date.now());
    }
    return { added: files.length };
  });

  r.get('/api/v1/datasets/:id/export', {
    schema: {
      tags: ['datasets'], summary: 'Download the dataset ready for external LoRA training (images + .txt captions + metadata.jsonl + README) — free',
      params: idParam, querystring: z.object({ triggerWord: z.string().max(60).optional() }),
    },
  }, async (req, reply) => {
    const u = requireUser(req);
    const d = ownDataset(u.id, req.params.id);
    const images = getDb().all<{ file: string; caption: string; rights_confirmed: number }>('SELECT * FROM dataset_images WHERE dataset_id = ? ORDER BY created_at', d.id);
    if (!images.length) throw badRequest('This dataset has no image');
    if (images.some((i) => !i.rights_confirmed)) throw badRequest('Every dataset image must be confirmed as authorized for training');
    const zip = await buildExternalTrainingExport(d.name, images, { defaultCaption: d.default_caption || 'pixel art', triggerWord: req.query.triggerWord });
    const fname = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'dataset';
    reply.header('Content-Disposition', `attachment; filename="${fname}_training_dataset.zip"`).type('application/zip');
    return zip;
  });

  r.get('/api/v1/datasets/:id/images/:imageId', { schema: { tags: ['datasets'], summary: 'Dataset image file', params: z.object({ id: z.string(), imageId: z.string() }) } }, async (req, reply) => {
    const u = requireUser(req);
    ownDataset(u.id, req.params.id);
    const i = getDb().get<{ file: string }>('SELECT file FROM dataset_images WHERE id = ? AND dataset_id = ?', req.params.imageId, req.params.id);
    if (!i) throw notFound('Image');
    reply.type('image/png');
    return readStored(i.file);
  });

  r.patch('/api/v1/datasets/:id/images/:imageId', {
    schema: { tags: ['datasets'], summary: 'Edit caption', params: z.object({ id: z.string(), imageId: z.string() }), body: z.object({ caption: z.string().max(500) }) },
  }, async (req) => {
    ownDataset(requireUser(req).id, req.params.id);
    getDb().run('UPDATE dataset_images SET caption = ? WHERE id = ? AND dataset_id = ?', req.body.caption, req.params.imageId, req.params.id);
    return { ok: true };
  });

  r.delete('/api/v1/datasets/:id/images/:imageId', { schema: { tags: ['datasets'], summary: 'Remove an image', params: z.object({ id: z.string(), imageId: z.string() }) } }, async (req) => {
    ownDataset(requireUser(req).id, req.params.id);
    const i = getDb().get<{ file: string }>('SELECT file FROM dataset_images WHERE id = ? AND dataset_id = ?', req.params.imageId, req.params.id);
    if (i) { await deleteStored(i.file); getDb().run('DELETE FROM dataset_images WHERE id = ?', req.params.imageId); }
    return { ok: true };
  });
}
