import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, qs, type Asset } from '../api';
import { useDebounced } from '../hooks';
import { AssetTile } from './AssetTile';
import { Modal } from './ui';

/** Modal to pick one or several assets from a project. */
export function AssetPicker({ projectId, max = 4, initial = [], onClose, onPick, title = 'Pick reference assets' }: {
  projectId: string;
  max?: number;
  initial?: string[];
  onClose: () => void;
  onPick: (ids: string[]) => void;
  title?: string;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>(initial);
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['assets', projectId, 'picker', dq], queryFn: () => get<{ items: Asset[] }>(`/api/v1/assets${qs({ projectId, q: dq, limit: 200 })}`) });
  return (
    <Modal wide title={title} onClose={onClose} footer={<>
      <span className="small muted">{sel.length}/{max} selected</span>
      <div className="grow" />
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={() => { onPick(sel); onClose(); }}>Use selection</button>
    </>}>
      <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="card-grid" style={{ maxHeight: 460, overflow: 'auto' }}>
        {list.data?.items.map((a) => (
          <AssetTile key={a.id} asset={a} selectable selected={sel.includes(a.id)}
            onToggleSelect={() => setSel((s) => (s.includes(a.id) ? s.filter((x) => x !== a.id) : s.length < max ? [...s, a.id] : s))}
            onClick={() => setSel((s) => (s.includes(a.id) ? s.filter((x) => x !== a.id) : s.length < max ? [...s, a.id] : s))} />
        ))}
      </div>
    </Modal>
  );
}
