import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtUsd, get, post, qs, timeAgo, type Asset, type Generation, type Project, type Perspective } from '../api';
import { useAuth } from '../auth';
import { monthlyLimit, useActiveJobs, useMeta, useProjects, useUsageSummary } from '../hooks';
import { Empty, Field, Icon, Modal, StatusLed, Swatches, useToast } from '../components/ui';

const PERSPECTIVES: { value: Perspective; label: string }[] = [
  { value: 'side', label: 'Side view (platformer)' },
  { value: 'top-down', label: 'Top-down' },
  { value: 'three-quarter', label: '3/4 view (JRPG)' },
  { value: 'isometric', label: 'Isometric' },
  { value: 'front', label: 'Front view' },
];

interface ProviderRow { id: string; name: string; configured: boolean }

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const TASK_LABEL: Record<string, string> = { generate: 'Generate', variant: 'Variant', directions: 'Directions', animate: 'Animate', removeBg: 'Cutout', inpaint: 'Region edit', train: 'LoRA training' };
const TASK_ICON: Record<string, string> = { generate: 'bolt', variant: 'bolt', directions: 'compass', animate: 'play', removeBg: 'image', inpaint: 'edit', train: 'layers' };

export function ProjectsPage() {
  const { status } = useAuth();
  const projects = useProjects();
  const usage = useUsageSummary();
  const jobs = useActiveJobs();
  const recent = useQuery({ queryKey: ['generations', 'recent'], queryFn: () => get<{ items: Generation[] }>('/api/v1/generations?limit=6') });
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => get<{ items: ProviderRow[] }>('/api/v1/providers') });
  const [creating, setCreating] = useState(false);
  const items = projects.data?.items ?? [];
  const total = items.reduce((s, p) => s + (p.assetCount ?? 0), 0);
  const month = usage.data?.month ?? 0;
  const cap = monthlyLimit(usage.data);
  const running = jobs.data?.items ?? [];
  const names = Object.fromEntries(items.map((p) => [p.id, p.name]));
  return (
    <>
      <div className="page" style={{ paddingTop: 30, gap: 24 }}>
        <div className="page-head hello">
          <div>
            <div className="eyebrow">Your workspace</div>
            <h1>{greeting()}, {status?.user?.name || 'there'}<i>.</i></h1>
            <p>Here’s what’s happening in your studio.</p>
          </div>
          <button className="btn primary lg" onClick={() => setCreating(true)}><Icon name="plus" /> New project</button>
        </div>

        <div className="stats-strip">
          <div>
            <span className="k"><Icon name="chart" size={14} /> Spent this month</span>
            <span className="v">{fmtUsd(month, 2)}{cap !== null && <small>of {fmtUsd(cap, 0)} budget</small>}</span>
            {cap !== null && <div className="row" style={{ gap: 10 }}><div className="meter-bar grow"><i style={{ width: `${Math.min(100, (month / cap) * 100)}%` }} /></div><span className="mono small muted">{Math.round((month / cap) * 100)}%</span></div>}
          </div>
          <div>
            <span className="k"><Icon name="history" size={14} /> Active jobs</span>
            <span className="v">{running.length}<small>running now</small></span>
            <span className="small muted">{running.length ? running.slice(0, 3).map((g) => TASK_LABEL[g.task] ?? g.task).join(' · ') : 'Nothing in the queue'}</span>
          </div>
          <div>
            <span className="k"><Icon name="image" size={14} /> Your library</span>
            <span className="v">{total}<small>assets across {items.length} project{items.length === 1 ? '' : 's'}</small></span>
            <span className="small muted">All your sprites, tiles and animations in one place</span>
          </div>
        </div>

        <section className="col" style={{ gap: 12 }}>
          <div className="row between">
            <div><div className="eyebrow" style={{ marginBottom: 4 }}>Your worlds</div><h2 style={{ fontSize: 20 }}>Projects <span className="mono muted" style={{ fontSize: 13 }}>{String(items.length).padStart(2, '0')}</span></h2></div>
            <span className="small muted">Sorted by last update</span>
          </div>
          {projects.isLoading ? null : items.length === 0 ? (
            <Empty title="No project yet" action={<button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" /> Create your first project</button>}>
              Start with a palette and a native sprite size — Sprixy will keep every asset on that grid.
            </Empty>
          ) : (
            <div className="card-grid big" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
              {[...items].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => <ProjectCard key={p.id} p={p} />)}
              <button className="new-card" onClick={() => setCreating(true)}>
                <span className="plus">+</span>
                <strong style={{ color: 'var(--text)', fontSize: 15 }}>New project</strong>
                <span className="small">Pick a palette, a sprite size and a perspective.</span>
                <span className="small" style={{ color: 'var(--accent-2)', fontWeight: 700 }}>Create project →</span>
              </button>
            </div>
          )}
        </section>

        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
          <section className="panel">
            <div className="panel-head"><div><h2>Recent activity</h2><div className="sub">The latest jobs in your studio</div></div><Link to="/jobs" className="btn sm">All jobs</Link></div>
            {(recent.data?.items.length ?? 0) === 0 ? <div className="panel-body muted small">No job yet — generate your first asset from a project.</div> : (
              <table className="table">
                <thead><tr><th>Activity</th><th>Status</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>When</th></tr></thead>
                <tbody>
                  {recent.data!.items.map((g) => (
                    <tr key={g.id}>
                      <td><div className="row" style={{ gap: 12 }}><span className="thumb-cell" style={{ width: 32, height: 32, background: 'var(--bg-2)', color: 'var(--muted)' }}><Icon name={TASK_ICON[g.task] ?? 'bolt'} size={14} /></span><div><div style={{ fontWeight: 600 }}>{TASK_LABEL[g.task] ?? g.task}</div><div className="small muted">{(g.projectId && names[g.projectId]) || g.prompt.slice(0, 40) || '—'}</div></div></div></td>
                      <td><span className="row small" style={{ gap: 6 }}><StatusLed status={g.status} /> {g.status === 'succeeded' ? 'Done' : g.status[0].toUpperCase() + g.status.slice(1)}</span></td>
                      <td className="mono small" style={{ textAlign: 'right' }}>{fmtUsd(g.actualCost ?? g.estimatedCost ?? 0)}</td>
                      <td className="small muted" style={{ textAlign: 'right' }}>{timeAgo(g.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="panel">
            <div className="panel-head"><div><h2>Provider keys</h2><div className="sub">Your models, your keys.</div></div><Icon name="lock" className="muted" /></div>
            <div className="panel-body" style={{ gap: 0, padding: '6px 20px' }}>
              {(providers.data?.items ?? []).map((p) => (
                <div key={p.id} className="row" style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                  <span className="thumb-cell" style={{ width: 32, height: 32, background: 'var(--bg-2)', fontWeight: 700, color: 'var(--muted)' }}>{p.name[0]}</span>
                  <div className="grow"><div style={{ fontWeight: 600 }}>{p.name}</div><div className="small muted row" style={{ gap: 6 }}><span className="led" style={{ background: p.configured ? 'var(--green)' : 'var(--dim)' }} />{p.configured ? 'Connected' : 'Not set'}</div></div>
                  <Link to="/settings" className="small" style={{ fontWeight: 700 }}>{p.configured ? 'Manage' : 'Connect'}</Link>
                </div>
              ))}
              <div className="notice small" style={{ margin: '14px 0 10px' }}>Keys are encrypted on your server and only used for your own jobs.</div>
            </div>
          </section>
        </div>
      </div>
      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </>
  );
}

function ProjectCard({ p }: { p: Project }) {
  const ad = p.artDirection;
  const sample = useQuery({
    queryKey: ['assets', 'sample', p.id],
    queryFn: () => get<{ items: Asset[] }>(`/api/v1/assets${qs({ projectId: p.id, rootsOnly: true, sort: 'newest', limit: 6 })}`),
    staleTime: 60_000,
  });
  const pics = sample.data?.items ?? [];
  return (
    <Link to={`/projects/${p.id}`} className="proj-card">
      <div className="mosaic">
        {Array.from({ length: 6 }, (_, i) => <div key={i}>{pics[i] && <img src={pics[i].fileUrl} alt="" loading="lazy" />}</div>)}
        <span className="size">{ad.spriteSize.width}×{ad.spriteSize.height} PX</span>
      </div>
      <div className="body">
        <div className="row between"><h3>{p.name}</h3><Icon name="chevron" size={14} className="muted" /></div>
        <div className="small muted" style={{ textTransform: 'capitalize' }}>{ad.spriteSize.width}×{ad.spriteSize.height} · {ad.perspective.replace(/-/g, ' ')}</div>
        {p.effectivePalette.length > 0
          ? <div className="row between" style={{ gap: 10 }}><div className="palette-strip grow">{p.effectivePalette.slice(0, 16).map((c, i) => <span key={i} style={{ background: c }} />)}</div><span className="small muted">{ad.palette.presetId ?? 'custom'}</span></div>
          : <span className="small muted">Auto palette · max {ad.palette.maxColors} colors</span>}
      </div>
      <div className="foot"><strong style={{ color: 'var(--text)' }}>{p.assetCount ?? 0} assets</strong><span>{timeAgo(p.updatedAt)}</span></div>
    </Link>
  );
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const meta = useMeta();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [presetId, setPresetId] = useState('endesga-32');
  const [size, setSize] = useState(32);
  const [perspective, setPerspective] = useState<Perspective>('side');
  const create = useMutation({
    mutationFn: () => post<Project>('/api/v1/projects', {
      name, description,
      artDirection: {
        palette: presetId ? { presetId, colors: [], enforce: true, maxColors: 32 } : { colors: [], enforce: false, maxColors: 24 },
        spriteSize: { width: size, height: size },
        iconSize: { width: Math.max(8, size / 2), height: Math.max(8, size / 2) },
        tileSize: Math.max(8, size / 2),
        perspective,
      },
    }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      nav(`/projects/${p.id}/art-direction`);
    },
    onError: (e) => toast('error', (e as Error).message),
  });
  const preset = meta.data?.palettes.find((p) => p.id === presetId);
  return (
    <Modal title="New project" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create project</button>
    </>}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Dungeon Crawler" /></Field>
      <Field label="Description"><textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Setting, mood, references…" /></Field>
      <div className="grid-2">
        <Field label="Native sprite size">
          <select className="select" value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {[16, 24, 32, 48, 64, 96, 128].map((s) => <option key={s} value={s}>{s}×{s}</option>)}
          </select>
        </Field>
        <Field label="Perspective">
          <select className="select" value={perspective} onChange={(e) => setPerspective(e.target.value as Perspective)}>
            {PERSPECTIVES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Palette" hint="You can fine-tune or replace it later in Art direction.">
        <select className="select" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
          <option value="">Automatic (reduced per asset)</option>
          {meta.data?.palettes.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.colors.length} colors</option>)}
        </select>
      </Field>
      {preset && <Swatches colors={preset.colors} />}
    </Modal>
  );
}
