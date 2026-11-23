import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, fmtUsd, get, patch, post, type Estimate, type Lora } from '../api';
import { useDebounced, useLoras, useModels, useProjects } from '../hooks';
import { Empty, Field, Icon, Modal, Segmented, useToast } from '../components/ui';
import { priceLabel } from '../components/ModelPicker';

const FAMILIES = [
  { id: 'z-image', label: 'Z-Image Turbo' },
  { id: 'flux2-klein-4b', label: 'FLUX.2 klein 4B' },
  { id: 'flux2-klein-9b', label: 'FLUX.2 klein 9B' },
  { id: 'flux2-dev', label: 'FLUX.2 dev' },
  { id: 'qwen-image', label: 'Qwen Image' },
  { id: 'qwen-image-edit-2511', label: 'Qwen Image Edit 2511' },
  { id: 'flux1', label: 'FLUX.1 dev' },
];

interface Dataset { id: string; name: string; imageCount: number; confirmedCount: number; defaultCaption: string }

export function LorasPage() {
  const loras = useLoras();
  const projects = useProjects();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<null | 'import' | 'train'>(null);
  const [filter, setFilter] = useState<'all' | 'preset' | 'import' | 'trained'>('all');
  const items = (loras.data?.items ?? []).filter((l) => filter === 'all' || l.source === filter);
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/v1/loras/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['loras'] }) });
  const assign = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string | null }) => patch(`/api/v1/loras/${id}`, { projectId }),
    onSuccess: () => { toast('success', 'LoRA updated'); void qc.invalidateQueries({ queryKey: ['loras'] }); },
  });
  const setScale = useMutation({ mutationFn: ({ id, defaultScale }: { id: string; defaultScale: number }) => patch(`/api/v1/loras/${id}`, { defaultScale }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['loras'] }) });

  return (
    <>
      <div className="topbar"><div className="crumbs"><strong>LoRAs</strong></div></div>
      <div className="page">
        <div className="page-head">
          <div>
            <h1>LoRAs</h1>
            <p>Style adapters: pick community presets, import compatible LoRAs, or train your own on fal.ai with your images.</p>
          </div>
          <div className="row">
            <button className="btn" onClick={() => setModal('import')}><Icon name="link" /> Import LoRA</button>
            <button className="btn primary" onClick={() => setModal('train')}><Icon name="wand" /> Train a LoRA</button>
          </div>
        </div>
        <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'preset', label: 'Presets' }, { value: 'import', label: 'Imported' }, { value: 'trained', label: 'Trained' }]} />
        {items.length === 0 ? <Empty title="No LoRA in this view" /> : (
          <table className="table panel">
            <thead><tr><th>Name</th><th>Family</th><th>Source</th><th>Trigger</th><th>Default scale</th><th>Project</th><th /></tr></thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{l.name}</div>
                    <div className="small muted" style={{ maxWidth: 420 }}>{l.description}{l.url && <> · <a href={l.url} target="_blank" rel="noreferrer">model page</a></>}{l.license && <> · {l.license}</>}</div>
                  </td>
                  <td><span className="chip">{l.family}</span></td>
                  <td><span className={`chip ${l.source === 'trained' ? 'green' : l.source === 'preset' ? 'cyan' : ''}`}>{l.source}</span></td>
                  <td className="mono small">{l.triggerWord ?? '—'}</td>
                  <td>{l.source === 'preset' ? <span className="mono">{l.defaultScale}</span> : (
                    <input className="input mono" style={{ width: 70, height: 26 }} type="number" step={0.05} min={0} max={4} defaultValue={l.defaultScale} onBlur={(e) => setScale.mutate({ id: l.id, defaultScale: Number(e.target.value) })} />
                  )}</td>
                  <td>{l.source === 'preset' ? <span className="muted small">global</span> : (
                    <select className="select" style={{ height: 26, fontSize: 12 }} value={l.projectId ?? ''} onChange={(e) => assign.mutate({ id: l.id, projectId: e.target.value || null })}>
                      <option value="">All projects</option>
                      {projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}</td>
                  <td>{l.source !== 'preset' && <button className="btn ghost sm icon danger" onClick={() => confirm(`Delete LoRA "${l.name}"?`) && remove.mutate(l.id)}><Icon name="trash" size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {modal === 'import' && <ImportLoraModal onClose={() => setModal(null)} />}
      {modal === 'train' && <TrainModal onClose={() => setModal(null)} />}
    </>
  );
}

function ImportLoraModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const projects = useProjects();
  const [f, setF] = useState({ name: '', family: 'z-image', path: '', triggerWord: '', defaultScale: 1, projectId: '' });
  const m = useMutation({
    mutationFn: () => post('/api/v1/loras', { ...f, triggerWord: f.triggerWord || undefined, projectId: f.projectId || undefined }),
    onSuccess: () => { toast('success', 'LoRA imported'); void qc.invalidateQueries({ queryKey: ['loras'] }); onClose(); },
    onError: (e) => toast('error', (e as Error).message),
  });
  return (
    <Modal title="Import a LoRA" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.name || !f.path} onClick={() => m.mutate()}>Import</button></>}>
      <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Compatible base model (family)" hint="The LoRA must have been trained for this base model, or generations will ignore it.">
        <select className="select" value={f.family} onChange={(e) => setF({ ...f, family: e.target.value })}>{FAMILIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
      </Field>
      <Field label="Weights" hint="https URL of a .safetensors file (Hugging Face, fal storage…) or a Hugging Face repo id like owner/repo."><input className="input mono" value={f.path} onChange={(e) => setF({ ...f, path: e.target.value })} placeholder="https://huggingface.co/…/resolve/main/lora.safetensors" /></Field>
      <div className="grid-2">
        <Field label="Trigger word"><input className="input" value={f.triggerWord} onChange={(e) => setF({ ...f, triggerWord: e.target.value })} /></Field>
        <Field label="Default scale"><input className="input mono" type="number" step={0.05} min={0} max={4} value={f.defaultScale} onChange={(e) => setF({ ...f, defaultScale: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Project"><select className="select" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">All projects</option>{projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    </Modal>
  );
}

function TrainModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const trainers = useModels('train');
  const projects = useProjects();
  const datasets = useQuery({ queryKey: ['datasets'], queryFn: () => get<{ items: Dataset[] }>('/api/v1/datasets') });
  const [name, setName] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [modelId, setModelId] = useState('fal:z-image-trainer');
  const [steps, setSteps] = useState(1000);
  const [triggerWord, setTriggerWord] = useState('');
  const [trainingType, setTrainingType] = useState<'style' | 'content' | 'balanced'>('style');
  const [projectId, setProjectId] = useState('');
  const [confirmCost, setConfirmCost] = useState(false);
  const spec = useMemo(() => (datasetId && name ? { task: 'train', name, datasetId, modelId, steps, triggerWord: triggerWord || undefined, trainingType, projectId: projectId || undefined } : null), [name, datasetId, modelId, steps, triggerWord, trainingType, projectId]);
  const d = useDebounced(spec, 400);
  const est = useQuery({ queryKey: ['estimate', d], queryFn: () => post<Estimate>('/api/v1/generations/estimate', d), enabled: !!d, retry: false });
  const run = useMutation({
    mutationFn: () => post('/api/v1/generations', spec),
    onSuccess: () => { toast('success', 'Training started — it appears in Jobs; the LoRA is added automatically when done'); void qc.invalidateQueries({ queryKey: ['generations'] }); onClose(); },
    onError: (e) => toast('error', (e as Error).message),
  });
  const ds = datasets.data?.items.find((x) => x.id === datasetId);
  const trainer = trainers.data?.items.find((m) => m.id === modelId);
  return (
    <Modal wide title="Train a LoRA" onClose={onClose} footer={<>
      <label className="check small"><input type="checkbox" checked={confirmCost} onChange={(e) => setConfirmCost(e.target.checked)} /> I accept the estimated cost {est.data?.estimate.usd !== undefined && <strong className="cost">&nbsp;{fmtUsd(est.data.estimate.usd)}</strong>}</label>
      <div className="grow" />
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!spec || !confirmCost || run.isPending || !!est.error} onClick={() => run.mutate()}>Start training</button>
    </>}>
      {(datasets.data?.items.length ?? 0) === 0 && <div className="notice warn small">You need a dataset first. <Link to="/datasets">Create a dataset</Link> with at least 4 authorized images (10+ recommended).</div>}
      <div className="small muted">Low on provider credits? Export the dataset from its page (“Export for external training”), train it on your own GPU or any trainer (ai-toolkit, kohya, OneTrainer, Civitai…), then use <em>Import LoRA</em>.</div>
      <div className="grid-2">
        <Field label="LoRA name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My studio style" /></Field>
        <Field label="Dataset">
          <select className="select" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
            <option value="">Choose…</option>
            {datasets.data?.items.map((x) => <option key={x.id} value={x.id} disabled={x.imageCount < 4}>{x.name} ({x.imageCount} images)</option>)}
          </select>
        </Field>
      </div>
      <Field label="Trainer">
        <select className="select" value={modelId} onChange={(e) => setModelId(e.target.value)}>
          {trainers.data?.items.map((m) => <option key={m.id} value={m.id}>{m.name} · {priceLabel(m)}{m.available ? '' : ' — no key'}</option>)}
        </select>
      </Field>
      {trainer && <div className="small muted">{trainer.description} Produces a LoRA for the <strong>{trainer.loraFamily}</strong> family.</div>}
      <div className="grid-3">
        <Field label="Steps"><input className="input mono" type="number" min={100} max={10000} step={100} value={steps} onChange={(e) => setSteps(Number(e.target.value))} /></Field>
        <Field label="Trigger word"><input className="input" value={triggerWord} onChange={(e) => setTriggerWord(e.target.value)} placeholder="optional, e.g. sprx style" /></Field>
        <Field label="Training type"><select className="select" value={trainingType} onChange={(e) => setTrainingType(e.target.value as typeof trainingType)}><option value="style">Style</option><option value="content">Content / character</option><option value="balanced">Balanced</option></select></Field>
      </div>
      <Field label="Associate with project"><select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All projects</option>{projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      {ds && ds.confirmedCount < ds.imageCount && <div className="notice error small">Some images of this dataset are not confirmed as authorized for training.</div>}
      <div className="panel"><div className="panel-body">
        <div className="row between"><span className="label">Estimated cost</span><span className="cost" style={{ fontSize: 18 }}>{est.data ? fmtUsd(est.data.estimate.usd) : '—'}</span></div>
        {est.data && <div className="small muted">{est.data.estimate.breakdown}</div>}
        {est.error && <div className="notice error small">{(est.error as Error).message}</div>}
      </div></div>
    </Modal>
  );
}

export type { Lora };
