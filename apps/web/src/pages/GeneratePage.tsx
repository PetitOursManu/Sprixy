import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, fmtUsd, get, post, qs, type Estimate, type Generation, type Dither, type Model } from '../api';
import { useDebounced, useLoras, useModels, useProject } from '../hooks';
import { Field, Icon, Segmented, Spinner, useToast } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { AssetPicker } from '../components/AssetPicker';
import { JobCard } from '../components/JobCard';

const KINDS = [
  { kind: 'character', label: 'Character', icon: 'compass' },
  { kind: 'sprite', label: 'Sprite', icon: 'cube' },
  { kind: 'object', label: 'Object / item', icon: 'cube' },
  { kind: 'icon', label: 'Icon', icon: 'star' },
  { kind: 'environment', label: 'Environment', icon: 'film' },
  { kind: 'tileset', label: 'Tileset', icon: 'grid' },
  { kind: 'texture', label: 'Texture', icon: 'layers' },
  { kind: 'ui', label: 'UI element', icon: 'sliders' },
] as const;
type Kind = (typeof KINDS)[number]['kind'];

const IDEAS: Record<Kind, string[]> = {
  character: ['a hooded rogue with twin daggers', 'a small slime with a crown', 'an armored knight with a blue cape'],
  sprite: ['a flickering campfire', 'a treasure chest', 'a floating heart pickup'],
  object: ['a wooden barrel', 'a magic potion bottle', 'a stone well'],
  icon: ['a fire sword', 'a mana crystal', 'a leather backpack'],
  environment: ['a mossy forest clearing at dusk', 'a neon cyberpunk alley', 'a desert canyon'],
  tileset: ['grass and dirt path', 'dungeon stone floor and walls', 'snowy ground with ice'],
  texture: ['cobblestone', 'wooden planks', 'lava rock'],
  ui: ['a wooden dialog box frame', 'a health bar with heart', 'a set of square buttons'],
};

const TRANSPARENT: Record<Kind, boolean> = { character: true, sprite: true, object: true, icon: true, ui: true, environment: false, tileset: false, texture: false };

export function GeneratePage() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const qc = useQueryClient();
  const toast = useToast();
  const ad = project.data?.artDirection;
  const [kind, setKind] = useState<Kind>('character');
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [count, setCount] = useState(2);
  const [modelId, setModelId] = useState<string | undefined>();
  const [width, setWidth] = useState<number | undefined>();
  const [height, setHeight] = useState<number | undefined>();
  const [refs, setRefs] = useState<string[] | undefined>();
  const [loraSel, setLoraSel] = useState<{ loraId: string; scale: number }[] | undefined>();
  const [seed, setSeed] = useState<string>('');
  const [bg, setBg] = useState<'flood' | 'ai' | 'none'>('flood');
  const [pixelize, setPixelize] = useState(true);
  const [palette, setPalette] = useState<'project' | 'auto' | 'none'>('project');
  const [maxColors, setMaxColors] = useState<number | undefined>();
  const [dither, setDither] = useState<Dither | ''>('');
  const [outline, setOutline] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [picking, setPicking] = useState(false);

  const models = useModels();
  const loras = useLoras(projectId);
  const effectiveModel: Model | undefined = useMemo(() => {
    const id = modelId ?? ad?.models.image ?? models.data?.defaults.txt2img;
    return models.data?.items.find((m) => m.id === id);
  }, [modelId, ad, models.data]);

  const defaultSize = ad ? (kind === 'icon' ? ad.iconSize : kind === 'environment' ? ad.sceneSize : kind === 'tileset' ? { width: ad.tileSize * 8, height: ad.tileSize * 8 } : kind === 'texture' ? { width: ad.tileSize * 2, height: ad.tileSize * 2 } : kind === 'ui' ? { width: ad.spriteSize.width * 2, height: ad.spriteSize.height } : ad.spriteSize) : { width: 32, height: 32 };
  const activeRefs = refs ?? ad?.referenceAssetIds ?? [];
  const activeLoras = loraSel ?? ad?.loras ?? [];

  useEffect(() => { setWidth(undefined); setHeight(undefined); }, [kind]);

  const spec = useMemo(() => ({
    task: 'generate', projectId, kind, prompt: prompt.trim() || IDEAS[kind][0], name: name || undefined, count, modelId,
    width, height, referenceAssetIds: refs, loras: loraSel, seed: seed ? Number(seed) : undefined,
    postprocess: { removeBackground: TRANSPARENT[kind] ? bg : 'none', pixelize, palette, maxColors, dither: dither || undefined, outline },
  }), [projectId, kind, prompt, name, count, modelId, width, height, refs, loraSel, seed, bg, pixelize, palette, maxColors, dither, outline]);
  const dspec = useDebounced(spec, 450);

  const estimate = useQuery({
    queryKey: ['estimate', dspec],
    queryFn: () => post<Estimate>('/api/v1/generations/estimate', dspec),
    enabled: !!projectId && !!ad,
    retry: false,
  });

  const jobs = useQuery({
    queryKey: ['generations', 'project', projectId],
    queryFn: () => get<{ items: Generation[] }>(`/api/v1/generations${qs({ projectId, limit: 12 })}`),
    refetchInterval: (q) => (q.state.data?.items.some((g) => g.status === 'queued' || g.status === 'running') ? 1500 : false),
  });

  const run = useMutation({
    mutationFn: () => post<Generation>('/api/v1/generations', { ...spec, prompt: prompt.trim() }),
    onSuccess: () => {
      toast('info', 'Generation started');
      void qc.invalidateQueries({ queryKey: ['generations'] });
    },
    onError: (e) => toast('error', e instanceof ApiError ? `${e.message}` : (e as Error).message),
  });

  if (!ad) return <div className="page"><Spinner /></div>;
  const compatibleLoras = (loras.data?.items ?? []).filter((l) => !effectiveModel?.loraFamily || l.family === effectiveModel.loraFamily);
  const est = estimate.data;

  return (
    <div className="page">
      <div className="split">
        <div className="col" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panel-head"><h2>What to generate</h2><span className="small muted mono">native {width ?? defaultSize.width}×{height ?? defaultSize.height}px</span></div>
            <div className="panel-body">
              <div className="kind-pick">
                {KINDS.map((k) => (
                  <button key={k.kind} className={kind === k.kind ? 'on' : ''} onClick={() => setKind(k.kind)}>
                    <Icon name={k.icon} /> {k.label}
                  </button>
                ))}
              </div>
              <Field label="Prompt" hint={<>Describe the subject only — perspective, palette, shading, outline and size come from the <Link to={`/projects/${projectId}/art-direction`}>art direction</Link>.</>}>
                <textarea className="textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={IDEAS[kind].join(' · ')}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) run.mutate(); }} />
              </Field>
              <div className="row wrap" style={{ gap: 6 }}>
                {IDEAS[kind].map((i) => <button key={i} className="chip" style={{ cursor: 'pointer' }} onClick={() => setPrompt(i)}>{i}</button>)}
              </div>
              <div className="grid-4">
                <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="from prompt" /></Field>
                <Field label="Images">
                  <Segmented value={String(count)} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: n }))} onChange={(v) => setCount(Number(v))} />
                </Field>
                <Field label="Width"><input className="input mono" type="number" min={4} max={1024} value={width ?? defaultSize.width} onChange={(e) => setWidth(Number(e.target.value) || undefined)} /></Field>
                <Field label="Height"><input className="input mono" type="number" min={4} max={1024} value={height ?? defaultSize.height} onChange={(e) => setHeight(Number(e.target.value) || undefined)} /></Field>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Model & style</h2></div>
            <div className="panel-body">
              <Field label="Model"><ModelPicker capability="txt2img" alsoCapability="edit" value={modelId} onChange={setModelId} /></Field>
              <Field label={`LoRAs ${effectiveModel?.loraFamily ? `· compatible family: ${effectiveModel.loraFamily}` : '· this model does not support LoRAs'}`}>
                <div className="col" style={{ gap: 6 }}>
                  {activeLoras.map((l, i) => {
                    const info = loras.data?.items.find((x) => x.id === l.loraId);
                    const ok = !effectiveModel?.loraFamily || info?.family === effectiveModel.loraFamily;
                    return (
                      <div key={l.loraId} className="step-item">
                        <span className={ok ? '' : 'muted'} style={{ flex: 1 }}>{info?.name ?? l.loraId}{!ok && ' (incompatible — skipped)'}</span>
                        <input type="range" min={0} max={2} step={0.05} style={{ width: 120 }} value={l.scale} onChange={(e) => setLoraSel(activeLoras.map((x, j) => (j === i ? { ...x, scale: Number(e.target.value) } : x)))} />
                        <span className="mono small" style={{ width: 34 }}>{l.scale.toFixed(2)}</span>
                        <button className="btn ghost sm icon" onClick={() => setLoraSel(activeLoras.filter((_, j) => j !== i))}><Icon name="x" size={13} /></button>
                      </div>
                    );
                  })}
                  {effectiveModel?.loraFamily && activeLoras.length < (effectiveModel.maxLoras ?? 3) && (
                    <select className="select" value="" onChange={(e) => { const l = compatibleLoras.find((x) => x.id === e.target.value); if (l) setLoraSel([...activeLoras, { loraId: l.id, scale: l.defaultScale }]); }}>
                      <option value="">+ Add a LoRA ({compatibleLoras.length} compatible)</option>
                      {compatibleLoras.filter((l) => !activeLoras.some((a) => a.loraId === l.id)).map((l) => <option key={l.id} value={l.id}>{l.name} · {l.source}</option>)}
                    </select>
                  )}
                </div>
              </Field>
              <Field label="Style references" hint={effectiveModel?.capabilities.includes('edit') ? 'The model sees these images and matches their style.' : 'Pick an edit-capable model (e.g. FLUX.2 klein) to use references.'}>
                <div className="row wrap">
                  {activeRefs.map((id) => (
                    <div key={id} className="checker" style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 3, border: '1px solid var(--line)' }}>
                      <img className="px" src={`/api/v1/assets/${id}/file`} alt="" style={{ maxWidth: '90%', maxHeight: '90%' }} />
                    </div>
                  ))}
                  <button className="btn sm" onClick={() => setPicking(true)}>{activeRefs.length ? 'Change' : 'Pick references'}</button>
                  {activeRefs.length > 0 && <button className="btn ghost sm" onClick={() => setRefs([])}>Clear</button>}
                </div>
              </Field>
              <Field label="Seed"><input className="input mono" style={{ width: 160 }} value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} placeholder="random" /></Field>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Pixel-perfect post-processing</h2><span className="chip green">free · deterministic</span></div>
            <div className="panel-body">
              <div className="grid-2">
                {TRANSPARENT[kind] && (
                  <Field label="Background removal">
                    <Segmented value={bg} onChange={setBg} options={[{ value: 'flood', label: 'Flood (free)' }, { value: 'ai', label: 'BiRefNet (AI)' }, { value: 'none', label: 'Keep' }]} />
                  </Field>
                )}
                <Field label="Palette">
                  <Segmented value={palette} onChange={setPalette} options={[{ value: 'project', label: project.data!.effectivePalette.length ? 'Project palette' : 'Project' }, { value: 'auto', label: 'Auto reduce' }, { value: 'none', label: 'Keep' }]} />
                </Field>
                <Field label="Max colors (auto)"><input className="input mono" type="number" min={2} max={256} value={maxColors ?? ad.palette.maxColors} onChange={(e) => setMaxColors(Number(e.target.value) || undefined)} /></Field>
                <Field label="Dithering">
                  <select className="select" value={dither} onChange={(e) => setDither(e.target.value as Dither | '')}>
                    <option value="">Art direction ({ad.dither})</option>
                    {['none', 'floyd-steinberg', 'atkinson', 'bayer2', 'bayer4', 'bayer8'].map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
              </div>
              <div className="row wrap" style={{ gap: 16 }}>
                <label className="check"><input type="checkbox" checked={pixelize} onChange={(e) => setPixelize(e.target.checked)} /> Snap to a true pixel grid at native size</label>
                {TRANSPARENT[kind] && <label className="check"><input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} /> Re-draw 1px outline</label>}
              </div>
            </div>
          </div>
        </div>

        <aside className="col sticky" style={{ gap: 12 }}>
          <div className="panel">
            <div className="panel-body">
              <div className="row between">
                <div className="stat">
                  <span className="k">Estimated cost</span>
                  <span className="v cost">{estimate.isFetching && !est ? '…' : est ? (est.estimate.usd === null ? 'after run' : fmtUsd(est.estimate.usd)) : '—'}</span>
                </div>
                {est && <span className={`chip ${est.estimate.source === 'live' ? 'green' : ''}`}>{est.estimate.source === 'live' ? 'live price' : est.estimate.source === 'catalog' ? 'list price' : 'reported after'}</span>}
              </div>
              {est && <div className="small muted">{est.estimate.breakdown}</div>}
              {estimate.error && <div className="notice error small">{(estimate.error as Error).message}</div>}
              {est?.warnings.map((w) => <div key={w} className="notice warn small">{w}</div>)}
              {effectiveModel && !effectiveModel.available && (
                <div className="notice warn small">No {effectiveModel.provider} key configured. <Link to="/settings">Add your key</Link> — Sprixy is BYOK.</div>
              )}
              <button className="btn primary lg" disabled={!prompt.trim() || run.isPending} onClick={() => run.mutate()}>
                <Icon name="wand" /> Generate {count > 1 ? `${count} images` : ''}
              </button>
              <span className="small muted">Ctrl/⌘ + Enter</span>
              {est && (
                <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowPrompt(!showPrompt)}>{showPrompt ? 'Hide' : 'Show'} final prompt</button>
              )}
              {showPrompt && est && <div className="code-block" style={{ whiteSpace: 'pre-wrap' }}>{est.finalPrompt}</div>}
            </div>
          </div>
          <div className="row between"><span className="label">Recent jobs</span><Link to={`/projects/${projectId}/history`} className="small">All →</Link></div>
          {jobs.data?.items.length === 0 && <div className="small muted">No job yet.</div>}
          {jobs.data?.items.slice(0, 6).map((g) => <JobCard key={g.id} g={g} compact />)}
        </aside>
      </div>
      {picking && <AssetPicker projectId={projectId!} initial={activeRefs} onClose={() => setPicking(false)} onPick={setRefs} />}
    </div>
  );
}
