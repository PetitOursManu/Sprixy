import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, download, get, patch, post, qs } from '../api';
import { useProjects } from '../hooks';
import { Empty, Field, Icon, Modal, useToast } from '../components/ui';
import { AssetPicker } from '../components/AssetPicker';

interface Dataset { id: string; name: string; description: string; defaultCaption: string; projectId: string | null; imageCount: number; confirmedCount: number; createdAt: number }
interface DatasetDetail { id: string; name: string; description: string; defaultCaption: string; projectId: string | null; images: { id: string; caption: string; sourceNote: string; rightsConfirmed: boolean; url: string }[] }

export function DatasetsPage() {
  const q = useQuery({ queryKey: ['datasets'], queryFn: () => get<{ items: Dataset[] }>('/api/v1/datasets') });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="topbar"><div className="crumbs"><strong>Datasets</strong></div></div>
      <div className="page">
        <div className="page-head">
          <div><h1>Training datasets</h1><p>Collections of images you own or are authorized to use, for training LoRAs.</p></div>
          <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" /> New dataset</button>
        </div>
        {(q.data?.items.length ?? 0) === 0 ? <Empty title="No dataset yet" action={<button className="btn primary" onClick={() => setCreating(true)}>Create a dataset</button>}>10–30 consistent images give the best style LoRAs.</Empty> : (
          <div className="card-grid big">
            {q.data!.items.map((d) => (
              <Link key={d.id} to={`/datasets/${d.id}`} className="panel" style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="panel-body">
                  <div className="row between"><strong>{d.name}</strong><span className="chip">{d.imageCount} images</span></div>
                  <span className="small muted">{d.description || 'No description'}</span>
                  {d.confirmedCount < d.imageCount && <span className="chip red">{d.imageCount - d.confirmedCount} unconfirmed</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      {creating && <NewDataset onClose={() => setCreating(false)} />}
    </>
  );
}

function NewDataset({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const projects = useProjects();
  const [f, setF] = useState({ name: '', description: '', defaultCaption: '', projectId: '' });
  const m = useMutation({ mutationFn: () => post<{ id: string }>('/api/v1/datasets', { ...f, projectId: f.projectId || undefined }), onSuccess: (r) => nav(`/datasets/${r.id}`) });
  return (
    <Modal title="New dataset" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.name} onClick={() => m.mutate()}>Create</button></>}>
      <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
      <Field label="Description"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Default caption" hint="Used for images without their own caption, e.g. 'pixel art sprite, 16-bit style'."><input className="input" value={f.defaultCaption} onChange={(e) => setF({ ...f, defaultCaption: e.target.value })} /></Field>
      <Field label="Project"><select className="select" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">None</option>{projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    </Modal>
  );
}

export function DatasetPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const projects = useProjects();
  const q = useQuery({ queryKey: ['dataset', id], queryFn: () => get<DatasetDetail>(`/api/v1/datasets/${id}`) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [rights, setRights] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['dataset', id] }); void qc.invalidateQueries({ queryKey: ['datasets'] }); };
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      fd.append('rightsConfirmed', 'true');
      for (const f of files) fd.append('files', f, f.name);
      return api<{ added: number }>('POST', `/api/v1/datasets/${id}/upload`, fd);
    },
    onSuccess: (r) => { toast('success', `${r.added} image(s) added`); refresh(); },
    onError: (e) => toast('error', (e as Error).message),
  });
  const addAssets = useMutation({ mutationFn: (assetIds: string[]) => post(`/api/v1/datasets/${id}/images`, { assetIds, rightsConfirmed: true }), onSuccess: refresh, onError: (e) => toast('error', (e as Error).message) });
  const caption = useMutation({ mutationFn: ({ imageId, caption }: { imageId: string; caption: string }) => patch(`/api/v1/datasets/${id}/images/${imageId}`, { caption }) });
  const removeImg = useMutation({ mutationFn: (imageId: string) => del(`/api/v1/datasets/${id}/images/${imageId}`), onSuccess: refresh });
  const removeDs = useMutation({ mutationFn: () => del(`/api/v1/datasets/${id}`), onSuccess: () => { refresh(); nav('/datasets'); } });
  const d = q.data;
  if (!d) return null;
  return (
    <>
      <div className="topbar"><div className="crumbs"><Link to="/datasets">Datasets</Link><span>/</span><strong>{d.name}</strong></div><div className="grow" /><button className="btn danger" onClick={() => confirm('Delete this dataset?') && removeDs.mutate()}><Icon name="trash" /></button></div>
      <div className="page">
        <div className="panel"><div className="panel-body">
          <label className="check"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> I own these images or am authorized to use them to train a model.</label>
          <div className="row wrap">
            <button className="btn" disabled={!rights} onClick={() => fileRef.current?.click()}><Icon name="upload" /> Upload images</button>
            <select className="select" style={{ width: 260 }} disabled={!rights} value="" onChange={(e) => setPicking(e.target.value || null)}>
              <option value="">Add from a project library…</option>
              {projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="small muted">{d.images.length} images · default caption: <em>{d.defaultCaption || 'none'}</em></span>
            <div className="grow" />
            <button className="btn" disabled={!d.images.length} title="Images + captions ready for ai-toolkit, kohya, OneTrainer, Civitai… (free)" onClick={() => { const t = prompt('Trigger word to prepend to captions (optional)') ?? undefined; void download(`/api/v1/datasets/${d.id}/export${qs({ triggerWord: t || undefined })}`).catch((e) => toast('error', (e as Error).message)); }}><Icon name="download" /> Export for external training</button>
            <Link className="btn primary" to="/loras">Train on fal.ai →</Link>
          </div>
          <input ref={fileRef} type="file" multiple accept="image/*" hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) upload.mutate(f); e.target.value = ''; }} />
        </div></div>
        {d.images.length === 0 ? <Empty title="No image yet">Pixel art is upscaled with nearest-neighbour before training so the trainer sees crisp pixels.</Empty> : (
          <div className="card-grid">
            {d.images.map((im) => (
              <div key={im.id} className="tile" style={{ cursor: 'default' }}>
                <div className="thumb"><img src={im.url} alt="" /></div>
                <div className="meta">
                  <input className="input" style={{ height: 26, fontSize: 12 }} defaultValue={im.caption} placeholder="caption (optional)" onBlur={(e) => e.target.value !== im.caption && caption.mutate({ imageId: im.id, caption: e.target.value })} />
                  <div className="row between"><span className="sub">{im.rightsConfirmed ? '✓ authorized' : 'unconfirmed'}</span><button className="btn ghost sm icon" onClick={() => removeImg.mutate(im.id)}><Icon name="trash" size={13} /></button></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {picking && <AssetPicker projectId={picking} max={100} title="Add assets to the dataset" onClose={() => setPicking(null)} onPick={(ids) => ids.length && addAssets.mutate(ids)} />}
    </>
  );
}
