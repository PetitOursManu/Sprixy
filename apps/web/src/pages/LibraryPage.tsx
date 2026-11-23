import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, download, get, patch, post, qs, timeAgo, type Asset } from '../api';
import { useDebounced, useMeta, useModels } from '../hooks';
import { AssetTile } from '../components/AssetTile';
import { Empty, Field, Icon, Modal, useToast } from '../components/ui';
import { PipelineEditor, type Step } from '../components/PipelineEditor';
import { AutotileModal } from '../components/AutotileModal';

const KINDS = ['', 'sprite', 'character', 'object', 'environment', 'tileset', 'texture', 'ui', 'icon', 'animation', 'spritesheet', 'import'];

interface Collection { id: string; name: string; assetCount: number }

export function LibraryPage() {
  const { projectId } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [tag, setTag] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [rootsOnly, setRootsOnly] = useState(false);
  const [collectionId, setCollectionId] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<null | 'upload' | 'process' | 'export' | 'tag' | 'collection' | 'animation' | 'blank' | 'autotile'>(null);
  const [view, setView] = useState<'list' | 'grid'>(() => (localStorage.getItem('sprixy.libraryView') === 'grid' ? 'grid' : 'list'));
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => localStorage.setItem('sprixy.libraryView', view), [view]);
  const dq = useDebounced(q);
  const fav = useMutation({
    mutationFn: (a: Asset) => patch(`/api/v1/assets/${a.id}`, { favorite: !a.favorite }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['assets'] }),
  });

  const assets = useQuery({
    queryKey: ['assets', projectId, dq, kind, tag, favorite, rootsOnly, collectionId, sort],
    queryFn: () => get<{ total: number; items: Asset[] }>(`/api/v1/assets${qs({ projectId, q: dq, kind, tag, favorite, rootsOnly, collectionId, sort, limit: 300 })}`),
  });
  const tags = useQuery({ queryKey: ['tags', projectId], queryFn: () => get<{ items: { tag: string; count: number }[] }>(`/api/v1/tags${qs({ projectId })}`) });
  const collections = useQuery({ queryKey: ['collections', projectId], queryFn: () => get<{ items: Collection[] }>(`/api/v1/projects/${projectId}/collections`) });

  const batch = useMutation({
    mutationFn: (body: Record<string, unknown>) => post<{ results: { ok: boolean; error?: string }[] }>('/api/v1/assets/batch', { assetIds: [...selected], ...body }),
    onSuccess: (r) => {
      const failed = r.results.filter((x) => !x.ok);
      toast(failed.length ? 'error' : 'success', failed.length ? `${failed.length} failed: ${failed[0].error}` : `Done (${r.results.length})`);
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['tags'] });
      void qc.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (e) => toast('error', (e as Error).message),
  });

  const items = assets.data?.items ?? [];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = items.length > 0 && items.every((a) => selected.has(a.id));
  const focused = items.find((a) => a.id === focusId) ?? items[0];

  return (
    <div className="page">
      <div className="row wrap" style={{ gap: 8 }}>
        <label className="input row" style={{ flex: '1 1 260px', maxWidth: 460, gap: 8, cursor: 'text' }}>
          <Icon name="search" size={14} className="muted" />
          <input style={{ all: 'unset', flex: 1, minWidth: 0 }} placeholder="Search assets, tags, prompts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search assets" />
        </label>
        <select className="select" style={{ width: 140 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          {KINDS.map((k) => <option key={k} value={k}>{k ? k[0].toUpperCase() + k.slice(1) : 'All kinds'}</option>)}
        </select>
        {(collections.data?.items.length ?? 0) > 0 && (
          <select className="select" style={{ width: 160 }} value={collectionId} onChange={(e) => setCollectionId(e.target.value)} aria-label="Collection">
            <option value="">All collections</option>
            {collections.data!.items.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.assetCount})</option>)}
          </select>
        )}
        {(tags.data?.items.length ?? 0) > 0 && (
          <select className="select" style={{ width: 130 }} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
            <option value="">All tags</option>
            {tags.data!.items.slice(0, 60).map((t) => <option key={t.tag} value={t.tag}>#{t.tag} ({t.count})</option>)}
          </select>
        )}
        <button className={`btn icon ${favorite ? 'on' : ''}`} title="Favourites only" aria-pressed={favorite} onClick={() => setFavorite(!favorite)}><Icon name="star" /></button>
        <select className="select" style={{ width: 130 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option>
        </select>
        <label className="check small"><input type="checkbox" checked={rootsOnly} onChange={(e) => setRootsOnly(e.target.checked)} /> Hide variants</label>
        <div className="grow" />
        <div className="segmented" role="group" aria-label="View">
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} title="List"><Icon name="list" size={14} /></button>
          <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} title="Grid"><Icon name="grid" size={14} /></button>
        </div>
        <button className="btn" onClick={() => setModal('collection')} title="New collection"><Icon name="folder" /> Collection</button>
        <button className="btn" onClick={() => setModal('autotile')} title="Build an autotile terrain set from two textures (free)"><Icon name="grid" /> Autotile</button>
        <button className="btn" onClick={() => setModal('blank')}><Icon name="edit" /> Draw</button>
        <button className="btn" onClick={() => setModal('upload')}><Icon name="upload" /> Import</button>
      </div>

      {assets.isLoading ? null : items.length === 0 ? (
        <Empty title="Nothing here yet" action={<div className="row"><Link className="btn primary" to={`/projects/${projectId}/generate`}><Icon name="wand" /> Generate assets</Link><button className="btn" onClick={() => setModal('upload')}>Import images</button></div>}>
          Generate with AI, import existing art (it can be converted to true pixel art for free) or draw from scratch.
        </Empty>
      ) : (
        <div className="split lib">
          <section className="col" style={{ gap: 0, minWidth: 0 }}>
            {selected.size > 0 && (
              <div className="row wrap" style={{ gap: 6, padding: '10px 14px', background: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--line))', borderBottom: 'none', borderRadius: '12px 12px 0 0' }}>
                <span className="row" style={{ gap: 8, fontWeight: 700, color: 'var(--accent-2)', marginRight: 6 }}><span className="chip" style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>{selected.size}</span> selected</span>
                <button className="btn sm ghost" onClick={() => setModal('tag')}>Tag</button>
                <button className="btn sm ghost" onClick={() => batch.mutate({ action: 'favorite' })}>Favourite</button>
                {(collections.data?.items.length ?? 0) > 0 && (
                  <select className="select" style={{ height: 28, width: 150, fontSize: 12 }} value="" onChange={(e) => e.target.value && batch.mutate({ action: 'addToCollection', value: e.target.value })} aria-label="Add to collection">
                    <option value="">Move to collection…</option>
                    {collections.data!.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                <button className="btn sm ghost" onClick={() => setModal('process')}>Apply palette / process</button>
                <button className="btn sm ghost" onClick={() => setModal('animation')}>Make animation</button>
                <button className="btn sm ghost" onClick={() => setModal('export')}>Export</button>
                <div className="grow" />
                <button className="btn sm ghost danger icon" title="Delete" onClick={() => confirm(`Delete ${selected.size} asset(s)? This cannot be undone.`) && batch.mutate({ action: 'delete' }, { onSuccess: () => setSelected(new Set()) })}><Icon name="trash" size={14} /></button>
                <button className="btn sm ghost icon" title="Clear selection" onClick={() => setSelected(new Set())}><Icon name="x" size={14} /></button>
              </div>
            )}
            {view === 'list' ? (
              <div className="panel" style={selected.size > 0 ? { borderTopLeftRadius: 0, borderTopRightRadius: 0 } : undefined}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((a) => a.id)))} aria-label="Select all" style={{ accentColor: 'var(--accent)' }} /></th>
                      <th>Asset</th><th className="hide-mobile">Kind</th><th className="hide-mobile">Size</th><th className="hide-mobile">Details</th><th className="hide-mobile">Tags</th><th className="hide-mobile">Updated</th><th style={{ width: 36 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => (
                      <tr key={a.id} className={focused?.id === a.id ? 'on' : ''} style={{ cursor: 'pointer' }} onClick={() => setFocusId(a.id)} onDoubleClick={() => nav(`/assets/${a.id}`)}>
                        <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} aria-label={`Select ${a.name}`} style={{ accentColor: 'var(--accent)' }} /></td>
                        <td><div className="row" style={{ gap: 12 }}><span className="thumb-cell"><img src={a.fileUrl} alt="" loading="lazy" /></span><span style={{ fontWeight: 600 }}>{a.name}</span></div></td>
                        <td className="hide-mobile" style={{ textTransform: 'capitalize' }}>{a.kind}</td>
                        <td className="hide-mobile mono small muted">{a.width}×{a.height}</td>
                        <td className="hide-mobile small muted" style={{ whiteSpace: 'nowrap' }}>{details(a)}</td>
                        <td className="hide-mobile"><div className="row" style={{ gap: 4 }}>{a.tags.slice(0, 2).map((t) => <span key={t} className="chip">{t}</span>)}</div></td>
                        <td className="hide-mobile small muted">{timeAgo(a.updatedAt)}</td>
                        <td onClick={(e) => e.stopPropagation()}><button className="btn ghost sm icon" title={a.favorite ? 'Unfavourite' : 'Favourite'} style={{ color: a.favorite ? 'var(--accent)' : 'var(--dim)' }} onClick={() => fav.mutate(a)}><Icon name="star" size={15} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="row between small muted" style={{ padding: '12px 16px' }}><span>{items.length} of {assets.data?.total ?? 0} assets</span><span>Double-click to open</span></div>
              </div>
            ) : (
              <div className="card-grid">
                {items.map((a) => (
                  <AssetTile key={a.id} asset={a} selectable selected={selected.has(a.id) || focused?.id === a.id} onToggleSelect={() => toggle(a.id)}
                    onClick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey ? toggle(a.id) : setFocusId(a.id))} />
                ))}
              </div>
            )}
          </section>
          {focused && <Inspector asset={focused} onExport={() => { setSelected(new Set([focused.id])); setModal('export'); }} />}
        </div>
      )}

      {modal === 'upload' && <UploadModal projectId={projectId!} onClose={() => setModal(null)} />}
      {modal === 'autotile' && <AutotileModal projectId={projectId!} onClose={() => setModal(null)} />}
      {modal === 'blank' && <BlankModal projectId={projectId!} onClose={() => setModal(null)} />}
      {modal === 'collection' && <CollectionModal projectId={projectId!} onClose={() => setModal(null)} />}
      {modal === 'tag' && (
        <PromptModal title="Add tags" label="Tags (comma separated)" onClose={() => setModal(null)} onSubmit={(v) => batch.mutate({ action: 'tag', value: v })} />
      )}
      {modal === 'process' && (
        <BatchProcessModal count={selected.size} onClose={() => setModal(null)} onRun={(steps, mode) => batch.mutate({ action: 'process', steps, mode })} />
      )}
      {modal === 'export' && <BatchExportModal ids={[...selected]} onClose={() => setModal(null)} />}
      {modal === 'animation' && <MakeAnimationModal projectId={projectId!} ids={items.filter((a) => selected.has(a.id)).map((a) => a.id)} onClose={() => setModal(null)} />}
    </div>
  );
}

function details(a: Asset): string {
  const parts: string[] = [];
  if (a.frames && a.frames.length > 1) parts.push(`${a.frames.length} frames`);
  if (typeof a.meta.tileSize === 'number' && (a.kind === 'tileset' || a.kind === 'texture')) parts.push(`${a.meta.tileSize}px tiles`);
  if (a.meta.direction) parts.push(String(a.meta.direction));
  if (a.variantCount) parts.push(`${a.variantCount} variant${a.variantCount > 1 ? 's' : ''}`);
  return parts.join(' · ') || '—';
}

function Inspector({ asset: a, onExport }: { asset: Asset; onExport: () => void }) {
  const nav = useNavigate();
  const models = useModels();
  const modelName = models.data?.items.find((m) => m.id === a.meta.modelId)?.name ?? (a.meta.modelId ? String(a.meta.modelId) : null);
  const palette = a.meta.palette ?? [];
  return (
    <aside className="inspector sticky" aria-label="Asset details">
      <div className="row between" style={{ padding: '14px 16px 0' }}>
        <span className="small" style={{ fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)', fontSize: 10.5 }}>Inspector</span>
        <span className="small muted">Asset details</span>
      </div>
      <div className="preview"><img src={a.fileUrl} alt={a.name} /><span className="size">{a.width}×{a.height}</span></div>
      <div style={{ padding: '0 16px 14px' }}>
        <h2 style={{ fontSize: 19 }}>{a.name}</h2>
        <div className="small muted" style={{ textTransform: 'capitalize', marginTop: 2 }}>{a.kind}{a.frames && a.frames.length > 1 ? ` · ${a.frames.length} frames` : ''}</div>
        <div className="grid-2" style={{ marginTop: 14, gap: 8 }}>
          <button className="btn primary" onClick={() => nav(`/assets/${a.id}`)}><Icon name="eye" /> Open</button>
          <button className="btn" onClick={() => nav(`/assets/${a.id}/edit`)}><Icon name="edit" /> Edit pixels</button>
          <button className="btn" onClick={() => nav(`/assets/${a.id}?tab=ai`)}><Icon name="play" /> Animate</button>
          <button className="btn" onClick={onExport}><Icon name="download" /> Export</button>
        </div>
      </div>
      {a.meta.prompt && (
        <section>
          <span className="label" style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>Prompt</span>
          <div className="notice small" style={{ background: 'var(--bg)' }}>“{a.meta.prompt}”</div>
        </section>
      )}
      <section>
        <dl>
          {modelName && <><dt>Model</dt><dd>{modelName}</dd></>}
          {typeof a.meta.seed === 'number' && <><dt>Seed</dt><dd>{a.meta.seed}</dd></>}
          <dt>Updated</dt><dd>{timeAgo(a.updatedAt)}</dd>
        </dl>
      </section>
      {palette.length > 0 && (
        <section>
          <div className="row between"><span className="label" style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>Palette</span><span className="small muted">{palette.length} colours</span></div>
          <div className="palette-strip" style={{ height: 16 }}>{palette.map((c, i) => <span key={i} style={{ background: c }} title={c} />)}</div>
        </section>
      )}
      {a.tags.length > 0 && (
        <section>
          <span className="label" style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>Tags</span>
          <div className="row wrap" style={{ gap: 6 }}>{a.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>
        </section>
      )}
    </aside>
  );
}

function PromptModal({ title, label, onClose, onSubmit }: { title: string; label: string; onClose: () => void; onSubmit: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!v.trim()} onClick={() => { onSubmit(v); onClose(); }}>Apply</button></>}>
      <Field label={label}><input className="input" value={v} onChange={(e) => setV(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

function CollectionModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const m = useMutation({
    mutationFn: () => post(`/api/v1/projects/${projectId}/collections`, { name }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['collections'] }); onClose(); },
  });
  return (
    <Modal title="New collection" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={() => m.mutate()}>Create</button></>}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Forest enemies" /></Field>
    </Modal>
  );
}

function BlankModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState('New sprite');
  const [w, setW] = useState(32);
  const [h, setH] = useState(32);
  const m = useMutation({ mutationFn: () => post<Asset>('/api/v1/assets/blank', { projectId, name, width: w, height: h }), onSuccess: (a) => nav(`/assets/${a.id}/edit`) });
  return (
    <Modal title="Draw a new sprite" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => m.mutate()}>Open editor</button></>}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid-2">
        <Field label="Width"><input className="input" type="number" min={1} max={1024} value={w} onChange={(e) => setW(Number(e.target.value))} /></Field>
        <Field label="Height"><input className="input" type="number" min={1} max={1024} value={h} onChange={(e) => setH(Number(e.target.value))} /></Field>
      </div>
    </Modal>
  );
}

function UploadModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState('import');
  const [convert, setConvert] = useState(false);
  const [steps, setSteps] = useState<Step[]>([{ op: 'pixelize', width: 64, height: 64 }, { op: 'reduceColors', maxColors: 24 }, { op: 'removeOrphans' }]);
  const m = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('projectId', projectId);
      fd.append('kind', kind);
      if (convert) fd.append('pipeline', JSON.stringify(steps));
      for (const f of files) fd.append('files', f, f.name);
      return api<{ items: Asset[] }>('POST', '/api/v1/assets/upload', fd);
    },
    onSuccess: (r) => { toast('success', `Imported ${r.items.length} image(s)`); void qc.invalidateQueries({ queryKey: ['assets'] }); onClose(); },
    onError: (e) => toast('error', (e as Error).message),
  });
  return (
    <Modal wide title="Import images" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!files.length || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Importing…' : `Import ${files.length || ''}`}</button></>}>
      <div className="empty" style={{ cursor: 'pointer', padding: 24 }} onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); }}>
        <Icon name="upload" size={22} />
        <span>{files.length ? `${files.length} file(s): ${files.map((f) => f.name).slice(0, 4).join(', ')}` : 'Drop PNG / JPEG / WebP / GIF here or click to browse'}</span>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => setFiles([...(e.target.files ?? [])])} />
      </div>
      <div className="grid-2">
        <Field label="Kind">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.filter(Boolean).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Conversion"><label className="check" style={{ height: 32 }}><input type="checkbox" checked={convert} onChange={(e) => setConvert(e.target.checked)} /> Convert to true pixel art (free, deterministic)</label></Field>
      </div>
      {convert && <PipelineEditor steps={steps} onChange={setSteps} />}
    </Modal>
  );
}

function BatchProcessModal({ count, onClose, onRun }: { count: number; onClose: () => void; onRun: (steps: Step[], mode: 'replace' | 'new') => void }) {
  const [steps, setSteps] = useState<Step[]>([{ op: 'applyPalette', presetId: 'pico-8' }]);
  const [mode, setMode] = useState<'replace' | 'new'>('new');
  return (
    <Modal wide title={`Batch process ${count} asset(s)`} onClose={onClose} footer={<>
      <select className="select" style={{ width: 220 }} value={mode} onChange={(e) => setMode(e.target.value as 'replace' | 'new')}>
        <option value="new">Save results as new variants</option>
        <option value="replace">Replace originals in place</option>
      </select>
      <div className="grow" />
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!steps.length} onClick={() => { onRun(steps, mode); onClose(); }}>Run on {count}</button>
    </>}>
      <p className="muted small">Deterministic processing runs on this server — no AI provider is called and nothing is billed.</p>
      <PipelineEditor steps={steps} onChange={setSteps} />
    </Modal>
  );
}

const EXPORTS: { id: string; label: string; hint: string }[] = [
  { id: 'png', label: 'PNG', hint: 'Transparent PNG per asset' },
  { id: 'gif', label: 'GIF', hint: 'Animated GIF (animations)' },
  { id: 'webp', label: 'WebP', hint: 'Lossless, animated when frames exist' },
  { id: 'spritesheet', label: 'Spritesheet', hint: 'Packed PNG + JSON atlas' },
  { id: 'zip', label: 'Bundle', hint: 'PNG, WebP, GIF, frames, JSON' },
  { id: 'godot', label: 'Godot 4', hint: 'SpriteFrames / TileSet .tres' },
  { id: 'unity', label: 'Unity', hint: 'PNG + .meta (Point, sliced)' },
  { id: 'phaser', label: 'Phaser', hint: 'Atlas + anims JSON, Tiled .tsx' },
  { id: 'aseprite', label: 'Aseprite', hint: '.aseprite with layers & frames' },
];

export function ExportPicker({ onExport, busy }: { onExport: (format: string, scale: number) => void; busy?: boolean }) {
  const [format, setFormat] = useState('png');
  const [scale, setScale] = useState(1);
  return (
    <div className="col">
      <div className="grid-4">
        {EXPORTS.map((e) => (
          <button key={e.id} className={`model-opt ${format === e.id ? 'on' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }} onClick={() => setFormat(e.id)}>
            <strong>{e.label}</strong><span className="small muted">{e.hint}</span>
          </button>
        ))}
      </div>
      <div className="row">
        <Field label="Scale (nearest neighbour)">
          <select className="select" style={{ width: 120 }} value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            {[1, 2, 3, 4, 6, 8, 10, 12, 16].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </Field>
        <div className="grow" />
        <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={busy} onClick={() => onExport(format, scale)}><Icon name="download" /> Download</button>
      </div>
    </div>
  );
}

function BatchExportModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Modal wide title={`Export ${ids.length} asset(s)`} onClose={onClose}>
      <ExportPicker busy={busy} onExport={async (format, scale) => {
        setBusy(true);
        try { await download('/api/v1/exports', { assetIds: ids, format, scale }); onClose(); }
        catch (e) { toast('error', (e as Error).message); }
        finally { setBusy(false); }
      }} />
    </Modal>
  );
}

function MakeAnimationModal({ projectId, ids, onClose }: { projectId: string; ids: string[]; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const meta = useMeta();
  void meta;
  const [name, setName] = useState('Animation');
  const [fps, setFps] = useState(8);
  const [align, setAlign] = useState('bottom');
  const m = useMutation({
    mutationFn: () => post<Asset>('/api/v1/animations', { projectId, assetIds: ids, name, fps, align }),
    onSuccess: (a) => nav(`/assets/${a.id}`),
    onError: (e) => toast('error', (e as Error).message),
  });
  return (
    <Modal title="Build animation from selection" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => m.mutate()}>Create animation</button></>}>
      <p className="muted small">Frames use the library order ({ids.length} frames). Content is aligned so the loop doesn't jitter.</p>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid-2">
        <Field label="FPS"><input className="input" type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Number(e.target.value))} /></Field>
        <Field label="Align"><select className="select" value={align} onChange={(e) => setAlign(e.target.value)}><option value="bottom">Bottom (feet)</option><option value="center">Center</option><option value="none">None</option></select></Field>
      </div>
    </Modal>
  );
}
