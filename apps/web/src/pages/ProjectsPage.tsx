import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { post, timeAgo, type Project, type Perspective } from '../api';
import { useMeta, useProjects } from '../hooks';
import { Empty, Field, Icon, Modal, Swatches, useToast } from '../components/ui';

const PERSPECTIVES: { value: Perspective; label: string }[] = [
  { value: 'side', label: 'Side view (platformer)' },
  { value: 'top-down', label: 'Top-down' },
  { value: 'three-quarter', label: '3/4 view (JRPG)' },
  { value: 'isometric', label: 'Isometric' },
  { value: 'front', label: 'Front view' },
];

export function ProjectsPage() {
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  const items = projects.data?.items ?? [];
  return (
    <>
      <div className="topbar"><div className="crumbs"><strong>Projects</strong></div></div>
      <div className="page">
        <div className="page-head">
          <div>
            <h1>Projects</h1>
            <p>Each project carries its own art direction so every generated asset stays coherent.</p>
          </div>
          <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" /> New project</button>
        </div>
        {projects.isLoading ? null : items.length === 0 ? (
          <Empty title="No project yet" action={<button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" /> Create your first project</button>}>
            Start with a palette and a native sprite size — Sprixy will keep every asset on that grid.
          </Empty>
        ) : (
          <div className="card-grid big">
            {items.map((p) => <ProjectCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </>
  );
}

function ProjectCard({ p }: { p: Project }) {
  const ad = p.artDirection;
  return (
    <Link to={`/projects/${p.id}`} className="tile" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="thumb" style={{ aspectRatio: '16 / 9' }}>
        {p.coverUrl ? <img src={p.coverUrl} alt="" /> : <Icon name="cube" size={28} className="muted" />}
      </div>
      <div className="meta" style={{ gap: 6 }}>
        <div className="row between">
          <span className="name">{p.name}</span>
          <span className="chip">{p.assetCount ?? 0} assets</span>
        </div>
        <div className="sub">
          <span>{ad.spriteSize.width}×{ad.spriteSize.height}</span>
          <span>{ad.perspective}</span>
          <span>{timeAgo(p.updatedAt)}</span>
        </div>
        {p.effectivePalette.length > 0 ? <Swatches colors={p.effectivePalette} size="sm" max={32} /> : <span className="small muted">Auto palette · max {ad.palette.maxColors} colors</span>}
      </div>
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
