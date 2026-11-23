import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { FastifyInstance } from 'fastify';

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'sprixy-test-'));
process.env.SPRIXY_DATA_DIR = dataDir;
process.env.SPRIXY_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

let app: FastifyInstance;
let cookie = '';
let token = '';

async function call(method: string, url: string, payload?: unknown, auth: 'cookie' | 'token' | 'none' = 'cookie') {
  const headers: Record<string, string> = {};
  if (auth === 'cookie' && cookie) headers.cookie = cookie;
  if (auth === 'token') headers.authorization = `Bearer ${token}`;
  return app.inject({ method: method as 'GET', url, payload: payload as object, headers });
}

/** 16x16 sprite upscaled 8x on a magenta background — like an AI output. */
async function fakeAiImage(): Promise<string> {
  const { encodePng } = await import('../src/lib/images.js');
  const { createImage, setPixel, upscaleInteger } = await import('@sprixy/core');
  const img = createImage(16, 16, [255, 0, 255, 255]);
  for (let y = 3; y < 15; y++) for (let x = 5; x < 11; x++) setPixel(img, x, y, [40, 90, 200, 255]);
  for (let x = 6; x < 10; x++) setPixel(img, x, 4, [240, 200, 160, 255]);
  return `data:image/png;base64,${(await encodePng(upscaleInteger(img, 8))).toString('base64')}`;
}

beforeAll(async () => {
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  const { getDb } = await import('../src/db/index.js');
  getDb().close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Sprixy API', () => {
  let projectId = '';
  let assetId = '';

  it('reports setup required, then registers the first admin', async () => {
    const st = await call('GET', '/api/v1/auth/status', undefined, 'none');
    expect(st.json().setupRequired).toBe(true);
    const res = await call('POST', '/api/v1/auth/register', { email: 'dev@example.test', name: 'Dev', password: 'correct horse battery' }, 'none');
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('admin');
    cookie = String(res.headers['set-cookie']).split(';')[0];
    // Second signup is refused by default
    const second = await call('POST', '/api/v1/auth/register', { email: 'x@example.test', name: 'X', password: 'another password' }, 'none');
    expect(second.statusCode).toBe(403);
  });

  it('rejects unauthenticated calls and creates API tokens', async () => {
    expect((await call('GET', '/api/v1/projects', undefined, 'none')).statusCode).toBe(401);
    const t = await call('POST', '/api/v1/tokens', { name: 'test' });
    token = t.json().token;
    expect(token.startsWith('spx_')).toBe(true);
    expect((await call('GET', '/api/v1/projects', undefined, 'token')).statusCode).toBe(200);
  });

  it('creates a project with art direction', async () => {
    const res = await call('POST', '/api/v1/projects', { name: 'Dungeon', artDirection: { palette: { presetId: 'pico-8' }, spriteSize: { width: 16, height: 16 }, perspective: 'top-down' } });
    expect(res.statusCode).toBe(200);
    projectId = res.json().id;
    expect(res.json().effectivePalette).toHaveLength(16);
    const ad = await call('PUT', `/api/v1/projects/${projectId}/art-direction`, { lighting: 'rim', outline: 'black' });
    expect(ad.json().artDirection.lighting).toBe('rim');
    expect(ad.json().artDirection.perspective).toBe('top-down');
  });

  it('imports an image and converts it to pixel art deterministically', async () => {
    const res = await call('POST', '/api/v1/assets/import', {
      projectId, image: await fakeAiImage(), name: 'Mage', kind: 'character',
      pipeline: [{ op: 'removeBackground' }, { op: 'pixelize', width: 16, height: 16 }, { op: 'applyPalette', presetId: 'pico-8' }, { op: 'removeOrphans' }],
    }, 'token');
    expect(res.statusCode).toBe(200);
    const a = res.json();
    assetId = a.id;
    expect(a.width).toBe(16);
    expect(a.meta.palette.length).toBeLessThanOrEqual(16);
    const file = await call('GET', `/api/v1/assets/${assetId}/file`);
    expect(file.headers['content-type']).toBe('image/png');
  });

  it('processes (preview / new) and searches the library', async () => {
    const prev = await call('POST', `/api/v1/assets/${assetId}/process`, { steps: [{ op: 'outline', color: '#000000' }], mode: 'preview' });
    expect(prev.json().width).toBe(18);
    const n = await call('POST', `/api/v1/assets/${assetId}/process`, { steps: [{ op: 'hsl', hue: 120 }], mode: 'new' });
    expect(n.json().parentId).toBe(assetId);
    const list = await call('GET', `/api/v1/assets?projectId=${projectId}&q=Mage`);
    expect(list.json().total).toBeGreaterThanOrEqual(2);
    const patch = await call('PATCH', `/api/v1/assets/${assetId}`, { favorite: true, tags: ['hero', 'Mage'] });
    expect(patch.json().tags).toEqual(['hero', 'mage']);
    expect((await call('GET', `/api/v1/assets?favorite=true`)).json().total).toBe(1);
  });

  it('builds an animation and slices it back', async () => {
    const v = await call('POST', `/api/v1/assets/${assetId}/process`, { steps: [{ op: 'flip', direction: 'horizontal' }], mode: 'new' });
    const anim = await call('POST', '/api/v1/animations', { projectId, assetIds: [assetId, v.json().id, assetId], fps: 8, name: 'Walk' });
    expect(anim.statusCode).toBe(200);
    expect(anim.json().frames).toHaveLength(3);
    const sliced = await call('POST', `/api/v1/assets/${anim.json().id}/slice`, { mode: 'grid', columns: 3, rows: 1, output: 'assets', align: 'bottom' });
    expect(sliced.json().items).toHaveLength(3);

    for (const format of ['png', 'gif', 'webp', 'json', 'spritesheet', 'zip', 'godot', 'unity', 'phaser']) {
      const res = await call('GET', `/api/v1/assets/${anim.json().id}/export?format=${format}&scale=2`);
      expect(res.statusCode, format).toBe(200);
      expect(res.rawPayload.length, format).toBeGreaterThan(20);
      if (['spritesheet', 'zip', 'godot', 'unity', 'phaser'].includes(format)) {
        const files = Object.keys(unzipSync(new Uint8Array(res.rawPayload)));
        expect(files.length, format).toBeGreaterThan(1);
        if (format === 'godot') expect(files.some((f) => f.endsWith('.tres'))).toBe(true);
        if (format === 'unity') expect(files.some((f) => f.endsWith('.png.meta'))).toBe(true);
      }
    }
    const gif = await call('GET', `/api/v1/assets/${anim.json().id}/export?format=gif`);
    expect(gif.rawPayload.subarray(0, 6).toString()).toBe('GIF89a');
  });

  it('exports a dataset for external LoRA training (free)', async () => {
    const ds = await call('POST', '/api/v1/datasets', { name: 'Mage style', defaultCaption: 'pixel art mage' });
    const dsId = ds.json().id;
    const refused = await call('POST', `/api/v1/datasets/${dsId}/images`, { assetIds: [assetId] });
    expect(refused.statusCode).toBe(400); // rights confirmation is mandatory
    expect((await call('POST', `/api/v1/datasets/${dsId}/images`, { assetIds: [assetId], rightsConfirmed: true })).statusCode).toBe(200);
    const res = await call('GET', `/api/v1/datasets/${dsId}/export?triggerWord=sprx`);
    expect(res.statusCode).toBe(200);
    const files = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['dataset/img_001.png', 'dataset/img_001.txt', 'dataset/metadata.jsonl', 'README.md']));
    expect(new TextDecoder().decode(files['dataset/img_001.txt'])).toBe('sprx, pixel art mage');
  });

  it('builds a Wang autotile set and exports Godot terrains + Tiled wangset', async () => {
    const { encodePng } = await import('../src/lib/images.js');
    const { createImage } = await import('@sprixy/core');
    const tex = async (c: [number, number, number, number], name: string) =>
      (await call('POST', '/api/v1/assets/import', { projectId, name, kind: 'texture', image: `data:image/png;base64,${(await encodePng(createImage(16, 16, c))).toString('base64')}` })).json().id as string;
    const dirt = await tex([120, 80, 40, 255], 'dirt');
    const grass = await tex([60, 180, 70, 255], 'grass');
    const res = await call('POST', '/api/v1/tilesets/wang', { projectId, lowerAssetId: dirt, upperAssetId: grass, lowerName: 'Dirt', upperName: 'Grass', tileSize: 16 });
    expect(res.statusCode).toBe(200);
    const set = res.json();
    expect(set.width).toBe(64);
    expect(set.meta.wang.tiles).toHaveLength(16);
    const godot = unzipSync(new Uint8Array((await call('GET', `/api/v1/assets/${set.id}/export?format=godot&scale=2`)).rawPayload));
    const tres = new TextDecoder().decode(Object.entries(godot).find(([k]) => k.endsWith('_tileset.tres'))![1]);
    expect(tres).toContain('terrain_set_0/mode = 1');
    expect(tres).toContain('terrain_set_0/terrain_1/name = "Grass"');
    expect(tres).toContain('3:3/0/terrains_peering_bit/bottom_right_corner = 1');
    expect(tres).toContain('texture_region_size = Vector2i(32, 32)');
    const phaser = unzipSync(new Uint8Array((await call('GET', `/api/v1/assets/${set.id}/export?format=phaser`)).rawPayload));
    const tsx = new TextDecoder().decode(Object.entries(phaser).find(([k]) => k.endsWith('.tsx'))![1]);
    expect(tsx).toContain('<wangset');
    expect(tsx.match(/<wangtile /g)).toHaveLength(16);
  });

  it('enforces BYOK: jobs fail fast without a provider key, estimates work', async () => {
    const spec = { task: 'generate', projectId, kind: 'character', prompt: 'a tiny wizard', count: 2 };
    const est = await call('POST', '/api/v1/generations/estimate', spec);
    expect(est.statusCode).toBe(200);
    expect(est.json().estimate.usd).toBeGreaterThan(0);
    expect(est.json().finalPrompt).toContain('a tiny wizard');
    expect(est.json().finalPrompt).toContain('top-down');
    const job = await call('POST', '/api/v1/generations', spec);
    expect(job.statusCode).toBe(400);
    expect(job.json().error.code).toBe('MISSING_API_KEY');
  });

  it('enforces budgets', async () => {
    const { encryptSecret } = await import('../src/lib/crypto.js');
    const { getDb } = await import('../src/db/index.js');
    const user = getDb().get<{ id: string }>('SELECT id FROM users LIMIT 1')!;
    getDb().run(`INSERT INTO provider_keys (id,user_id,provider,label,secret_enc,last4,status,created_at) VALUES ('k1',?,'fal','default',?,'test','valid',?)`, user.id, encryptSecret('fake-key-1234'), Date.now());
    const keys = await call('GET', '/api/v1/keys');
    expect(JSON.stringify(keys.json())).not.toContain('fake-key');
    await call('PUT', '/api/v1/budget', { monthlyBudgetUsd: null, dailyBudgetUsd: null, maxCostPerJobUsd: 0.0001, dailyJobLimit: null });
    const job = await call('POST', '/api/v1/generations', { task: 'generate', projectId, kind: 'sprite', prompt: 'a coin' });
    expect(job.statusCode).toBe(402);
    expect(job.json().error.code).toBe('BUDGET_EXCEEDED');
  });

  it('exposes OpenAPI docs and meta', async () => {
    const spec = await call('GET', '/api/docs/json', undefined, 'none');
    expect(spec.statusCode).toBe(200);
    expect(Object.keys(spec.json().paths).length).toBeGreaterThan(40);
    const meta = await call('GET', '/api/v1/meta');
    expect(meta.json().palettes.length).toBeGreaterThan(5);
  });

  it('serves the MCP endpoint (initialize + tools/list + tool call)', async () => {
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
    const init = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } } });
    expect(init.statusCode).toBe(200);
    expect(init.json().result.serverInfo.name).toBe('sprixy');
    const tools = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
    const names = tools.json().result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('sprixy_generate_asset');
    expect(names).toContain('sprixy_export_asset');
    const res = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sprixy_search_assets', arguments: { q: 'Mage' } } } });
    const content = res.json().result.content[0].text;
    expect(JSON.parse(content).total).toBeGreaterThan(0);
    const exp = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'sprixy_export_asset', arguments: { assetId, format: 'gif' } } } });
    expect(exp.json().result.content[1].resource.mimeType).toBe('image/gif');
    const unauth = await app.inject({ method: 'POST', url: '/mcp', headers: { ...headers, authorization: '' }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(unauth.statusCode).toBe(401);
  });
});

describe('webhooks', () => {
  it('delivers a signed generation.finished event', async () => {
    const http = await import('node:http');
    const { createHmac } = await import('node:crypto');
    const { deliverWebhook, getWebhookSecret } = await import('../src/services/webhooks.js');
    const { getDb } = await import('../src/db/index.js');
    const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { received.push({ headers: req.headers, body }); res.end('ok'); });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as { port: number }).port;
    const user = getDb().get<{ id: string }>('SELECT id FROM users LIMIT 1')!;
    getDb().run(`INSERT INTO generations (id,user_id,task,model_id,provider,status,created_at) VALUES ('gen_hook',?,'generate','fal:z-image-turbo','fal','succeeded',?)`, user.id, Date.now());
    const secret = getWebhookSecret(user.id);
    expect((await call('GET', '/api/v1/webhooks/secret')).json().secret).toBe(secret);
    await deliverWebhook(user.id, 'gen_hook', `http://127.0.0.1:${port}/hook`, { id: 'gen_hook', status: 'succeeded' });
    srv.close();
    expect(received).toHaveLength(1);
    const h = received[0].headers;
    const expected = createHmac('sha256', secret).update(`${h['x-sprixy-timestamp']}.${received[0].body}`).digest('hex');
    expect(h['x-sprixy-signature']).toBe(`sha256=${expected}`);
    expect(JSON.parse(received[0].body)).toMatchObject({ event: 'generation.finished', data: { id: 'gen_hook' } });
    const stored = JSON.parse(getDb().get<{ result_json: string }>(`SELECT result_json FROM generations WHERE id = 'gen_hook'`)!.result_json);
    expect(stored.webhook.result).toBe('HTTP 200');
  });
});
