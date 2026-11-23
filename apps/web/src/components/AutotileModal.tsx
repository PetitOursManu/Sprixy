import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { get, post, qs, type Asset } from '../api';
import { useDebounced, useProject } from '../hooks';
import { Field, Modal, useToast } from './ui';

/** Build a 16-tile Wang corner autotile set from two textures of the project (free, deterministic). */
export function AutotileModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const project = useProject(projectId);
  const assets = useQuery({ queryKey: ['assets', projectId, 'autotile'], queryFn: () => get<{ items: Asset[] }>(`/api/v1/assets${qs({ projectId, limit: 300 })}`) });
  const textures = (assets.data?.items ?? []).filter((a) => !a.frames || a.frames.length <= 1);
  const [lower, setLower] = useState('');
  const [upper, setUpper] = useState('');
  const [lowerName, setLowerName] = useState('lower');
  const [upperName, setUpperName] = useState('upper');
  const [tileSize, setTileSize] = useState<number | undefined>();
  const [seed, setSeed] = useState(1);
  const [roughness, setRoughness] = useState(0.55);
  const [edge, setEdge] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const T = tileSize ?? project.data?.artDirection.tileSize ?? 16;

  useEffect(() => {
    const tex = textures.filter((a) => a.kind === 'texture');
    if (!lower && tex[0]) pick(tex[0].id, setLower, setLowerName);
    if (!upper && tex[1]) pick(tex[1].id, setUpper, setUpperName);
  }, [textures, lower, upper]);

  function pick(id: string, setId: (v: string) => void, setName: (v: string) => void) {
    setId(id);
    const a = textures.find((x) => x.id === id);
    if (a) setName(a.name.split('·')[0].trim().slice(0, 40));
  }

  const body = { projectId, lowerAssetId: lower, upperAssetId: upper, lowerName, upperName, tileSize: T, seed, roughness, edge };
  const dbody = useDebounced(body, 300);
  useEffect(() => {
    if (!dbody.lowerAssetId || !dbody.upperAssetId) return;
    let alive = true;
    post<{ preview: string }>('/api/v1/tilesets/wang', { ...dbody, preview: true }).then((r) => alive && setPreview(r.preview)).catch((e) => alive && toast('error', (e as Error).message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(dbody)]);

  const create = useMutation({
    mutationFn: () => post<Asset>('/api/v1/tilesets/wang', { ...body, name: `${upperName} over ${lowerName} · autotile` }),
    onSuccess: (a) => nav(`/assets/${a.id}`),
    onError: (e) => toast('error', (e as Error).message),
  });

  const picker = (value: string, set: (v: string) => void, setName: (v: string) => void) => (
    <select className="select" value={value} onChange={(e) => pick(e.target.value, set, setName)}>
      <option value="">Choose a texture…</option>
      {textures.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kind}, {a.width}×{a.height})</option>)}
    </select>
  );

  return (
    <Modal wide title="Autotile terrain set (Wang 16, free)" onClose={onClose} footer={<>
      <span className="small muted">Exports: Godot terrain set, Tiled wangset (.tsx), Unity slices, atlas JSON</span>
      <div className="grow" />
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!lower || !upper || create.isPending} onClick={() => create.mutate()}>Create tileset</button>
    </>}>
      <p className="small muted">Pick two seamless textures (generate them with the <em>Texture</em> kind). Sprixy builds the 16 corner combinations with an organic, pixel-perfect transition — every valid neighbour matches.</p>
      <div className="grid-2">
        <Field label="Lower terrain (base)">
          <div className="row" style={{ gap: 6 }}><button type="button" className="btn sm ghost" title="Swap terrains" onClick={() => { setLower(upper); setUpper(lower); setLowerName(upperName); setUpperName(lowerName); }}>⇄ swap</button></div>{picker(lower, setLower, setLowerName)}<input className="input" value={lowerName} onChange={(e) => setLowerName(e.target.value)} placeholder="name" /></Field>
        <Field label="Upper terrain">{picker(upper, setUpper, setUpperName)}<input className="input" value={upperName} onChange={(e) => setUpperName(e.target.value)} placeholder="name" /></Field>
      </div>
      <div className="grid-4">
        <Field label="Tile size"><input className="input mono" type="number" min={4} max={128} value={T} onChange={(e) => setTileSize(Number(e.target.value) || undefined)} /></Field>
        <Field label="Seed"><input className="input mono" type="number" min={0} value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></Field>
        <Field label={`Roughness ${roughness.toFixed(2)}`}><input type="range" min={0} max={1} step={0.05} value={roughness} onChange={(e) => setRoughness(Number(e.target.value))} /></Field>
        <Field label="Border"><label className="check" style={{ height: 32 }}><input type="checkbox" checked={edge} onChange={(e) => setEdge(e.target.checked)} /> Darker lip</label></Field>
      </div>
      <div className="stage" style={{ minHeight: 280 }}>
        {preview ? <img src={preview} alt="preview" style={{ width: T * 4 * Math.max(1, Math.floor(256 / (T * 4))) , imageRendering: 'pixelated' }} /> : <span className="muted small">Choose two textures to preview</span>}
      </div>
    </Modal>
  );
}
