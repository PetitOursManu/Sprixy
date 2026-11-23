import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// ── Icons: 16px, 1.5px strokes, square caps (crisp, not "AI sparkle" generic) ──
const P: Record<string, string> = {
  grid: 'M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z',
  folder: 'M1.5 3.5h5l1.5 2h6.5v8h-13z',
  wand: 'M2.5 13.5l8-8M9 3v2M12 6h2M12.5 2.5l-1 1M13.5 9.5l-1-1M6 2.5l1 1',
  palette: 'M8 1.5a6.5 6.5 0 1 0 0 13c1 0 1.5-.7 1.5-1.4 0-1-.9-1.2-.9-2s.6-1.1 1.4-1.1h1.5a3 3 0 0 0 3-3C14.5 4 11.6 1.5 8 1.5zM4.5 7.5h.01M6.5 4.5h.01M10 4.5h.01',
  history: 'M2 8a6 6 0 1 0 1.8-4.3M2 2.5v3h3M8 4.5V8l2.5 1.5',
  layers: 'M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3',
  key: 'M10 1.5a4.5 4.5 0 1 1-3.7 7.1L1.5 13.5v1h3v-1.5H6V11.5h1.5l.8-.8A4.5 4.5 0 0 1 10 1.5zM11 4.5h.01',
  chart: 'M2 13.5h12M4 11V7M7.5 11V3.5M11 11V6',
  cog: 'M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3',
  db: 'M2.5 3.5c0-1.1 2.5-2 5.5-2s5.5.9 5.5 2-2.5 2-5.5 2-5.5-.9-5.5-2zM2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2',
  plus: 'M8 2.5v11M2.5 8h11',
  trash: 'M2.5 4h11M6 4V2.5h4V4M4 4l.8 9.5h6.4L12 4',
  star: 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z',
  download: 'M8 2v8.5M4.5 7L8 10.5 11.5 7M2.5 13.5h11',
  upload: 'M8 11V2.5M4.5 6L8 2.5 11.5 6M2.5 13.5h11',
  play: 'M4.5 2.5v11l9-5.5z',
  pause: 'M4.5 2.5v11M11.5 2.5v11',
  edit: 'M10.5 2.5l3 3-8 8h-3v-3z',
  x: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  check: 'M2.5 8.5l3.5 3.5 7.5-8',
  copy: 'M5.5 5.5h8v8h-8zM2.5 10.5v-8h8',
  eye: 'M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5zM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  film: 'M2.5 2.5h11v11h-11zM5 2.5v11M11 2.5v11M2.5 6h2.5M2.5 10h2.5M11 6h2.5M11 10h2.5',
  compass: 'M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM10.5 5.5l-1.5 3.5-3.5 1.5 1.5-3.5z',
  scissors: 'M4 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM4 14.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 4.5L14 12M5.5 11.5L14 4',
  menu: 'M2 4h12M2 8h12M2 12h12',
  logout: 'M6 2.5H2.5v11H6M10 5l3 3-3 3M13 8H6',
  book: 'M2.5 2.5h4.5c.6 0 1 .4 1 1v10c0-.6-.4-1-1-1H2.5zM13.5 2.5H9c-.6 0-1 .4-1 1v10c0-.6.4-1 1-1h4.5z',
  cube: 'M8 1.5l6 3.25v6.5L8 14.5l-6-3.25v-6.5zM2 4.75L8 8l6-3.25M8 8v6.5',
  refresh: 'M13.5 3v3.5H10M2.5 13V9.5H6M3.3 6a5 5 0 0 1 9.4-.8M12.7 10a5 5 0 0 1-9.4.8',
  sliders: 'M2 4h7M12 4h2M2 12h2M7 12h7M10.5 2.5v3M5.5 10.5v3',
  link: 'M6.5 9.5l3-3M5 7.5L3.5 9a2.5 2.5 0 0 0 3.5 3.5L8.5 11M11 8.5L12.5 7A2.5 2.5 0 0 0 9 3.5L7.5 5',
  chevron: 'M6 3.5l4.5 4.5L6 12.5',
  wallet: 'M2 4.5h11.5v9H2zM2 4.5l8.5-2.5v2.5M10.5 9h3',
  back: 'M10 3.5L5.5 8l4.5 4.5',
  search: 'M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM10.5 10.5l3 3',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  lock: 'M4 7.5h8v6.5H4zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5',
  bolt: 'M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z',
  image: 'M2 2.5h12v11H2zM2 11l3.5-3.5 3 3 2-2L14 12M10.5 5.5h.01',
  users: 'M6 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11 2.2a2.5 2.5 0 0 1 0 4.6M12.5 10c1.3.5 2 1.8 2 4',
};

export function Icon({ name, size = 16, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d={P[name] ?? P.cube} />
    </svg>
  );
}

// ── Toasts ──
type Toast = { id: number; kind: 'info' | 'error' | 'success'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t.slice(-4), { id, kind, text }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role="status">{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Modal ──
export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ── Small pieces ──
export function Swatches({ colors, size, max }: { colors: string[]; size?: 'sm' | 'lg'; max?: number }) {
  const list = max ? colors.slice(0, max) : colors;
  return (
    <div className="swatches">
      {list.map((c, i) => <span key={`${c}${i}`} className={`swatch ${size ?? ''}`} style={{ background: c }} title={c} />)}
      {max && colors.length > max && <span className="muted small mono">+{colors.length - max}</span>}
    </div>
  );
}

export function Meter({ value, max = 5 }: { value: number; max?: number }) {
  return <span className="meter">{Array.from({ length: max }, (_, i) => <i key={i} className={i < value ? 'f' : ''} />)}</span>;
}

export function StatusLed({ status }: { status: string }) {
  return <span className={`led ${status}`} title={status} />;
}

export function Spinner() {
  return <span className="spin" />;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Asset thumbnail on a checkerboard, nearest-neighbour. */
export function PixelThumb({ src, alt, size }: { src: string; alt: string; size?: number }) {
  return (
    <div className="checker" style={{ width: size, height: size, display: 'grid', placeItems: 'center', borderRadius: 3, overflow: 'hidden', flex: 'none' }}>
      <img className="px" src={src} alt={alt} style={{ maxWidth: '88%', maxHeight: '88%' }} />
    </div>
  );
}

/** Copy text helper with toast. */
export function useCopy() {
  const toast = useToast();
  return (text: string, what = 'Copied') => {
    void navigator.clipboard.writeText(text).then(() => toast('success', what));
  };
}
