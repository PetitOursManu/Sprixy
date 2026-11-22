import { useMeta } from '../hooks';
import { Icon } from './ui';

export type Step = { op: string; [k: string]: unknown };

type ParamSpec =
  | { key: string; type: 'int' | 'number'; min?: number; max?: number; step?: number; default?: number; optional?: boolean }
  | { key: string; type: 'select'; options: string[]; default?: string; optional?: boolean }
  | { key: string; type: 'color'; default?: string; allowAuto?: boolean }
  | { key: string; type: 'bool'; default?: boolean }
  | { key: string; type: 'preset' }
  | { key: string; type: 'palette' };

const DITHER = ['none', 'floyd-steinberg', 'atkinson', 'bayer2', 'bayer4', 'bayer8'];

/** Parameter form specs per processing op (mirrors @sprixy/core ProcessStep). */
export const OP_PARAMS: Record<string, ParamSpec[]> = {
  removeBackground: [{ key: 'tolerance', type: 'int', min: 0, max: 100, default: 12 }, { key: 'global', type: 'bool', default: false }],
  chromaKey: [{ key: 'color', type: 'color', default: '#ff00ff' }, { key: 'tolerance', type: 'int', min: 0, max: 100, default: 10 }],
  hardenAlpha: [{ key: 'threshold', type: 'int', min: 0, max: 255, default: 127 }],
  pixelize: [{ key: 'width', type: 'int', min: 1, max: 2048, optional: true }, { key: 'height', type: 'int', min: 1, max: 2048, optional: true }, { key: 'sampling', type: 'select', options: ['mode', 'center', 'average'], default: 'mode' }],
  resize: [{ key: 'width', type: 'int', min: 1, max: 4096, default: 32 }, { key: 'height', type: 'int', min: 1, max: 4096, default: 32 }],
  scale: [{ key: 'factor', type: 'number', min: 0.05, max: 32, step: 0.5, default: 2 }],
  reduceColors: [{ key: 'maxColors', type: 'int', min: 2, max: 256, default: 16 }, { key: 'dither', type: 'select', options: DITHER, default: 'none' }, { key: 'ditherStrength', type: 'number', min: 0, max: 1, step: 0.1, default: 1 }],
  applyPalette: [{ key: 'presetId', type: 'preset' }, { key: 'dither', type: 'select', options: DITHER, default: 'none' }, { key: 'ditherStrength', type: 'number', min: 0, max: 1, step: 0.1, default: 1 }],
  removeOrphans: [{ key: 'minNeighbors', type: 'int', min: 1, max: 8, default: 1 }],
  fillPinholes: [],
  despeckle: [],
  outline: [{ key: 'color', type: 'color', default: '#141018', allowAuto: true }, { key: 'mode', type: 'select', options: ['outer', 'inner'], default: 'outer' }, { key: 'diagonal', type: 'bool', default: false }],
  trim: [{ key: 'padding', type: 'int', min: 0, max: 64, default: 0 }],
  canvas: [{ key: 'width', type: 'int', min: 1, max: 4096, default: 32 }, { key: 'height', type: 'int', min: 1, max: 4096, default: 32 }, { key: 'anchor', type: 'select', options: ['center', 'top-left', 'bottom-center'], default: 'center' }],
  crop: [{ key: 'x', type: 'int', default: 0 }, { key: 'y', type: 'int', default: 0 }, { key: 'width', type: 'int', min: 1, default: 16 }, { key: 'height', type: 'int', min: 1, default: 16 }],
  flip: [{ key: 'direction', type: 'select', options: ['horizontal', 'vertical'], default: 'horizontal' }],
  hsl: [{ key: 'hue', type: 'int', min: -180, max: 180, default: 30 }, { key: 'saturation', type: 'number', min: 0, max: 3, step: 0.1, default: 1 }, { key: 'lightness', type: 'number', min: -1, max: 1, step: 0.05, default: 0 }],
  brightnessContrast: [{ key: 'brightness', type: 'number', min: -1, max: 1, step: 0.05, default: 0 }, { key: 'contrast', type: 'number', min: -1, max: 1, step: 0.05, default: 0.1 }],
  paletteSwap: [{ key: 'presetId', type: 'preset' }],
  seamless: [{ key: 'band', type: 'int', min: 1, max: 256, default: 4 }],
};

export function defaultStep(op: string): Step {
  const s: Step = { op };
  for (const p of OP_PARAMS[op] ?? []) {
    if ('default' in p && p.default !== undefined) s[p.key] = p.default;
    if (p.type === 'preset') s.presetId = 'pico-8';
  }
  return s;
}

export function PipelineEditor({ steps, onChange, extraPalettes }: { steps: Step[]; onChange: (s: Step[]) => void; extraPalettes?: { id: string; name: string; colors: string[] }[] }) {
  const meta = useMeta();
  const ops = meta.data?.processOps ?? [];
  const palettes = [...(extraPalettes ?? []), ...(meta.data?.palettes ?? [])];
  const set = (i: number, patch: Partial<Step>) => onChange(steps.map((s, j) => (j === i ? ({ ...s, ...patch } as Step) : s)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const n = [...steps];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="steps-list">
        {steps.length === 0 && <div className="small muted">No step yet — add one below.</div>}
        {steps.map((s, i) => (
          <div key={i} className="step-item" style={{ flexWrap: 'wrap' }}>
            <span className="mono muted small" style={{ width: 16 }}>{i + 1}</span>
            <span className="op">{ops.find((o) => o.op === s.op)?.label ?? s.op}</span>
            <div className="row wrap grow" style={{ gap: 8 }}>
              {(OP_PARAMS[s.op] ?? []).map((p) => (
                <ParamInput key={p.key} spec={p} value={s[p.key]} palettes={palettes} onChange={(v) => {
                  if (p.type === 'preset' && typeof v === 'string' && v.startsWith('custom:')) {
                    const pal = palettes.find((x) => x.id === v);
                    set(i, { presetId: undefined, palette: pal?.colors });
                  } else if (p.type === 'preset') set(i, { presetId: v as string, palette: undefined });
                  else set(i, { [p.key]: v });
                }} currentPalette={s.palette as string[] | undefined} />
              ))}
            </div>
            <button className="btn ghost sm icon" onClick={() => move(i, -1)} title="Up">↑</button>
            <button className="btn ghost sm icon" onClick={() => move(i, 1)} title="Down">↓</button>
            <button className="btn ghost sm icon" onClick={() => onChange(steps.filter((_, j) => j !== i))} title="Remove"><Icon name="x" size={13} /></button>
          </div>
        ))}
      </div>
      <select className="select" value="" onChange={(e) => e.target.value && onChange([...steps, defaultStep(e.target.value)])}>
        <option value="">+ Add a processing step…</option>
        {ops.map((o) => <option key={o.op} value={o.op}>{o.label} — {o.description.slice(0, 70)}</option>)}
      </select>
    </div>
  );
}

function ParamInput({ spec, value, onChange, palettes, currentPalette }: { spec: ParamSpec; value: unknown; onChange: (v: unknown) => void; palettes: { id: string; name: string; colors: string[] }[]; currentPalette?: string[] }) {
  const label = <span className="label" style={{ fontSize: 9.5 }}>{spec.key}</span>;
  switch (spec.type) {
    case 'int':
    case 'number':
      return (
        <label className="row" style={{ gap: 5 }}>{label}
          <input className="input mono" style={{ width: 78, height: 26 }} type="number" min={spec.min} max={spec.max} step={spec.type === 'int' ? 1 : spec.step ?? 0.1}
            value={value === undefined || value === null ? '' : String(value)} placeholder={spec.optional ? 'auto' : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : spec.type === 'int' ? Math.round(Number(e.target.value)) : Number(e.target.value))} />
        </label>
      );
    case 'select':
      return (
        <label className="row" style={{ gap: 5 }}>{label}
          <select className="select" style={{ height: 26, width: 'auto', fontSize: 12 }} value={String(value ?? spec.default ?? '')} onChange={(e) => onChange(e.target.value)}>
            {spec.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      );
    case 'bool':
      return <label className="check small">{label}<input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /></label>;
    case 'color':
      return (
        <label className="row" style={{ gap: 5 }}>{label}
          {spec.allowAuto && <label className="check small"><input type="checkbox" checked={value === 'auto'} onChange={(e) => onChange(e.target.checked ? 'auto' : spec.default)} /> auto</label>}
          {value !== 'auto' && <input type="color" value={String(value ?? spec.default ?? '#000000')} onChange={(e) => onChange(e.target.value)} />}
        </label>
      );
    case 'preset': {
      const cur = currentPalette ? palettes.find((p) => p.colors === currentPalette || JSON.stringify(p.colors) === JSON.stringify(currentPalette))?.id : String(value ?? '');
      return (
        <label className="row" style={{ gap: 5 }}>{label}
          <select className="select" style={{ height: 26, width: 'auto', fontSize: 12 }} value={cur ?? ''} onChange={(e) => onChange(e.target.value)}>
            {palettes.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.colors.length})</option>)}
          </select>
        </label>
      );
    }
    default:
      return null;
  }
}
