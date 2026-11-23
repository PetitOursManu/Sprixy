import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, download, fmtUsd, get, patch, post, qs, timeAgo, type Asset, type AssetDetail, type Estimate, type Generation } from '../api';
import { useDebounced, useProject } from '../hooks';
import { Field, Icon, Segmented, Spinner, Swatches, useToast } from '../components/ui';
import { AnimationPlayer } from '../components/AnimationPlayer';
import { PipelineEditor, type Step } from '../components/PipelineEditor';
import { ModelPicker } from '../components/ModelPicker';
import { ExportPicker } from './LibraryPage';

type Tab = 'info' | 'ai' | 'process' | 'slice' | 'export';

export function AssetPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['asset', id], queryFn: () => get<AssetDetail>(`/api/v1/assets/${id}`) });
  const a = q.data;
  const project = useProject(a?.projectId);
  const [tab, setTab] = useState<Tab>('info');
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [view, setView] = useState<'image' | 'anim' | 'source'>('image');
  const [bg, setBg] = useState<'checker' | 'dark' | 'light'>('checker');
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => { setView(a?.kind === 'animation' && a.frames && a.frames.length > 1 ? 'anim' : 'image'); setPreview(null); }, [a?.id, a?.kind, a?.frames]);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch<Asset>(`/api/v1/assets/${id}`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['asset', id] }); void qc.invalidateQueries({ queryKey: ['assets'] }); },
    onError: (e) => toast('error', (e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => del(`/api/v1/assets/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['assets'] }); nav(a ? `/projects/${a.projectId}` : '/'); },
  });

  if (q.isLoading) return <div className="page"><Spinner /></div>;
  if (!a) return <div className="page"><div className="notice error">Asset not found.</div></div>;

  const maxSide = Math.max(a.width, a.height);
  const fitZoom = Math.max(1, Math.min(24, Math.floor(480 / (a.frames?.length && view === 'anim' ? Math.max(...a.frames.map((f) => Math.max(f.rect.w, f.rect.h))) : maxSide))));
  const z = zoom === 'fit' ? fitZoom : zoom;
  const stageBg = bg === 'checker' ? undefined : bg === 'dark' ? '#0b0c0e' : '#e8e6e0';

  return (
    <>
      <div className="topbar">
        <div className="crumbs">
          <Link to={`/projects/${a.projectId}`}>{project.data?.name ?? 'Project'}</Link>
          {a.parent && <><span>/</span><Link to={`/assets/${a.parent.id}`}>{a.parent.name}</Link></>}
          <span>/</span><strong>{a.name}</strong>
        </div>
        <div className="grow" />
        <button className={`btn ${a.favorite ? 'on' : ''}`} onClick={() => update.mutate({ favorite: !a.favorite })}><Icon name="star" /> {a.favorite ? 'Favorite' : 'Add to favorites'}</button>
        <Link className="btn" to={`/assets/${a.id}/edit`}><Icon name="edit" /> Edit pixels</Link>
        <button className="btn danger icon" title="Delete" onClick={() => confirm('Delete this asset? This cannot be undone.') && remove.mutate()}><Icon name="trash" /></button>
      </div>
      <div className="page">
        <div className="split asset">
          <div className="col" style={{ gap: 12 }}>
            <div className="row between wrap">
              <div className="row">
                {a.frames && a.frames.length > 1 && <Segmented value={view} onChange={setView} options={[{ value: 'anim', label: 'Animation' }, { value: 'image', label: 'Sheet' }, ...(a.hasSource ? [{ value: 'source' as const, label: 'AI source' }] : [])]} />}
                {!(a.frames && a.frames.length > 1) && a.hasSource && <Segmented value={view} onChange={setView} options={[{ value: 'image', label: 'Pixel art' }, { value: 'source', label: 'AI source' }]} />}
                {preview && <span className="chip accent">preview <button onClick={() => setPreview(null)}>×</button></span>}
              </div>
              <div className="row">
                <Segmented value={bg} onChange={setBg} options={[{ value: 'checker', label: '▦' }, { value: 'dark', label: '■' }, { value: 'light', label: '□' }]} />
                <select className="select" style={{ width: 90, height: 28 }} value={String(zoom)} onChange={(e) => setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}>
                  <option value="fit">Fit ({fitZoom}×)</option>
                  {[1, 2, 3, 4, 6, 8, 12, 16, 24].map((n) => <option key={n} value={n}>{n}×</option>)}
                </select>
              </div>
            </div>
            <div className="stage" style={{ minHeight: 520, background: stageBg }}>
              {preview ? (
                <img src={preview} alt="preview" style={{ width: 'auto', imageRendering: 'pixelated', transform: `scale(${z})`, transformOrigin: 'center' }} />
              ) : view === 'anim' && a.frames ? (
                <AnimationPlayer src={a.fileUrl} frames={a.frames} fps={typeof a.meta.fps === 'number' ? a.meta.fps : 10} zoom={z} />
              ) : view === 'source' && a.sourceUrl ? (
                <img src={a.sourceUrl} alt="AI source" style={{ maxWidth: '100%', maxHeight: 640 }} />
              ) : (
                <img src={a.fileUrl} alt={a.name} width={a.width * z} height={a.height * z} style={{ imageRendering: 'pixelated' }} />
              )}
            </div>
            <Variants a={a} />
          </div>

          <aside className="col sticky" style={{ gap: 12 }}>
            <div className="segmented" style={{ alignSelf: 'stretch', display: 'flex' }}>
              {(['info', 'ai', 'process', 'slice', 'export'] as Tab[]).map((t) => (
                <button key={t} className={tab === t ? 'on' : ''} style={{ flex: 1, textAlign: 'center' }} onClick={() => setTab(t)}>
                  {{ info: 'Info', ai: 'AI', process: 'Process', slice: 'Slice', export: 'Export' }[t]}
                </button>
              ))}
            </div>
            {tab === 'info' && <InfoPanel a={a} onSave={(b) => update.mutate(b)} />}
            {tab === 'ai' && <AiPanel a={a} />}
            {tab === 'process' && <ProcessPanel a={a} palette={project.data?.effectivePalette ?? []} onPreview={setPreview} />}
            {tab === 'slice' && <SlicePanel a={a} />}
            {tab === 'export' && (
              <div className="panel"><div className="panel-body">
                <ExportPicker onExport={(format, scale) => void download(`/api/v1/assets/${a.id}/export${qs({ format, scale })}`).catch((e) => toast('error', (e as Error).message))} />
                <p className="small muted">Game-engine packages include ready-to-use resources: Godot SpriteFrames/TileSet, Unity .meta with Point filtering and slicing, Phaser atlas + animations.</p>
              </div></div>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}

function Variants({ a }: { a: AssetDetail }) {
  const list = [...(a.parent ? [a.parent] : []), a, ...a.variants];
  if (list.length <= 1) return null;
  return (
    <div className="panel">
      <div className="panel-head"><h3>Variants & derived assets</h3><span className="mono small muted">{a.variants.length}</span></div>
      <div className="panel-body" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {list.map((v) => (
          <Link key={v.id} to={`/assets/${v.id}`} title={v.name} className="checker" style={{ width: 72, height: 72, display: 'grid', placeItems: 'center', borderRadius: 4, border: `1px solid ${v.id === a.id ? 'var(--accent)' : 'var(--line)'}` }}>
            <img className="px" src={v.fileUrl} alt={v.name} style={{ maxWidth: '88%', maxHeight: '88%' }} />
          </Link>
        ))}
      </div>
    </div>
  );
}

function InfoPanel({ a, onSave }: { a: AssetDetail; onSave: (b: Record<string, unknown>) => void }) {
  const [name, setName] = useState(a.name);
  const [tags, setTags] = useState(a.tags.join(', '));
  useEffect(() => { setName(a.name); setTags(a.tags.join(', ')); }, [a.id, a.name, a.tags]);
  const gen = useQuery({ queryKey: ['generation', a.generationId], queryFn: () => get<Generation>(`/api/v1/generations/${a.generationId}`), enabled: !!a.generationId });
  return (
    <div className="panel"><div className="panel-body">
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== a.name && onSave({ name })} /></Field>
      <Field label="Tags" hint="Comma separated"><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => onSave({ tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })} /></Field>
      <Field label="Kind">
        <select className="select" value={a.kind} onChange={(e) => onSave({ kind: e.target.value })}>
          {['sprite', 'character', 'object', 'environment', 'tileset', 'texture', 'ui', 'icon', 'spritesheet', 'animation', 'import'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Field>
      <table className="table small">
        <tbody>
          <tr><td className="muted">Size</td><td className="mono">{a.width}×{a.height}px</td></tr>
          {a.frames && <tr><td className="muted">Frames</td><td className="mono">{a.frames.length}{a.meta.fps ? ` @ ${a.meta.fps} fps` : ''}</td></tr>}
          {a.meta.direction && <tr><td className="muted">Direction</td><td className="mono">{a.meta.direction}</td></tr>}
          {a.meta.modelId && <tr><td className="muted">Model</td><td className="mono">{String(a.meta.modelId)}</td></tr>}
          {a.meta.seed !== undefined && <tr><td className="muted">Seed</td><td className="mono">{String(a.meta.seed)}</td></tr>}
          {gen.data && <tr><td className="muted">Cost</td><td className="cost">{fmtUsd(gen.data.actualCost ?? gen.data.estimatedCost)}</td></tr>}
          <tr><td className="muted">Created</td><td>{timeAgo(a.createdAt)}</td></tr>
        </tbody>
      </table>
      {a.meta.prompt && <Field label="Prompt"><div className="small" style={{ color: 'var(--text-2)' }}>{String(a.meta.prompt)}</div></Field>}
      {gen.data?.finalPrompt && <details><summary className="small muted" style={{ cursor: 'pointer' }}>Final prompt sent to the model</summary><div className="code-block" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{gen.data.finalPrompt}</div></details>}
      {a.meta.palette && a.meta.palette.length > 0 && <Field label={`Palette · ${a.meta.palette.length} colors`}><Swatches colors={a.meta.palette} size="sm" max={64} /></Field>}
    </div></div>
  );
}

/** Generic AI job form: live estimate + run. */
function useJob(spec: Record<string, unknown> | null) {
  const qc = useQueryClient();
  const toast = useToast();
  const d = useDebounced(spec, 400);
  const est = useQuery({ queryKey: ['estimate', d], queryFn: () => post<Estimate>('/api/v1/generations/estimate', d), enabled: !!d, retry: false });
  const run = useMutation({
    mutationFn: () => post<Generation>('/api/v1/generations', spec),
    onSuccess: () => { toast('info', 'Job started — results appear in Variants when done'); void qc.invalidateQueries({ queryKey: ['generations'] }); },
    onError: (e) => toast('error', (e as Error).message),
  });
  return { est, run };
}

function CostLine({ est }: { est: ReturnType<typeof useJob>['est'] }) {
  if (est.error) return <div className="notice error small">{(est.error as Error).message}</div>;
  if (!est.data) return <span className="small muted">Estimating…</span>;
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row between"><span className="small muted">{est.data.model.name} · {est.data.calls} call(s)</span><span className="cost">{est.data.estimate.usd === null ? 'after run' : `≈ ${fmtUsd(est.data.estimate.usd)}`}</span></div>
      {est.data.warnings.map((w) => <div key={w} className="small" style={{ color: 'var(--accent)' }}>{w}</div>)}
    </div>
  );
}

function AiPanel({ a }: { a: AssetDetail }) {
  const [mode, setMode] = useState<'variant' | 'directions' | 'animate' | 'removeBg'>('variant');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(2);
  const [lock, setLock] = useState(true);
  const [modelId, setModelId] = useState<string | undefined>();
  const [dirs, setDirs] = useState<4 | 8>(4);
  const [base, setBase] = useState<'south' | 'east'>('south');
  const [action, setAction] = useState('walk cycle');
  const [method, setMethod] = useState<'video' | 'sheet' | 'charsheet'>('video');
  const [frames, setFrames] = useState(8);
  const [fps, setFps] = useState(10);
  useEffect(() => setModelId(undefined), [mode]);

  const spec = useMemo(() => {
    if (mode === 'variant') return prompt.trim() ? { task: 'variant', assetId: a.id, prompt, count, lockPalette: lock, modelId } : null;
    if (mode === 'directions') return { task: 'directions', assetId: a.id, directions: dirs, baseDirection: base, modelId, lockPalette: lock };
    if (mode === 'animate') {
      if (method === 'charsheet') return { task: 'animate', assetId: a.id, method, fps, lockPalette: lock };
      return action.trim() ? { task: 'animate', assetId: a.id, action, method, frames, fps, modelId, lockPalette: lock } : null;
    }
    return { task: 'removeBg', assetId: a.id, modelId };
  }, [mode, prompt, count, lock, modelId, dirs, base, action, method, frames, fps, a.id]);
  const { est, run } = useJob(spec);

  return (
    <div className="panel"><div className="panel-body">
      <Segmented value={mode} onChange={setMode} options={[{ value: 'variant', label: 'Variant' }, { value: 'directions', label: 'Directions' }, { value: 'animate', label: 'Animate' }, { value: 'removeBg', label: 'Cutout' }]} />
      {mode === 'variant' && <>
        <Field label="What should change?"><textarea className="textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. red armor, holding a shield · winter version · damaged state" /></Field>
        <Field label="Count"><Segmented value={String(count)} onChange={(v) => setCount(Number(v))} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: n }))} /></Field>
        <Field label="Model"><ModelPicker capability="edit" alsoCapability="img2img" value={modelId} onChange={setModelId} /></Field>
      </>}
      {mode === 'directions' && <>
        <p className="small muted">The current image is the base view. West-facing views are mirrored for free; a direction sheet is created too.</p>
        <div className="grid-2">
          <Field label="Directions"><Segmented value={String(dirs)} onChange={(v) => setDirs(Number(v) as 4 | 8)} options={[{ value: '4', label: '4' }, { value: '8', label: '8' }]} /></Field>
          <Field label="This image faces"><Segmented value={base} onChange={setBase} options={[{ value: 'south', label: 'Front' }, { value: 'east', label: 'Right' }]} /></Field>
        </div>
        <Field label="Model"><ModelPicker capability="edit" value={modelId} onChange={setModelId} /></Field>
      </>}
      {mode === 'animate' && <>
        <Field label="Method"><Segmented value={method} onChange={setMethod} options={[{ value: 'video', label: 'Video (Wan)' }, { value: 'sheet', label: 'Sprite sheet' }, { value: 'charsheet', label: 'Character sheet' }]} /></Field>
        {method === 'charsheet' ? <>
          <p className="small muted">One call to Qwen Image Edit 2511 with a pixel-art sprite-sheet LoRA draws a full sheet of 32×48 frames for 4 directions: 3 walk, 2 attack and 1 hurt frame each. You get the named 24-frame sheet plus a looping walk animation per direction.</p>
          <Field label="FPS"><input className="input mono" type="number" min={2} max={30} value={fps} onChange={(e) => setFps(Number(e.target.value))} /></Field>
        </> : <>
        <Field label="Action"><input className="input" value={action} onChange={(e) => setAction(e.target.value)} placeholder="walk cycle, idle breathing, attack…" /></Field>
        <div className="row wrap" style={{ gap: 4 }}>{['idle breathing', 'walk cycle', 'run cycle', 'jump', 'sword attack', 'cast a spell', 'hurt', 'death'].map((x) => <button key={x} className="chip" style={{ cursor: 'pointer' }} onClick={() => setAction(x)}>{x}</button>)}</div>
        <div className="grid-2">
          <Field label="Frames"><input className="input mono" type="number" min={2} max={24} value={frames} onChange={(e) => setFrames(Number(e.target.value))} /></Field>
          <Field label="FPS"><input className="input mono" type="number" min={2} max={30} value={fps} onChange={(e) => setFps(Number(e.target.value))} /></Field>
        </div>
        <Field label="Model"><ModelPicker capability={method === 'video' ? 'animate' : 'edit'} value={modelId} onChange={setModelId} /></Field>
        </>}
      </>}
      {mode === 'removeBg' && <>
        <p className="small muted">Uses an AI segmentation model for complex backgrounds. For flat backgrounds, the free <em>Remove background</em> step in Process is enough.</p>
        <Field label="Model"><ModelPicker capability="removeBg" value={modelId} onChange={setModelId} /></Field>
      </>}
      {mode !== 'removeBg' && <label className="check"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Lock to this asset's palette ({a.meta.palette?.length ?? '?'} colors)</label>}
      {spec && <CostLine est={est} />}
      <button className="btn primary" disabled={!spec || run.isPending} onClick={() => run.mutate()}><Icon name="wand" /> Run</button>
    </div></div>
  );
}

const PRESETS: { label: string; steps: (palette: string[]) => Step[] }[] = [
  { label: 'Clean AI output', steps: () => [{ op: 'hardenAlpha' }, { op: 'removeOrphans' }, { op: 'fillPinholes' }, { op: 'despeckle' }] },
  { label: 'Project palette', steps: (p) => (p.length ? [{ op: 'applyPalette', palette: p }] : [{ op: 'reduceColors', maxColors: 16 }]) },
  { label: 'Black outline', steps: () => [{ op: 'outline', color: '#000000', mode: 'outer' }] },
  { label: 'Trim', steps: () => [{ op: 'trim' }] },
  { label: 'Remove flat bg', steps: () => [{ op: 'removeBackground', tolerance: 12 }, { op: 'removeKeyColor' }] },
  { label: 'Recolor hue +60°', steps: () => [{ op: 'hsl', hue: 60 }] },
];

function ProcessPanel({ a, palette, onPreview }: { a: AssetDetail; palette: string[]; onPreview: (p: string | null) => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [steps, setSteps] = useState<Step[]>([]);
  const [fromSource, setFromSource] = useState(false);
  const run = useMutation({
    mutationFn: (mode: 'preview' | 'replace' | 'new') => post<Asset & { preview?: string; colors?: number }>(`/api/v1/assets/${a.id}/process`, { steps, mode, fromSource }),
    onSuccess: (r, mode) => {
      if (mode === 'preview') { onPreview(r.preview ?? null); return; }
      onPreview(null);
      void qc.invalidateQueries({ queryKey: ['asset'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      toast('success', mode === 'replace' ? 'Asset updated' : 'Saved as a new variant');
      if (mode === 'new') nav(`/assets/${r.id}`);
    },
    onError: (e) => toast('error', (e as Error).message),
  });
  return (
    <div className="panel"><div className="panel-body">
      <div className="row between"><span className="small muted">Free, deterministic — no AI call.</span><span className="chip green">$0</span></div>
      <div className="row wrap" style={{ gap: 4 }}>
        {PRESETS.map((p) => <button key={p.label} className="chip" style={{ cursor: 'pointer' }} onClick={() => setSteps([...steps, ...p.steps(palette)])}>{p.label}</button>)}
      </div>
      <PipelineEditor steps={steps} onChange={setSteps} extraPalettes={palette.length ? [{ id: 'custom:project', name: 'Project palette', colors: palette }] : []} />
      {a.hasSource && <label className="check"><input type="checkbox" checked={fromSource} onChange={(e) => setFromSource(e.target.checked)} /> Start from the raw AI source (re-pixelize)</label>}
      <div className="row">
        <button className="btn" disabled={!steps.length || run.isPending} onClick={() => run.mutate('preview')}><Icon name="eye" /> Preview</button>
        <div className="grow" />
        <button className="btn" disabled={!steps.length || run.isPending} onClick={() => confirm('Replace this asset in place?') && run.mutate('replace')}>Apply</button>
        <button className="btn primary" disabled={!steps.length || run.isPending} onClick={() => run.mutate('new')}>Save as variant</button>
      </div>
    </div></div>
  );
}

function SlicePanel({ a }: { a: AssetDetail }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<'auto' | 'grid'>('auto');
  const [fw, setFw] = useState(32);
  const [fh, setFh] = useState(32);
  const [align, setAlign] = useState<'bottom' | 'center' | 'none'>('bottom');
  const [fps, setFps] = useState(10);
  const [output, setOutput] = useState<'animation' | 'assets'>('animation');
  const [removeBg, setRemoveBg] = useState(false);
  const m = useMutation({
    mutationFn: () => post<{ items: Asset[] }>(`/api/v1/assets/${a.id}/slice`, { mode, frameWidth: mode === 'grid' ? fw : undefined, frameHeight: mode === 'grid' ? fh : undefined, align, fps, output, removeBackground: removeBg }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset'] });
      toast('success', `${r.items.length} asset(s) created`);
      if (r.items.length === 1) nav(`/assets/${r.items[0].id}`);
    },
    onError: (e) => toast('error', (e as Error).message),
  });
  return (
    <div className="panel"><div className="panel-body">
      <p className="small muted">Cut a spritesheet into frames, align them on a common baseline and build an animation or separate sprites.</p>
      <Field label="Detection"><Segmented value={mode} onChange={setMode} options={[{ value: 'auto', label: 'Automatic (by transparency)' }, { value: 'grid', label: 'Grid' }]} /></Field>
      {mode === 'grid' && (
        <div className="grid-2">
          <Field label="Frame width"><input className="input mono" type="number" min={1} value={fw} onChange={(e) => setFw(Number(e.target.value))} /></Field>
          <Field label="Frame height"><input className="input mono" type="number" min={1} value={fh} onChange={(e) => setFh(Number(e.target.value))} /></Field>
        </div>
      )}
      <Field label="Align frames"><Segmented value={align} onChange={setAlign} options={[{ value: 'bottom', label: 'Bottom' }, { value: 'center', label: 'Center' }, { value: 'none', label: 'None' }]} /></Field>
      <div className="grid-2">
        <Field label="Output"><Segmented value={output} onChange={setOutput} options={[{ value: 'animation', label: 'Animation' }, { value: 'assets', label: 'Sprites' }]} /></Field>
        <Field label="FPS"><input className="input mono" type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Number(e.target.value))} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} /> Remove flat background first</label>
      <button className="btn primary" disabled={m.isPending} onClick={() => m.mutate()}><Icon name="scissors" /> Slice</button>
    </div></div>
  );
}
