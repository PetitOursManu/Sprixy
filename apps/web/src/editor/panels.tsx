import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EditorStore, Tool } from './store';
import { hexToRgba, rgbaToHex, type RGBA } from './doc';
import { useStore } from './useStore';

// ── Icons (16px, pixel-style strokes) ──
const ICONS: Record<string, string> = {
  pencil: 'M3 13l1-4 7-7 3 3-7 7-4 1zM10 3l3 3',
  eraser: 'M2 11l6-6 5 5-4 4H5zM6 7l5 5M5 14h9',
  fill: 'M3 8l5-5 5 5-5 5zM8 3v5M13 10c0 2 2 3 2 4a1 1 0 01-2 0',
  select: 'M2 2h3M7 2h2M11 2h3v3M14 7v2M14 11v3h-3M9 14H7M5 14H2v-3M2 9V7M2 5V2',
  eyedropper: 'M10 2l4 4-2 1-6 6H4v-2l6-6zM9 5l2 2',
  line: 'M3 13L13 3',
  rect: 'M3 4h10v8H3z',
  undo: 'M5 4L2 7l3 3M2 7h8a4 4 0 010 8H7',
  redo: 'M11 4l3 3-3 3M14 7H6a4 4 0 000 8h3',
  eye: 'M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5zM8 6a2 2 0 100 4 2 2 0 000-4z',
  eyeOff: 'M2 2l12 12M4 5C2 6.5 1 8 1 8s3 5 7 5c1.5 0 2.7-.5 3.7-1.2M7 3.1C7.3 3 7.7 3 8 3c4 0 7 5 7 5s-.8 1.3-2 2.6',
  plus: 'M8 3v10M3 8h10',
  copy: 'M5 5h8v8H5zM3 11V3h8',
  trash: 'M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10',
  up: 'M8 3v10M4 7l4-4 4 4',
  down: 'M8 13V3M4 9l4 4 4-4',
  left: 'M3 8h10M7 4L3 8l4 4',
  right: 'M13 8H3M9 4l4 4-4 4',
  merge: 'M4 3l4 4 4-4M8 7v6M4 13h8',
  play: 'M4 3l9 5-9 5z',
  pause: 'M4 3h3v10H4zM9 3h3v10H9z',
  swap: 'M4 6h9l-3-3M12 10H3l3 3',
};

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

/** Draws an RGBA buffer into a small pixelated canvas. */
export function RgbaThumb({ data, width, height, size = 56, className, rev }: { data: Uint8ClampedArray; width: number; height: number; size?: number; className?: string; rev?: number | string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d')!;
    const id = ctx.createImageData(width, height);
    id.data.set(data);
    ctx.putImageData(id, 0, 0);
  }, [data, width, height, rev]);
  const scale = Math.max(1, Math.floor(size / Math.max(width, height))) || 1;
  const fits = width * scale <= size && height * scale <= size;
  const w = fits ? width * scale : Math.round((width / Math.max(width, height)) * size);
  const h = fits ? height * scale : Math.round((height / Math.max(width, height)) * size);
  return <canvas ref={ref} className={`px ${className ?? ''}`} style={{ width: w, height: h }} />;
}

// ── Tool column ──
const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'pencil', label: 'Pencil', key: 'B' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'fill', label: 'Fill bucket', key: 'G' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'rect', label: 'Rectangle (Shift = filled)', key: 'U' },
  { id: 'select', label: 'Rectangle selection', key: 'M' },
  { id: 'eyedropper', label: 'Eyedropper (Alt+click)', key: 'I' },
];

export function ToolColumn({ store }: { store: EditorStore }) {
  useStore(store);
  return (
    <div className="ed-tools">
      {TOOLS.map((t) => (
        <button key={t.id} className={`ed-tool ${store.tool === t.id ? 'on' : ''}`} title={`${t.label} (${t.key})`} onClick={() => store.setTool(t.id)}>
          <Icon name={t.id} />
        </button>
      ))}
      <div className="ed-tools-sep" />
      <div className="ed-colors-mini" title="Primary / secondary (X to swap, right-click paints with secondary)">
        <span className="ed-sec" style={{ background: rgbaToHex(store.secondary) }} onClick={() => store.swapColors()} />
        <span className="ed-pri" style={{ background: rgbaToHex(store.primary) }} onClick={() => store.swapColors()} />
      </div>
    </div>
  );
}

/** Context options for the active tool (brush size, fill mode…). */
export function ToolOptions({ store }: { store: EditorStore }) {
  useStore(store);
  const t = store.tool;
  return (
    <div className="row ed-toolopts">
      {(t === 'pencil' || t === 'eraser' || t === 'line' || t === 'rect') && (
        <div className="row" title="Brush size ([ and ])">
          <span className="label">Size</span>
          <div className="segmented">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} className={store.brush === n ? 'on' : ''} onClick={() => store.setBrush(n)}>{n}px</button>
            ))}
          </div>
        </div>
      )}
      {t === 'fill' && (
        <div className="segmented" title="Contiguous fill or replace every pixel of the same color">
          <button className={!store.fillGlobal ? 'on' : ''} onClick={() => store.fillGlobal && store.toggle('fillGlobal')}>Contiguous</button>
          <button className={store.fillGlobal ? 'on' : ''} onClick={() => !store.fillGlobal && store.toggle('fillGlobal')}>Same color</button>
        </div>
      )}
      {t === 'rect' && (
        <label className="check small"><input type="checkbox" checked={store.shapeFilled} onChange={() => store.toggle('shapeFilled')} /> Filled</label>
      )}
      {t === 'select' && (
        <div className="row small">
          <button className="btn sm" onClick={() => store.selectAll()}>All <kbd>Ctrl+A</kbd></button>
          <button className="btn sm" disabled={!store.selection} onClick={() => store.copy()}>Copy</button>
          <button className="btn sm" disabled={!store.clipboard} onClick={() => store.paste()}>Paste</button>
          <button className="btn sm" disabled={!store.selection} onClick={() => store.deleteSelection()}>Delete</button>
          <button className="btn sm" disabled={!store.selection} onClick={() => store.deselect()}>Deselect <kbd>Esc</kbd></button>
          <span className="muted">{store.selection ? `${store.selection.w}×${store.selection.h} at ${store.selection.x},${store.selection.y}` : 'Drag to select, drag inside to move'}</span>
        </div>
      )}
      {(t === 'pencil' || t === 'eraser' || t === 'line' || t === 'rect') && (
        <label className="check small" title="Mirror drawing horizontally">
          <input type="checkbox" checked={store.mirrorX} onChange={() => store.toggle('mirrorX')} /> Mirror X
        </label>
      )}
    </div>
  );
}

// ── Colors ──
function Swatches({ store, colors, onRemove }: { store: EditorStore; colors: string[]; onRemove?: (c: string) => void }) {
  const pri = rgbaToHex(store.primary);
  return (
    <div className="swatches">
      {colors.map((c) => (
        <span
          key={c}
          className={`swatch ed-swatch ${c.toLowerCase() === pri ? 'cur' : ''}`}
          style={{ background: c }}
          title={`${c} — click: primary, right-click: secondary${onRemove ? ', Shift+click: remove' : ''}`}
          onClick={(e) => (e.shiftKey && onRemove ? onRemove(c) : store.usePaletteColor(c))}
          onContextMenu={(e) => { e.preventDefault(); store.usePaletteColor(c, true); }}
        />
      ))}
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="ed-section">
      <div className="ed-section-head"><span className="label">{title}</span>{right}</div>
      {children}
    </div>
  );
}

export function ColorsPanel({ store }: { store: EditorStore }) {
  useStore(store);
  const [hex, setHex] = useState(rgbaToHex(store.primary));
  const pri = rgbaToHex(store.primary);
  useEffect(() => setHex(pri), [pri]);
  const applyHex = (v: string) => {
    setHex(v);
    if (/^#?[0-9a-fA-F]{6}$/.test(v.trim())) store.setPrimary(hexToRgba(v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`));
  };
  return (
    <div className="panel ed-panel">
      <div className="panel-head"><h3>Color</h3></div>
      <div className="panel-body">
        <div className="row">
          <div className="ed-colorpair">
            <label className="ed-big pri" style={{ background: pri }} title="Primary color">
              <input type="color" value={pri} onChange={(e) => store.setPrimary(hexToRgba(e.target.value))} />
            </label>
            <label className="ed-big sec" style={{ background: rgbaToHex(store.secondary) }} title="Secondary color">
              <input type="color" value={rgbaToHex(store.secondary)} onChange={(e) => store.setSecondary(hexToRgba(e.target.value) as RGBA)} />
            </label>
          </div>
          <div className="col grow" style={{ gap: 6 }}>
            <input className="input mono" value={hex} onChange={(e) => applyHex(e.target.value)} spellCheck={false} />
            <div className="row">
              <button className="btn sm" title="Swap (X)" onClick={() => store.swapColors()}><Icon name="swap" size={14} /></button>
              <button className="btn sm" title="Add the primary color to the custom palette" onClick={() => store.addCustomColor(pri)}><Icon name="plus" size={14} /> Palette</button>
            </div>
          </div>
        </div>
        {store.projectPalette.length > 0 && (
          <Section title={`Project palette · ${store.projectPalette.length}`}><Swatches store={store} colors={store.projectPalette} /></Section>
        )}
        {store.assetPalette.length > 0 && (
          <Section title={`Asset colors · ${store.assetPalette.length}`}><Swatches store={store} colors={store.assetPalette} /></Section>
        )}
        <Section title={`Custom · ${store.custom.length}`} right={store.custom.length ? <span className="muted small">Shift+click removes</span> : undefined}>
          {store.custom.length ? <Swatches store={store} colors={store.custom} onRemove={(c) => store.removeCustomColor(c)} /> : <p className="muted small">Add colors with “+ Palette”.</p>}
        </Section>
        {store.recent.length > 0 && (
          <Section title="Recent"><Swatches store={store} colors={store.recent} /></Section>
        )}
      </div>
    </div>
  );
}

// ── Layers ──
export function LayersPanel({ store }: { store: EditorStore }) {
  useStore(store);
  const [editing, setEditing] = useState<string | null>(null);
  const layers = [...store.doc.layers].reverse();
  const idx = store.doc.layers.findIndex((l) => l.id === store.layerId);
  return (
    <div className="panel ed-panel">
      <div className="panel-head">
        <h3>Layers</h3>
        <div className="row" style={{ gap: 2 }}>
          <button className="btn sm icon ghost" title="New layer" onClick={() => store.addLayer()}><Icon name="plus" size={14} /></button>
          <button className="btn sm icon ghost" title="Duplicate layer" onClick={() => store.duplicateLayer()}><Icon name="copy" size={14} /></button>
          <button className="btn sm icon ghost" title="Move up" disabled={idx >= store.doc.layers.length - 1} onClick={() => store.moveLayer(1)}><Icon name="up" size={14} /></button>
          <button className="btn sm icon ghost" title="Move down" disabled={idx <= 0} onClick={() => store.moveLayer(-1)}><Icon name="down" size={14} /></button>
          <button className="btn sm icon ghost" title="Merge down" disabled={idx <= 0} onClick={() => store.mergeDown()}><Icon name="merge" size={14} /></button>
          <button className="btn sm icon ghost danger" title="Delete layer" disabled={store.doc.layers.length <= 1} onClick={() => store.deleteLayer()}><Icon name="trash" size={14} /></button>
        </div>
      </div>
      <div className="ed-layers">
        {layers.map((l) => {
          const active = l.id === store.layerId;
          const cel = store.frame.cels[l.id];
          return (
            <div key={l.id} className={`ed-layer ${active ? 'on' : ''}`} onClick={() => store.selectLayer(l.id)}>
              <button className="btn sm icon ghost" title={l.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); store.setLayerProps(l.id, { visible: !l.visible }); }}>
                <Icon name={l.visible ? 'eye' : 'eyeOff'} size={14} />
              </button>
              <span className="ed-layer-thumb checker">{cel && <RgbaThumb data={cel} width={store.doc.width} height={store.doc.height} size={26} rev={`${store.frame.id}:${store.frame.rev}`} />}</span>
              {editing === l.id ? (
                <input
                  className="input"
                  autoFocus
                  defaultValue={l.name}
                  style={{ height: 24 }}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { store.setLayerProps(l.id, { name: e.target.value.trim() || l.name }); setEditing(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }}
                />
              ) : (
                <span className="grow ed-layer-name" title="Double-click to rename" onDoubleClick={() => setEditing(l.id)}>{l.name}</span>
              )}
              <span className="mono muted small">{Math.round(l.opacity * 100)}%</span>
            </div>
          );
        })}
      </div>
      <div className="panel-body" style={{ paddingTop: 8 }}>
        <div className="row">
          <span className="label">Opacity</span>
          <input type="range" min={0} max={100} value={Math.round(store.layer.opacity * 100)} onChange={(e) => store.setLayerProps(store.layer.id, { opacity: Number(e.target.value) / 100 })} />
        </div>
      </div>
    </div>
  );
}

// ── Animation preview ──
export function PreviewPanel({ store }: { store: EditorStore }) {
  useStore(store);
  const [playing, setPlaying] = useState(true);
  const [idx, setIdx] = useState(0);
  const frames = store.doc.frames;
  const n = frames.length;
  const cur = Math.min(idx, n - 1);
  useEffect(() => {
    if (!playing || n < 2) return;
    const t = window.setTimeout(() => setIdx((i) => (i + 1) % n), Math.max(16, frames[cur]?.duration ?? 100));
    return () => clearTimeout(t);
  }, [playing, cur, n, frames]);
  const avg = frames.reduce((s, f) => s + f.duration, 0) / Math.max(1, n);
  const fps = Math.round(1000 / avg);
  const shown = playing && n > 1 ? frames[cur] : store.frame;
  return (
    <div className="panel ed-panel">
      <div className="panel-head">
        <h3>Preview</h3>
        <span className="mono muted small">{n > 1 ? `${(playing ? cur : store.frameIndex) + 1}/${n}` : '1 frame'}</span>
      </div>
      <div className="panel-body">
        <div className="ed-preview checker">
          <RgbaThumb data={store.compositeWithFloating(shown)} width={store.doc.width} height={store.doc.height} size={180} />
        </div>
        <div className="row">
          <button className="btn sm" disabled={n < 2} onClick={() => setPlaying((p) => !p)}><Icon name={playing ? 'pause' : 'play'} size={14} /> {playing ? 'Pause' : 'Play'}</button>
          <span className="label">FPS</span>
          <input
            className="input mono"
            type="number"
            min={1}
            max={60}
            style={{ width: 64, height: 26 }}
            value={fps}
            title="Sets every frame duration to 1000/fps ms"
            onChange={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 60) store.setAllDurations(1000 / v); }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Frame strip ──
export function FrameStrip({ store }: { store: EditorStore }) {
  useStore(store);
  const frames = store.doc.frames;
  return (
    <div className="ed-frames">
      <div className="ed-frames-actions">
        <span className="label">Frames</span>
        <div className="row" style={{ gap: 2 }}>
          <button className="btn sm icon ghost" title="New empty frame" onClick={() => store.addFrame()}><Icon name="plus" size={14} /></button>
          <button className="btn sm icon ghost" title="Duplicate frame" onClick={() => store.duplicateFrame()}><Icon name="copy" size={14} /></button>
          <button className="btn sm icon ghost" title="Move frame left" disabled={store.frameIndex === 0} onClick={() => store.moveFrame(-1)}><Icon name="left" size={14} /></button>
          <button className="btn sm icon ghost" title="Move frame right" disabled={store.frameIndex >= frames.length - 1} onClick={() => store.moveFrame(1)}><Icon name="right" size={14} /></button>
          <button className="btn sm icon ghost danger" title="Delete frame" disabled={frames.length <= 1} onClick={() => store.deleteFrame()}><Icon name="trash" size={14} /></button>
        </div>
        <label className="check small" title="Show previous/next frames (O)"><input type="checkbox" checked={store.onion} onChange={() => store.toggle('onion')} /> Onion skin</label>
      </div>
      <div className="ed-frames-list">
        {frames.map((f, i) => (
          <div key={f.id} className={`ed-frame ${i === store.frameIndex ? 'on' : ''}`} onClick={() => store.selectFrame(i)}>
            <div className="ed-frame-thumb checker">
              <RgbaThumb data={store.composite(f)} width={store.doc.width} height={store.doc.height} size={52} />
            </div>
            <div className="row" style={{ gap: 4 }}>
              <span className="mono small muted">{i + 1}</span>
              <input
                className="ed-dur mono"
                type="number"
                min={10}
                max={10000}
                step={10}
                value={f.duration}
                title="Duration (ms)"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => store.setFrameDuration(i, Number(e.target.value))}
              />
              <span className="mono small muted">ms</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
