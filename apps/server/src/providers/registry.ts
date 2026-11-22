import { config } from '../config.js';
import { falAdapter } from './fal.js';
import { openRouterAdapter } from './openrouter.js';
import type { ProviderAdapter, ProviderId, ModelDef, Capability } from './types.js';
import { badRequest } from '../lib/errors.js';

/**
 * Provider registry. To add a provider: implement `ProviderAdapter` in its own file and
 * register it here — the rest of the app (jobs, cost estimates, UI, MCP) is provider-agnostic.
 */
export const PROVIDERS: Record<ProviderId, ProviderAdapter> = {
  fal: falAdapter(config.pollIntervalMs),
  openrouter: openRouterAdapter(),
};

export function getProvider(id: string): ProviderAdapter {
  const p = PROVIDERS[id as ProviderId];
  if (!p) throw badRequest(`Unknown provider "${id}"`);
  return p;
}

export async function listModels(filter?: { capability?: Capability; provider?: ProviderId }): Promise<ModelDef[]> {
  const lists = await Promise.all(Object.values(PROVIDERS).map((p) => p.listModels().catch(() => [] as ModelDef[])));
  return lists
    .flat()
    .filter((m) => (!filter?.capability || m.capabilities.includes(filter.capability)) && (!filter?.provider || m.provider === filter.provider));
}

export async function getModel(id: string): Promise<ModelDef> {
  const [provider] = id.split(':');
  const p = getProvider(provider);
  const m = (await p.listModels()).find((x) => x.id === id);
  if (!m) throw badRequest(`Unknown model "${id}"`);
  return m;
}

/** Default model per capability (first recommended fal model). */
export const DEFAULT_MODELS: Record<Capability, string> = {
  txt2img: 'fal:z-image-turbo',
  img2img: 'fal:z-image-turbo-i2i',
  edit: 'fal:flux2-klein-9b',
  animate: 'fal:wan-2.2-i2v',
  removeBg: 'fal:birefnet-v2',
  train: 'fal:z-image-trainer',
};
