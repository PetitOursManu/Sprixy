import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fmtUsd, post, timeAgo, type Generation } from '../api';
import { Icon, Spinner, StatusLed, useToast } from './ui';

const TASK_LABEL: Record<string, string> = { generate: 'Generate', variant: 'Variant', directions: 'Directions', animate: 'Animate', removeBg: 'AI cutout', inpaint: 'AI edit', train: 'LoRA training' };

export function JobCard({ g, compact }: { g: Generation; compact?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cancel = useMutation({
    mutationFn: () => post(`/api/v1/generations/${g.id}/cancel`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['generations'] }),
    onError: (e) => toast('error', (e as Error).message),
  });
  const active = g.status === 'queued' || g.status === 'running';
  const duration = g.finishedAt && g.startedAt ? `${((g.finishedAt - g.startedAt) / 1000).toFixed(1)}s` : null;
  return (
    <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row between">
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          <StatusLed status={g.status} />
          <span className="chip">{TASK_LABEL[g.task] ?? g.task}{g.kind && g.task === 'generate' ? ` · ${g.kind}` : ''}</span>
          <span className="small muted mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.modelId.replace(/^\w+:/, '')}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="cost small" title={g.costSource ?? ''}>{g.actualCost !== null ? fmtUsd(g.actualCost) : `≈ ${fmtUsd(g.estimatedCost)}`}</span>
          {active && <button className="btn ghost sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancel</button>}
        </div>
      </div>
      {!compact && <div className="small" style={{ color: 'var(--text-2)' }}>{g.prompt}</div>}
      {active && <div className="row small muted"><Spinner /> {g.progress ?? (g.status === 'queued' ? 'Queued…' : 'Working…')}</div>}
      {g.status === 'failed' && <div className="notice error small">{g.error}</div>}
      {g.warnings.length > 0 && <div className="small" style={{ color: 'var(--accent)' }}>{g.warnings.join(' · ')}</div>}
      {g.outputAssetIds.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>
          {g.outputAssetIds.map((id) => (
            <Link key={id} to={`/assets/${id}`} className="checker" style={{ width: 64, height: 64, display: 'grid', placeItems: 'center', borderRadius: 3, border: '1px solid var(--line)' }}>
              <img className="px" src={`/api/v1/assets/${id}/file`} alt="" style={{ maxWidth: '90%', maxHeight: '90%' }} />
            </Link>
          ))}
        </div>
      )}
      {g.task === 'train' && g.status === 'succeeded' && <Link to="/loras" className="small"><Icon name="layers" size={12} /> LoRA ready — open LoRAs</Link>}
      <div className="row small muted mono" style={{ gap: 10 }}>
        <span>{timeAgo(g.createdAt)}</span>
        {duration && <span>{duration}</span>}
        <span>{g.provider}</span>
      </div>
    </div>
  );
}
