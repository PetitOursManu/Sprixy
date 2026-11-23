import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fmtUsd, get, qs, type Generation } from '../api';
import { JobCard } from '../components/JobCard';
import { Empty, Segmented } from '../components/ui';

export function HistoryPage({ global }: { global?: boolean }) {
  const { projectId } = useParams();
  const [status, setStatus] = useState<'' | 'active' | 'succeeded' | 'failed'>('');
  const [task, setTask] = useState('');
  const [page, setPage] = useState(0);
  const limit = 30;
  const q = useQuery({
    queryKey: ['generations', 'history', global ? 'all' : projectId, status, task, page],
    queryFn: () => get<{ total: number; items: Generation[] }>(`/api/v1/generations${qs({ projectId: global ? undefined : projectId, status, task, limit, offset: page * limit })}`),
    refetchInterval: (query) => (query.state.data?.items.some((g) => g.status === 'queued' || g.status === 'running') ? 2000 : false),
  });
  const items = q.data?.items ?? [];
  const spent = items.reduce((s, g) => s + (g.actualCost ?? 0), 0);
  return (
    <>
      {global && <div className="topbar"><div className="crumbs"><strong>Jobs</strong></div></div>}
      <div className="page">
        <div className="page-head">
          <div>
            <h1>{global ? 'All generation jobs' : 'Generation history'}</h1>
            <p>Every AI call with its model, prompt, status and cost ({fmtUsd(spent)} on this page).</p>
          </div>
          <div className="row wrap">
            <Segmented value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={[{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'succeeded', label: 'Succeeded' }, { value: 'failed', label: 'Failed' }]} />
            <select className="select" style={{ width: 150 }} value={task} onChange={(e) => { setTask(e.target.value); setPage(0); }}>
              <option value="">All tasks</option>
              {['generate', 'variant', 'directions', 'animate', 'removeBg', 'inpaint', 'train'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        {!q.isLoading && items.length === 0 ? <Empty title="No generation yet" /> : (
          <div className="card-grid big" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
            {items.map((g) => <JobCard key={g.id} g={g} />)}
          </div>
        )}
        {(q.data?.total ?? 0) > limit && (
          <div className="row end">
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="mono small muted">{page + 1} / {Math.ceil((q.data?.total ?? 0) / limit)}</span>
            <button className="btn sm" disabled={(page + 1) * limit >= (q.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
    </>
  );
}
