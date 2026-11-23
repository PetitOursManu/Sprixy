import { useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, download, get, post, qs, type Asset } from '../api';
import { useDebounced, useMeta } from '../hooks';
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
  const dq = useDebounced(q);

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

  return (
    <div className="page">
      <div className="split left" style={{ gridTemplateColumns: '220px minmax(0,1fr)' }}>
        <aside className="col sticky" style={{ gap: 14 }}>
          <input className="input" placeholder="Search name, prompt, tag…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Field label="Kind">
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k} value={k}>{k || 'All kinds'}</option>)}
            </select>
          </Field>
          <label className="check"><input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} /> Favorites only</label>
          <label className="check"><input type="checkbox" checked={rootsOnly} onChange={(e) => setRootsOnly(e.target.checked)} /> Hide variants</label>
          <Field label="Sort">
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name">Name</option>
            </select>
          </Field>
          <div className="col" style={{ gap: 6 }}>
            <div className="row between"><span className="label">Collections</span><button className="btn ghost sm icon" title="New collection" onClick={() => setModal('collection')}><Icon name="plus" size={14} /></button></div>
            <button className={`btn sm ${collectionId === '' ? 'on' : 'ghost'}`} style={{ justifyContent: 'flex-start' }} onClick={() => setCollectionId('')}>All assets</button>
            {collections.data?.items.map((c) => (
              <button key={c.id} className={`btn sm ${collectionId === c.id ? 'on' : 'ghost'}`} style={{ justifyContent: 'space-between' }} onClick={() => setCollectionId(c.id)}>
                <span>{c.name}</span><span className="mono muted">{c.assetCount}</span>
              </button>
            ))}
          </div>
          {(tags.data?.items.length ?? 0) > 0 && (
            <div className="col" style={{ gap: 6 }}>
              <span className="label">Tags</span>
              <div className="row wrap" style={{ gap: 4 }}>
                {tags.data!.items.slice(0, 40).map((t) => (
                  <button key={t.tag} className={`chip ${tag === t.tag ? 'accent' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setTag(tag === t.tag ? '' : t.tag)}>{t.tag} <span className="muted">{t.count}</span></button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className="col" style={{ gap: 12, minWidth: 0 }}>
          <div className="row between wrap">
            <div className="row">
              <span className="mono muted small">{assets.data?.total ?? 0} assets</span>
              {items.length > 0 && <button className="btn ghost sm" onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((a) => a.id)))}>{allSelected ? 'Clear selection' : 'Select all'}</button>}
            </div>
            <div className="row">
              <button className="btn" onClick={() => setModal('autotile')} title="Build an autotile terrain set from two textures (free)"><Icon name="grid" /> Autotile</button>
              <button className="btn" onClick={() => setModal('blank')}><Icon name="edit" /> Draw</button>
              <button className="btn" onClick={() => setModal('upload')}><Icon name="upload" /> Import</button>
              <Link className="btn primary" to={`/projects/${projectId}/generate`}><Icon name="wand" /> Generate</Link>
            </div>
          </div>
          {assets.isLoading ? null : items.length === 0 ? (
            <Empty title="Nothing here yet" action={<div className="row"><Link className="btn primary" to={`/projects/${projectId}/generate`}><Icon name="wand" /> Generate assets</Link><button className="btn" onClick={() => setModal('upload')}>Import images</button></div>}>
              Generate with AI, import existing art (it can be converted to true pixel art for free) or draw from scratch.
            </Empty>
          ) : (
            <div className="card-grid">
              {items.map((a) => (
                <AssetTile key={a.id} asset={a} selectable selected={selected.has(a.id)} onToggleSelect={() => toggle(a.id)}
                  onClick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey || selected.size > 0 ? toggle(a.id) : nav(`/assets/${a.id}`))} />
              ))}
            </div>
          )}
          {selected.size > 0 && (
            <div className="batchbar">
              <span className="chip accent">{selected.size} selected</span>
              <button className="btn sm" onClick={() => setModal('process')}><Icon name="sliders" size={14} /> Process</button>
              <button className="btn sm" onClick={() => setModal('export')}><Icon name="download" size={14} /> Export</button>
              <button className="btn sm" onClick={() => setModal('animation')}><Icon name="film" size={14} /> Make animation</button>
              <button className="btn sm" onClick={() => setModal('tag')}>Tag</button>
              <button className="btn sm" onClick={() => batch.mutate({ action: 'favorite' })}>★ Favorite</button>
              {(collections.data?.items.length ?? 0) > 0 && (
                <select className="select" style={{ height: 26, width: 150, fontSize: 12 }} value="" onChange={(e) => e.target.value && batch.mutate({ action: 'addToCollection', value: e.target.value })}>
                  <option value="">Add to collection…</option>
                  {collections.data!.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <button className="btn sm danger" onClick={() => confirm(`Delete ${selected.size} asset(s)? This cannot be undone.`) && batch.mutate({ action: 'delete' }, { onSuccess: () => setSelected(new Set()) })}><Icon name="trash" size={14} /></button>
              <button className="btn ghost sm icon" onClick={() => setSelected(new Set())}><Icon name="x" size={14} /></button>
            </div>
          )}
        </section>
      </div>

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
  { id: 'phaser', label: 'Phaser', hint: 'Atlas JSON + anims JSON' },
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
