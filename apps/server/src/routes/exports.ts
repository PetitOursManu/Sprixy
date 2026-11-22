import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PROCESS_OPS, PALETTE_PRESETS, runPipeline, detectPixelGrid, type ProcessStep } from '@sprixy/core';
import { requireUser } from '../auth.js';
import { badRequest } from '../lib/errors.js';
import { decodeImage, encodePng, fetchBinary, toDataUri } from '../lib/images.js';
import { exportAsset, exportBatch, EXPORT_FORMATS } from '../services/exports.js';
import { pipelineSchema } from './assets.js';
import { GENERATABLE_KINDS, KIND_SPECS } from '../services/artDirection.js';

const opts = { scale: z.coerce.number().int().min(1).max(32).optional(), fps: z.coerce.number().int().min(1).max(60).optional(), tileSize: z.coerce.number().int().min(1).max(512).optional(), columns: z.coerce.number().int().min(1).max(64).optional() };

export async function exportRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/v1/assets/:id/export', {
    schema: {
      tags: ['export'],
      summary: 'Download an asset: png | gif | webp | spritesheet | json | zip | godot | unity | phaser',
      params: z.object({ id: z.string() }),
      querystring: z.object({ format: z.enum(EXPORT_FORMATS).default('png'), ...opts }),
    },
  }, async (req, reply) => {
    const { format, ...o } = req.query;
    const out = await exportAsset(requireUser(req).id, req.params.id, format, o);
    reply.header('Content-Disposition', `attachment; filename="${out.filename}"`).type(out.mime);
    return out.data;
  });

  r.post('/api/v1/exports', {
    schema: { tags: ['export'], summary: 'Export several assets as one ZIP', body: z.object({ assetIds: z.array(z.string()).min(1).max(500), format: z.enum(EXPORT_FORMATS).default('png'), scale: opts.scale, fps: opts.fps, tileSize: opts.tileSize }) },
  }, async (req, reply) => {
    const { assetIds, format, ...o } = req.body;
    const out = await exportBatch(requireUser(req).id, assetIds, format, o);
    reply.header('Content-Disposition', `attachment; filename="${out.filename}"`).type(out.mime);
    return out.data;
  });

  // Stateless tools (no storage) — handy for external apps that only need conversion.
  r.post('/api/v1/tools/process', {
    schema: {
      tags: ['processing'], summary: 'Stateless: run a deterministic pipeline on an image (https URL or data URI) and get a PNG data URI back — free, no AI',
      body: z.object({ image: z.string().min(10), steps: pipelineSchema }),
    },
  }, async (req) => {
    requireUser(req);
    if (!/^(https:\/\/|data:image\/)/.test(req.body.image)) throw badRequest('image must be an https URL or a data:image/... URI');
    const img = await decodeImage(await fetchBinary(req.body.image, { signal: AbortSignal.timeout(20_000) }));
    if (img.width * img.height > 4096 * 4096) throw badRequest('Image too large');
    const out = runPipeline(img, req.body.steps as ProcessStep[]);
    return { image: toDataUri(await encodePng(out)), width: out.width, height: out.height };
  });

  r.post('/api/v1/tools/detect-grid', {
    schema: { tags: ['processing'], summary: 'Detect the pseudo-pixel grid of an upscaled / AI pixel-art image', body: z.object({ image: z.string().min(10) }) },
  }, async (req) => {
    requireUser(req);
    if (!/^(https:\/\/|data:image\/)/.test(req.body.image)) throw badRequest('image must be an https URL or a data:image/... URI');
    const img = await decodeImage(await fetchBinary(req.body.image, { signal: AbortSignal.timeout(20_000) }));
    const g = detectPixelGrid(img);
    return { ...g, logicalWidth: Math.round(img.width / g.scaleX), logicalHeight: Math.round(img.height / g.scaleY) };
  });

  r.get('/api/v1/meta', { schema: { tags: ['meta'], summary: 'Processing operations, palette presets, asset kinds and export formats' } }, async () => ({
    processOps: PROCESS_OPS,
    palettes: PALETTE_PRESETS,
    kinds: GENERATABLE_KINDS.map((k) => ({ kind: k, label: KIND_SPECS[k].label, transparent: KIND_SPECS[k].transparent })),
    exportFormats: EXPORT_FORMATS,
  }));
}
