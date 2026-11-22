import { Link } from 'react-router-dom';
import type { Capability, Model } from '../api';
import { useModels } from '../hooks';
import { Meter } from './ui';

export function priceLabel(m: Model): string {
  const p = m.pricing;
  if (p.unit === 'megapixel') return `$${p.usd}/MP${p.loraUsd && p.loraUsd !== p.usd ? ` · LoRA $${p.loraUsd}/MP` : ''}`;
  if (p.unit === 'second') return p.perResolution ? Object.entries(p.perResolution).map(([r, v]) => `${r} $${v}/s`).join(' · ') : `$${p.usd}/s`;
  if (p.unit === 'step') return `$${(p.usd * 1000).toFixed(2)} / 1000 steps`;
  if (p.unit === 'token') return p.usd ? `≈ $${(p.usd * 1290).toFixed(4)}/image` : 'cost reported after run';
  return `$${p.usd}/${p.unit}`;
}

/** Model selector showing provider, price, quality & speed; unavailable models (no key) are flagged. */
export function ModelPicker({ capability, alsoCapability, value, onChange, allowDefault = true }: {
  capability: Capability;
  alsoCapability?: Capability;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  allowDefault?: boolean;
}) {
  const a = useModels(capability);
  const b = useModels(alsoCapability ?? capability);
  const all = [...(a.data?.items ?? []), ...(alsoCapability ? b.data?.items ?? [] : [])].filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);
  const curated = all.filter((m) => !m.dynamic);
  const dynamic = all.filter((m) => m.dynamic && m.available);
  const def = a.data?.defaults[capability];
  const selected = all.find((m) => m.id === (value ?? def));
  return (
    <div className="col" style={{ gap: 6 }}>
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        {allowDefault && <option value="">Project / default ({all.find((m) => m.id === def)?.name ?? def})</option>}
        <optgroup label="Curated (fal.ai)">
          {curated.map((m) => <option key={m.id} value={m.id}>{m.name}{m.available ? '' : ' — no key'} · {priceLabel(m)}</option>)}
        </optgroup>
        {dynamic.length > 0 && (
          <optgroup label="OpenRouter (your key)">
            {dynamic.map((m) => <option key={m.id} value={m.id}>{m.name} · {priceLabel(m)}</option>)}
          </optgroup>
        )}
      </select>
      {selected && (
        <div className="row small muted wrap" style={{ gap: 10 }}>
          <span className="chip">{selected.provider}</span>
          <span className="row" style={{ gap: 4 }}>quality <Meter value={selected.quality} /></span>
          <span className="row" style={{ gap: 4 }}>speed <Meter value={selected.speed} /></span>
          <span className="cost">{priceLabel(selected)}</span>
          {!selected.available && <Link to="/settings">Add a {selected.provider} key →</Link>}
        </div>
      )}
      {selected?.description && <div className="small muted">{selected.description}</div>}
    </div>
  );
}
