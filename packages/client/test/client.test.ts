import { describe, it, expect } from 'vitest';
import { SprixyClient, SprixyError } from '../src/index.js';

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('SprixyClient', () => {
  it('sends the bearer token and query strings', async () => {
    const f = fakeFetch([{ status: 200, body: { items: [], total: 0 } }]);
    const c = new SprixyClient({ baseUrl: 'https://sprixy.test/', token: 'spx_abc', fetch: f.fn });
    await c.searchAssets({ q: 'knight', kind: 'character', favorite: undefined });
    expect(f.calls[0].url).toBe('https://sprixy.test/api/v1/assets?q=knight&kind=character');
    expect((f.calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer spx_abc');
  });

  it('maps API errors to SprixyError', async () => {
    const f = fakeFetch([{ status: 402, body: { error: { code: 'BUDGET_EXCEEDED', message: 'Monthly budget exceeded' } } }]);
    const c = new SprixyClient({ baseUrl: 'https://sprixy.test', token: 't', fetch: f.fn });
    await expect(c.startJob({ task: 'generate' })).rejects.toMatchObject({ status: 402, code: 'BUDGET_EXCEEDED' });
    await expect(Promise.reject(new SprixyError(1, 'X', 'y'))).rejects.toBeInstanceOf(SprixyError);
  });

  it('run() polls until the job finishes', async () => {
    const f = fakeFetch([
      { status: 202, body: { id: 'gen_1', status: 'queued' } },
      { status: 200, body: { id: 'gen_1', status: 'running' } },
      { status: 200, body: { id: 'gen_1', status: 'succeeded', outputAssetIds: ['ast_1'] } },
    ]);
    const c = new SprixyClient({ baseUrl: 'https://sprixy.test', token: 't', fetch: f.fn });
    const g = await c.run({ task: 'generate' }, { intervalMs: 1 });
    expect(g.status).toBe('succeeded');
    expect(f.calls).toHaveLength(3);
  });
});
