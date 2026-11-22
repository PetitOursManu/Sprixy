import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { listKeys, saveKey, deleteKey, revalidateKey } from '../services/keys.js';
import { getBudget, setBudget, usageSummary } from '../services/budget.js';

const provider = z.enum(['fal', 'openrouter']);
const money = z.number().min(0).max(100000).nullable();

export async function accountRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/v1/keys', { schema: { tags: ['keys'], summary: 'Your provider keys (masked — secrets never leave the server)' } }, async (req) => ({ items: listKeys(requireUser(req).id) }));

  r.put('/api/v1/keys/:provider', {
    schema: {
      tags: ['keys'], summary: 'Add or replace a provider API key (validated, then encrypted with AES-256-GCM)',
      params: z.object({ provider }),
      body: z.object({ key: z.string().min(8).max(500), label: z.string().max(60).default('default'), skipValidation: z.boolean().default(false) }),
    },
  }, async (req) => saveKey(requireUser(req).id, req.params.provider, req.body.key, req.body.label, req.body.skipValidation));

  r.post('/api/v1/keys/:provider/check', { schema: { tags: ['keys'], summary: 'Re-validate a stored key (and refresh balance info)', params: z.object({ provider }) } }, async (req) => revalidateKey(requireUser(req).id, req.params.provider));

  r.delete('/api/v1/keys/:provider', { schema: { tags: ['keys'], summary: 'Delete a provider key', params: z.object({ provider }) } }, async (req) => {
    deleteKey(requireUser(req).id, req.params.provider);
    return { ok: true };
  });

  r.get('/api/v1/usage', {
    schema: { tags: ['usage'], summary: 'Spending & generation counts (per day, provider, model, task) with budget status', querystring: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) },
  }, async (req) => usageSummary(requireUser(req).id, req.query.days));

  r.get('/api/v1/budget', { schema: { tags: ['usage'], summary: 'Budget & limits' } }, async (req) => getBudget(requireUser(req).id));

  r.put('/api/v1/budget', {
    schema: {
      tags: ['usage'], summary: 'Set budgets & limits (null = unlimited). Jobs that would exceed them are refused with HTTP 402',
      body: z.object({ monthlyBudgetUsd: money, dailyBudgetUsd: money, maxCostPerJobUsd: money, dailyJobLimit: z.number().int().min(0).max(100000).nullable() }),
    },
  }, async (req) => setBudget(requireUser(req).id, req.body));
}
