import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, fmtUsd, get, post, put, timeAgo } from '../api';
import { useBalances, type Balance } from '../hooks';
import { useAuth } from '../auth';
import { Field, Icon, useCopy, useToast } from '../components/ui';

interface Provider { id: 'fal' | 'openrouter'; name: string; website: string; keyHelpUrl: string; configured: boolean }
interface Key { id: string; provider: string; label: string; hint: string; status: string; info: Record<string, unknown>; createdAt: number; validatedAt: number | null }
interface Token { id: string; name: string; prefix: string; createdAt: number; lastUsedAt: number | null }

const PROVIDER_NOTES: Record<string, string> = {
  fal: 'Image (Z-Image Turbo, FLUX.2 klein), video (Wan), background removal (BiRefNet) and LoRA training. Prices are refreshed from fal’s pricing API.',
  openrouter: 'Image models from Google (Gemini image), OpenAI, Black Forest Labs, ByteDance, Qwen… The exact cost of each call is reported by OpenRouter.',
};

export function SettingsPage() {
  return (
    <>
      <div className="topbar"><div className="crumbs"><strong>Settings</strong></div></div>
      <div className="page">
        <div className="page-head"><div><h1>Settings<span style={{ color: 'var(--accent)' }}>.</span></h1><p>Your keys, your tokens, your control.</p></div><span className="chip"><Icon name="lock" size={12} /> Self-hosted & private</span></div>
        <ProviderKeys />
        <ApiTokens />
        <Integrations />
        <Account />
      </div>
    </>
  );
}

function ProviderKeys() {
  const qc = useQueryClient();
  const toast = useToast();
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => get<{ items: Provider[] }>('/api/v1/providers') });
  const keys = useQuery({ queryKey: ['keys'], queryFn: () => get<{ items: Key[] }>('/api/v1/keys') });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['keys'] }); void qc.invalidateQueries({ queryKey: ['providers'] }); void qc.invalidateQueries({ queryKey: ['models'] }); };
  const save = useMutation({
    mutationFn: ({ provider, key }: { provider: string; key: string }) => put(`/api/v1/keys/${provider}`, { key }),
    onSuccess: (_r, v) => { toast('success', 'Key validated and stored encrypted'); setDraft({ ...draft, [v.provider]: '' }); refresh(); },
    onError: (e) => toast('error', (e as Error).message),
  });
  const check = useMutation({ mutationFn: (provider: string) => post<{ ok: boolean; message: string }>(`/api/v1/keys/${provider}/check`), onSuccess: (r) => { toast(r.ok ? 'success' : 'error', r.message); refresh(); } });
  const remove = useMutation({ mutationFn: (provider: string) => del(`/api/v1/keys/${provider}`), onSuccess: refresh });
  return (
    <div className="panel">
      <div className="panel-head"><h2>Provider keys (BYOK)</h2><span className="small muted">AES-256-GCM encrypted at rest · never sent back to the browser</span></div>
      <div className="panel-body">
        {providers.data?.items.map((p) => {
          const k = keys.data?.items.find((x) => x.provider === p.id);
          return (
            <div key={p.id} className="step-item" style={{ alignItems: 'flex-start', padding: 12, flexDirection: 'column', gap: 8 }}>
              <div className="row between" style={{ width: '100%' }}>
                <div className="row"><strong>{p.name}</strong>{k ? <span className={`chip ${k.status === 'valid' ? 'green' : k.status === 'invalid' ? 'red' : ''}`}>{k.status} · {k.hint}</span> : p.configured ? <span className="chip cyan" title="Jobs use the key of an administrator of this instance, within your allowance">shared by your administrator</span> : <span className="chip">not configured</span>}</div>
                <a className="small" href={p.keyHelpUrl} target="_blank" rel="noreferrer">Get a key ↗</a>
              </div>
              <span className="small muted">{PROVIDER_NOTES[p.id]}</span>
              {k && Object.keys(k.info).length > 0 && (
                <div className="row small mono muted wrap">
                  {Object.entries(k.info).filter(([, v]) => v !== undefined && v !== null).map(([key, v]) => <span key={key}>{key}: {String(v)}</span>)}
                </div>
              )}
              <div className="row" style={{ width: '100%' }}>
                <input className="input mono grow" type="password" autoComplete="off" placeholder={k ? 'Replace key…' : 'Paste your API key'} value={draft[p.id] ?? ''} onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value })} />
                <button className="btn primary" disabled={!draft[p.id] || save.isPending} onClick={() => save.mutate({ provider: p.id, key: draft[p.id] })}>Save & validate</button>
                {k && <button className="btn" onClick={() => check.mutate(p.id)}><Icon name="refresh" size={14} /> Check</button>}
                {k && <button className="btn danger icon" onClick={() => confirm(`Delete your ${p.name} key?`) && remove.mutate(p.id)}><Icon name="trash" size={14} /></button>}
              </div>
              {k && <BalanceRow provider={p.id} name={p.name} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const BILLING_HELP: Record<string, string> = {
  fal: 'fal.ai only shows the balance to ADMIN-scope keys. Create an ADMIN key in your fal.ai dashboard (Keys → scope ADMIN) and paste it here: Sprixy uses it only to read your balance, never to run jobs.',
  openrouter: 'OpenRouter reports the remaining credits of your account, or the remaining limit of this key.',
};

/** Balance shown in the header, plus the optional read-only billing key that unlocks it. */
function BalanceRow({ provider, name }: { provider: string; name: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const balances = useBalances();
  const [draft, setDraft] = useState('');
  const b = balances.data?.items.find((x) => x.provider === provider);
  const done = (r: Balance) => { qc.setQueryData<{ items: Balance[] }>(['balance'], (old) => ({ items: (old?.items ?? []).map((x) => (x.provider === r.provider ? r : x)) })); setDraft(''); };
  const setKey = useMutation({ mutationFn: () => put<Balance>(`/api/v1/keys/${provider}/billing`, { key: draft }), onSuccess: (r) => { done(r); toast('success', `${name} balance: ${fmtUsd(r.balanceUsd, 2)}`); }, onError: (e) => toast('error', (e as Error).message) });
  const clear = useMutation({ mutationFn: () => del<Balance>(`/api/v1/keys/${provider}/billing`), onSuccess: done });
  const refresh = useMutation({ mutationFn: () => get<{ items: Balance[] }>('/api/v1/providers/balance?fresh=true'), onSuccess: (r) => qc.setQueryData(['balance'], r) });
  if (!b || b.status === 'not_supported' || b.status === 'not_configured') return null;
  return (
    <div className="col" style={{ width: '100%', gap: 8, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
      <div className="row between">
        <span className="row small" style={{ gap: 8 }}>
          <Icon name="wallet" size={14} className="muted" />
          <strong>Balance</strong>
          {b.status === 'ok' ? <span className="mono" style={{ color: 'var(--green)', fontWeight: 700 }}>{fmtUsd(b.balanceUsd, 2)}</span> : <span className="muted">{b.status === 'needs_billing_key' ? 'needs a billing key' : 'unavailable'}</span>}
          {b.billingKey && <span className="chip">billing key {b.billingKey}</span>}
          <span className="muted">· shown in the top bar</span>
        </span>
        <span className="row">
          <button className="btn ghost sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}><Icon name="refresh" size={13} /> Refresh</button>
          {b.billingKey && <button className="btn ghost sm danger" onClick={() => clear.mutate()}>Remove billing key</button>}
        </span>
      </div>
      {b.status !== 'ok' && (
        <>
          <span className="small muted">{BILLING_HELP[provider] ?? b.message}</span>
          {b.status === 'needs_billing_key' && (
            <div className="row">
              <input className="input mono grow" type="password" autoComplete="off" placeholder="Paste a read-only billing key (ADMIN scope)" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button className="btn" disabled={draft.length < 8 || setKey.isPending} onClick={() => setKey.mutate()}>Check & save</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ApiTokens() {
  const qc = useQueryClient();
  const copy = useCopy();
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => get<{ items: Token[] }>('/api/v1/tokens') });
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const create = useMutation({ mutationFn: () => post<{ token: string }>('/api/v1/tokens', { name }), onSuccess: (r) => { setCreated(r.token); setName(''); void qc.invalidateQueries({ queryKey: ['tokens'] }); } });
  const revoke = useMutation({ mutationFn: (id: string) => del(`/api/v1/tokens/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['tokens'] }) });
  return (
    <div className="panel">
      <div className="panel-head"><h2>API tokens</h2><span className="small muted">For the MCP server, Mocky, Muse, CI scripts…</span></div>
      <div className="panel-body">
        <div className="row">
          <input className="input grow" placeholder="Token name, e.g. Claude Code" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" disabled={!name} onClick={() => create.mutate()}>Create token</button>
        </div>
        {created && (
          <div className="notice warn" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <strong>Copy this token now — it won’t be shown again.</strong>
            <div className="row" style={{ width: '100%' }}><code className="code-block grow">{created}</code><button className="btn" onClick={() => copy(created, 'Token copied')}><Icon name="copy" size={14} /></button></div>
          </div>
        )}
        <table className="table">
          <thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th>Last used</th><th /></tr></thead>
          <tbody>
            {tokens.data?.items.length === 0 && <tr><td colSpan={5} className="muted">No token.</td></tr>}
            {tokens.data?.items.map((t) => (
              <tr key={t.id}><td>{t.name}</td><td className="mono">{t.prefix}…</td><td>{timeAgo(t.createdAt)}</td><td>{t.lastUsedAt ? timeAgo(t.lastUsedAt) : 'never'}</td>
                <td><button className="btn ghost sm danger" onClick={() => confirm(`Revoke "${t.name}"?`) && revoke.mutate(t.id)}>Revoke</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Integrations() {
  const copy = useCopy();
  const origin = window.location.origin;
  const remote = `claude mcp add --transport http sprixy ${origin}/mcp --header "Authorization: Bearer spx_YOUR_TOKEN"`;
  const local = `claude mcp add sprixy --env SPRIXY_URL=${origin} --env SPRIXY_TOKEN=spx_YOUR_TOKEN -- node /path/to/Sprixy/packages/mcp/dist/cli.js`;
  const curl = `curl -X POST ${origin}/api/v1/generations \\\n  -H "Authorization: Bearer spx_YOUR_TOKEN" -H "Content-Type: application/json" \\\n  -d '{"task":"generate","projectId":"prj_…","kind":"character","prompt":"a goblin archer"}'`;
  return (
    <div className="panel">
      <div className="panel-head"><h2>Integrations</h2><a className="small" href="/api/docs" target="_blank" rel="noreferrer">OpenAPI reference ↗</a></div>
      <div className="panel-body">
        <Field label="Claude Code — remote MCP (this server)">
          <div className="row"><code className="code-block grow">{remote}</code><button className="btn" onClick={() => copy(remote)}><Icon name="copy" size={14} /></button></div>
        </Field>
        <Field label="Claude Code — local stdio MCP">
          <div className="row"><code className="code-block grow">{local}</code><button className="btn" onClick={() => copy(local)}><Icon name="copy" size={14} /></button></div>
        </Field>
        <Field label="REST (Mocky, Muse, any app)">
          <div className="row"><code className="code-block grow">{curl}</code><button className="btn" onClick={() => copy(curl)}><Icon name="copy" size={14} /></button></div>
        </Field>
      </div>
    </div>
  );
}

function Account() {
  const { status } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const m = useMutation({ mutationFn: () => post('/api/v1/auth/password', { currentPassword: cur, newPassword: next }), onSuccess: () => { toast('success', 'Password changed'); setCur(''); setNext(''); }, onError: (e) => toast('error', (e as Error).message) });
  return (
    <div className="panel">
      <div className="panel-head"><h2>Account</h2><span className="small muted">{status?.user?.email} · {status?.user?.role} · Sprixy v{status?.version}</span></div>
      <div className="panel-body">
        <div className="grid-3">
          <Field label="Current password"><input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="New password"><input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} autoComplete="new-password" /></Field>
          <button className="btn" style={{ alignSelf: 'flex-end' }} disabled={!cur || next.length < 8} onClick={() => m.mutate()}>Change password</button>
        </div>
      </div>
    </div>
  );
}
