import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, put, ApiError, type Asset, type AssetDetail, type Project, type Frame } from '../api';
import { EditorStore, ZOOM_STEPS } from '../editor/store';
import { EditorCanvas } from '../editor/EditorCanvas';
import { ColorsPanel, FrameStrip, Icon, LayersPanel, PreviewPanel, ToolColumn, ToolOptions } from '../editor/panels';
import { useStore } from '../editor/useStore';
import {
  compositeFrame, cropRGBA, deserializeDoc, loadImageRGBA, newDoc, rgbaToPngDataUrl, serializeDoc, uniqueColors, type Doc,
} from '../editor/doc';
import { AiEditPanel } from '../editor/AiEditPanel';
import '../editor/editor.css';

interface Loaded {
  store: EditorStore;
  asset: AssetDetail;
  project: Project | null;
  notice: string | null;
}

function nearlyEqual(a: Uint8ClampedArray, b: Uint8ClampedArray, tol = 3): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0 && b[i + 3] === 0) continue;
    if (a[i + 3] < 32 && b[i + 3] < 32) { if (Math.abs(a[i + 3] - b[i + 3]) > tol) return false; continue; }
    if (Math.abs(a[i] - b[i]) > tol || Math.abs(a[i + 1] - b[i + 1]) > tol || Math.abs(a[i + 2] - b[i + 2]) > tol || Math.abs(a[i + 3] - b[i + 3]) > tol) return false;
  }
  return true;
}

async function loadEditor(id: string): Promise<Loaded> {
  const asset = await get<AssetDetail>(`/api/v1/assets/${id}`);
  const [project, docRes, img] = await Promise.all([
    get<Project>(`/api/v1/projects/${asset.projectId}`).catch(() => null),
    get<{ document: unknown }>(`/api/v1/assets/${id}/document`).catch(() => ({ document: null })),
    loadImageRGBA(asset.fileUrl),
  ]);

  // Split the PNG into frames (animations / sheets) or a single frame.
  const fps = typeof asset.meta.fps === 'number' && asset.meta.fps > 0 ? asset.meta.fps : 10;
  let cels: Uint8ClampedArray[];
  let fw: number, fh: number, durations: number[];
  if (asset.frames?.length) {
    fw = Math.max(...asset.frames.map((f) => f.rect.w));
    fh = Math.max(...asset.frames.map((f) => f.rect.h));
    cels = asset.frames.map((f) => cropRGBA(img.data, img.width, img.height, f.rect.x, f.rect.y, f.rect.w, f.rect.h, fw, fh));
    durations = asset.frames.map((f) => Math.round(f.duration ?? 1000 / fps));
  } else {
    fw = img.width;
    fh = img.height;
    cels = [img.data];
    durations = [Math.round(1000 / fps)];
  }

  // Prefer the saved layered document — but only if it still matches the current pixels
  // (the asset may have been processed or regenerated outside the editor since).
  let doc: Doc | null = deserializeDoc(docRes.document);
  let notice: string | null = null;
  if (doc) {
    const ok = doc.width === fw && doc.height === fh && doc.frames.length === cels.length && doc.frames.every((f, i) => nearlyEqual(compositeFrame(doc!, f), cels[i]));
    if (!ok) {
      doc = null;
      notice = 'This asset was modified outside the editor since its layers were saved — the editor reloaded the current image as a single layer.';
    }
  }
  const store = new EditorStore(doc ?? newDoc(fw, fh, cels, durations));
  store.projectPalette = project?.effectivePalette ?? [];
  store.assetPalette = asset.meta.palette?.length ? asset.meta.palette.slice(0, 96) : uniqueColors(img.data, 96);
  try {
    store.custom = JSON.parse(localStorage.getItem(`sprixy.editor.palette.${asset.projectId}`) ?? '[]') as string[];
  } catch { store.custom = []; }
  const firstOpaque = store.assetPalette[0] ?? store.projectPalette[0];
  if (firstOpaque) store.usePaletteColor(firstOpaque);
  return { store, asset, project, notice };
}

/** Flatten every frame and pack them horizontally into one PNG + frame rects. */
function buildSheet(store: EditorStore, hadFrames: boolean): { image: string; frames: Frame[] | null } {
  const { doc } = store;
  const n = doc.frames.length, w = doc.width, h = doc.height;
  const sheetW = w * n;
  const sheet = new Uint8ClampedArray(sheetW * h * 4);
  doc.frames.forEach((f, i) => {
    const c = compositeFrame(doc, f);
    for (let y = 0; y < h; y++) sheet.set(c.subarray(y * w * 4, (y + 1) * w * 4), (y * sheetW + i * w) * 4);
  });
  const animated = n > 1 || hadFrames;
  return {
    image: rgbaToPngDataUrl(sheetW, h, sheet),
    frames: animated ? doc.frames.map((f, i) => ({ name: `frame_${i}`, rect: { x: i * w, y: 0, w, h }, duration: f.duration })) : null,
  };
}

export default function EditorPage() {
  const { id = '' } = useParams();
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState(null);
    setError(null);
    loadEditor(id)
      .then((s) => { if (alive) setState(s); })
      .catch((e: unknown) => { if (alive) setError(e instanceof ApiError || e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [id]);

  if (error) {
    return (
      <div className="ed-root">
        <div className="page">
          <div className="notice error">Could not open the editor: {error}</div>
          <div><Link className="btn" to={`/assets/${id}`}>Back to asset</Link></div>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="ed-root ed-loading">
        <span className="spin" /> <span className="muted">Loading editor…</span>
      </div>
    );
  }
  return <Editor key={state.asset.id} loaded={state} />;
}

function Editor({ loaded }: { loaded: Loaded }) {
  const { store, asset } = loaded;
  useStore(store);
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(loaded.notice ? { kind: 'info', text: loaded.notice } : null);
  const [sideOpen, setSideOpen] = useState(false);
  const savingRef = useRef(false);

  // Persist the custom palette per project.
  const customKey = JSON.stringify(store.custom);
  useEffect(() => {
    localStorage.setItem(`sprixy.editor.palette.${asset.projectId}`, customKey);
  }, [customKey, asset.projectId]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (store.dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [store]);

  const save = useCallback(async (asNew: boolean) => {
    if (savingRef.current) return;
    store.commitFloating();
    let name: string | undefined;
    if (asNew) {
      const v = window.prompt('Name of the new variant', `${asset.name} · edit`);
      if (v === null) return;
      name = v.trim() || `${asset.name} · edit`;
    }
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const { image, frames } = buildSheet(store, !!asset.frames?.length);
      const saved = await put<Asset>(`/api/v1/assets/${asset.id}/image`, { image, document: serializeDoc(store.doc), frames, saveAsNew: asNew, name });
      store.markSaved();
      if (asNew) {
        navigate(`/assets/${saved.id}/edit`);
        return;
      }
      setMessage({ kind: 'ok', text: `Saved · ${new Date().toLocaleTimeString()}` });
    } catch (e) {
      setMessage({ kind: 'error', text: `Save failed: ${(e as Error).message}` });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [store, asset, navigate]);

  // Keyboard shortcuts
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); void save(e.shiftKey); return; }
      if (isField(e.target)) return;
      if (mod) {
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
        else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); store.redo(); }
        else if (k === 'c') { e.preventDefault(); store.copy(); }
        else if (k === 'x') { e.preventDefault(); store.cut(); }
        else if (k === 'v') { e.preventDefault(); store.paste(); }
        else if (k === 'a') { e.preventDefault(); store.setTool('select'); store.selectAll(); }
        else if (k === 'd') { e.preventDefault(); store.deselect(); }
        return;
      }
      if (e.altKey) return;
      switch (k) {
        case 'b': store.setTool('pencil'); break;
        case 'e': store.setTool('eraser'); break;
        case 'g': store.setTool('fill'); break;
        case 'm': store.setTool('select'); break;
        case 'i': store.setTool('eyedropper'); break;
        case 'l': store.setTool('line'); break;
        case 'u': store.setTool('rect'); break;
        case 'x': store.swapColors(); break;
        case 'o': store.toggle('onion'); break;
        case '#': store.toggle('showGrid'); break;
        case '[': store.setBrush(store.brush - 1); break;
        case ']': store.setBrush(store.brush + 1); break;
        case '+': case '=': store.zoomStep(1); break;
        case '-': case '_': store.zoomStep(-1); break;
        case '0': store.fit(); break;
        case '1': store.zoomTo(1); break;
        case ',': store.selectFrame((store.frameIndex - 1 + store.doc.frames.length) % store.doc.frames.length); break;
        case '.': store.selectFrame((store.frameIndex + 1) % store.doc.frames.length); break;
        case 'delete': case 'backspace': if (store.selection) { e.preventDefault(); store.deleteSelection(); } break;
        case 'escape': store.deselect(); break;
        default: return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, save]);

  const leave = (e: React.MouseEvent) => {
    if (store.dirty && !window.confirm('You have unsaved changes. Leave the editor anyway?')) e.preventDefault();
  };

  const h = store.history;
  return (
    <div className={`ed-root ${sideOpen ? 'side-open' : ''}`}>
      <div className="ed-top">
        <Link to={`/assets/${asset.id}`} className="btn sm ghost" onClick={leave} title="Back to the asset page">← Back</Link>
        <div className="ed-title">
          <strong title={asset.name}>{asset.name}</strong>
          <span className="mono muted small">{store.doc.width}×{store.doc.height}{store.doc.frames.length > 1 ? ` · ${store.doc.frames.length} frames` : ''}</span>
          {store.dirty ? <span className="chip accent" title="Unsaved changes">● unsaved</span> : <span className="chip green">saved</span>}
        </div>
        <div className="row ed-group">
          <button className="btn sm icon" title="Undo (Ctrl+Z)" disabled={!h.undoCount} onClick={() => store.undo()}><Icon name="undo" size={14} /></button>
          <button className="btn sm icon" title="Redo (Ctrl+Shift+Z / Ctrl+Y)" disabled={!h.redoCount} onClick={() => store.redo()}><Icon name="redo" size={14} /></button>
          <span className="mono small muted" title={h.lastLabel ? `Last: ${h.lastLabel}` : 'History'}>{h.undoCount}↶ {h.redoCount}↷</span>
        </div>
        <div className="row ed-group">
          <button className="btn sm icon" title="Zoom out (-)" onClick={() => store.zoomStep(-1)}>−</button>
          <select className="select mono" style={{ width: 78, height: 26 }} value={store.zoom} onChange={(e) => store.zoomTo(Number(e.target.value))}>
            {ZOOM_STEPS.map((z) => <option key={z} value={z}>{z * 100}%</option>)}
            {!ZOOM_STEPS.includes(store.zoom) && <option value={store.zoom}>{store.zoom * 100}%</option>}
          </select>
          <button className="btn sm icon" title="Zoom in (+)" onClick={() => store.zoomStep(1)}>+</button>
          <button className="btn sm" title="Fit (0)" onClick={() => store.fit()}>Fit</button>
          <button className="btn sm" title="Actual pixels (1)" onClick={() => store.zoomTo(1)}>1:1</button>
          <button className={`btn sm ${store.showGrid ? 'on' : ''}`} title="Pixel grid (#)" onClick={() => store.toggle('showGrid')}>Grid</button>
        </div>
        <div className="row ed-group ed-right">
          <a className="btn sm ghost" href={`/api/v1/assets/${asset.id}/export?format=png`} download title="Download the last saved version">PNG</a>
          {(store.doc.frames.length > 1 || asset.frames?.length) && <a className="btn sm ghost" href={`/api/v1/assets/${asset.id}/export?format=gif&scale=4`} download title="Download the last saved version">GIF</a>}
          <button className={`btn sm ${aiOpen ? 'on' : ''}`} onClick={() => setAiOpen((v) => !v)} title="Repaint the selected region with AI (paid, palette-locked)">✦ AI edit</button>
          <button className="btn sm ed-side-toggle" onClick={() => setSideOpen((v) => !v)}>Panels</button>
          <button className="btn sm" disabled={saving} onClick={() => void save(true)} title="Save as a new variant (Ctrl+Shift+S)">Save as variant</button>
          <button className="btn sm primary" disabled={saving || !store.dirty} onClick={() => void save(false)} title="Save (Ctrl+S)">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      <div className="ed-sub">
        <ToolOptions store={store} />
        {message && (
          <span className={`ed-msg ${message.kind}`}>
            {message.text}
            <button className="btn sm ghost" onClick={() => setMessage(null)}>×</button>
          </span>
        )}
      </div>
      <div className="ed-body" style={{ position: 'relative' }}>
        {aiOpen && <AiEditPanel store={store} assetId={asset.id} onClose={() => setAiOpen(false)} onMessage={(kind, text) => setMessage({ kind, text })} />}
        <ToolColumn store={store} />
        <EditorCanvas store={store} />
        <aside className="ed-side">
          <ColorsPanel store={store} />
          <LayersPanel store={store} />
          <PreviewPanel store={store} />
          <div className="ed-shortcuts muted small">
            <kbd>B</kbd> pencil · <kbd>E</kbd> eraser · <kbd>G</kbd> fill · <kbd>L</kbd> line · <kbd>U</kbd> rect · <kbd>M</kbd> select · <kbd>I</kbd> pick · <kbd>X</kbd> swap ·
            <kbd>[</kbd>/<kbd>]</kbd> size · <kbd>Space</kbd>+drag pan · wheel zoom · <kbd>,</kbd>/<kbd>.</kbd> frames · <kbd>O</kbd> onion
          </div>
        </aside>
      </div>
      <FrameStrip store={store} />
    </div>
  );
}
