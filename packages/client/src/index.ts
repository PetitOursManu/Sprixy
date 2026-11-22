/**
 * @sprixy/client — minimal typed client for the Sprixy REST API.
 * Works in Node ≥ 18 and browsers (uses fetch). Used by the MCP server and by external apps (Mocky, Muse…).
 */

export interface SprixyClientOptions {
  /** Base URL of the Sprixy instance, e.g. https://sprixy.example.com */
  baseUrl: string;
  /** API token created in Settings → API tokens (spx_…). */
  token?: string;
  /** Custom transport (used by the server-hosted MCP endpoint). */
  transport?: (req: { method: string; path: string; body?: unknown; headers: Record<string, string> }) => Promise<{ status: number; body: unknown; headers?: Record<string, string> }>;
  fetch?: typeof fetch;
}

export class SprixyError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export type JobTask = 'generate' | 'variant' | 'directions' | 'animate' | 'removeBg' | 'train';

export interface Generation {
  id: string;
  projectId: string | null;
  task: JobTask;
  kind: string | null;
  modelId: string;
  provider: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  progress: string | null;
  prompt: string;
  finalPrompt: string | null;
  estimatedCost: number | null;
  actualCost: number | null;
  costSource: string | null;
  error: string | null;
  warnings: string[];
  extra: Record<string, unknown> | null;
  outputAssetIds: string[];
  createdAt: number;
  finishedAt: number | null;
}

export interface Asset {
  id: string;
  projectId: string;
  parentId: string | null;
  kind: string;
  name: string;
  width: number;
  height: number;
  frames: { name: string; rect: { x: number; y: number; w: number; h: number }; duration?: number }[] | null;
  meta: Record<string, unknown>;
  favorite: boolean;
  tags: string[];
  fileUrl: string;
  createdAt: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  artDirection: Record<string, unknown>;
  effectivePalette: string[];
  assetCount?: number;
}

export class SprixyClient {
  readonly baseUrl: string;
  private token?: string;
  private transport?: SprixyClientOptions['transport'];
  private fetchImpl: typeof fetch;

  constructor(opts: SprixyClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.transport = opts.transport;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Low-level JSON request. */
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let status: number, data: unknown;
    if (this.transport) {
      const r = await this.transport({ method, path, body, headers });
      status = r.status;
      data = r.body;
    } else {
      const res = await this.fetchImpl(this.baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      status = res.status;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    }
    if (status >= 400) {
      const err = (data as { error?: { code?: string; message?: string; details?: unknown } })?.error;
      throw new SprixyError(status, err?.code ?? 'HTTP_ERROR', err?.message ?? `HTTP ${status}`, err?.details);
    }
    return data as T;
  }

  /** Raw binary download (exports, files). */
  async download(path: string): Promise<{ data: Uint8Array; contentType: string; filename?: string }> {
    if (this.transport) {
      const r = await this.transport({ method: 'GET', path, headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} });
      if (r.status >= 400) throw new SprixyError(r.status, 'HTTP_ERROR', `Download failed (${r.status})`);
      const cd = r.headers?.['content-disposition'] ?? '';
      return { data: r.body as Uint8Array, contentType: r.headers?.['content-type'] ?? 'application/octet-stream', filename: /filename="([^"]+)"/.exec(cd)?.[1] };
    }
    const res = await this.fetchImpl(this.baseUrl + path, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} });
    if (!res.ok) throw new SprixyError(res.status, 'HTTP_ERROR', `Download failed (${res.status})`);
    const cd = res.headers.get('content-disposition') ?? '';
    return { data: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/octet-stream', filename: /filename="([^"]+)"/.exec(cd)?.[1] };
  }

  // ── Convenience methods ──
  listProjects() { return this.request<{ items: Project[] }>('GET', '/api/v1/projects'); }
  getProject(id: string) { return this.request<Project>('GET', `/api/v1/projects/${id}`); }
  createProject(body: { name: string; description?: string; artDirection?: Record<string, unknown> }) { return this.request<Project>('POST', '/api/v1/projects', body); }
  updateArtDirection(id: string, patch: Record<string, unknown>) { return this.request('PUT', `/api/v1/projects/${id}/art-direction`, patch); }
  listModels(capability?: string) { return this.request<{ items: unknown[]; defaults: Record<string, string> }>('GET', `/api/v1/models${capability ? `?capability=${capability}` : ''}`); }
  estimate(spec: Record<string, unknown>) { return this.request<{ estimate: { usd: number | null; source: string; breakdown: string }; finalPrompt: string; warnings: string[] }>('POST', '/api/v1/generations/estimate', spec); }
  startJob(spec: Record<string, unknown>) { return this.request<Generation>('POST', '/api/v1/generations', spec); }
  getGeneration(id: string) { return this.request<Generation>('GET', `/api/v1/generations/${id}`); }
  cancelGeneration(id: string) { return this.request<Generation>('POST', `/api/v1/generations/${id}/cancel`); }
  listGenerations(q: Record<string, string | number | undefined> = {}) { return this.request<{ items: Generation[]; total: number }>('GET', `/api/v1/generations${qs(q)}`); }
  searchAssets(q: Record<string, string | number | boolean | undefined> = {}) { return this.request<{ items: Asset[]; total: number }>('GET', `/api/v1/assets${qs(q)}`); }
  getAsset(id: string) { return this.request<Asset & { variants: Asset[] }>('GET', `/api/v1/assets/${id}`); }
  updateAsset(id: string, patch: Record<string, unknown>) { return this.request<Asset>('PATCH', `/api/v1/assets/${id}`, patch); }
  processAsset(id: string, steps: unknown[], mode: 'preview' | 'replace' | 'new' = 'new') { return this.request('POST', `/api/v1/assets/${id}/process`, { steps, mode }); }
  importImage(body: { projectId: string; image: string; name?: string; kind?: string; pipeline?: unknown[]; tags?: string[] }) { return this.request<Asset>('POST', '/api/v1/assets/import', body); }
  usage(days = 30) { return this.request('GET', `/api/v1/usage?days=${days}`); }

  /** Start a job and wait until it finishes (polling). */
  async run(spec: Record<string, unknown>, opts: { intervalMs?: number; timeoutMs?: number; onProgress?: (g: Generation) => void } = {}): Promise<Generation> {
    let g = await this.startJob(spec);
    const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
    while (g.status === 'queued' || g.status === 'running') {
      if (Date.now() > deadline) throw new SprixyError(408, 'TIMEOUT', `Generation ${g.id} still ${g.status} after timeout`);
      await new Promise((r) => setTimeout(r, opts.intervalMs ?? 2000));
      g = await this.getGeneration(g.id);
      opts.onProgress?.(g);
    }
    return g;
  }
}

function qs(q: Record<string, string | number | boolean | undefined>): string {
  const p = Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
}
