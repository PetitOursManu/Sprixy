import { useEffect, useState } from 'react';
import { fmtUsd, get, post, type Estimate, type Generation } from '../api';
import { compositeFrame, loadImageRGBA, rgbaToPngDataUrl } from './doc';
import type { EditorStore } from './store';

/**
 * AI edit of the current selection: the server repaints the region with an edit model, re-pixelizes and
 * palette-locks it, and changes nothing outside the selection. The result comes back as a new layer
 * (undoable, can be hidden or erased).
 */
export function AiEditPanel({ store, assetId, onClose, onMessage }: {
  store: EditorStore;
  assetId: string;
  onClose: () => void;
  onMessage: (kind: 'info' | 'error', text: string) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [est, setEst] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rect = store.selection;

  const spec = () => {
    const frame = store.doc.frames[store.frameIndex];
    const image = rgbaToPngDataUrl(store.doc.width, store.doc.height, compositeFrame(store.doc, frame));
    return { task: 'inpaint', assetId, prompt: prompt.trim(), rect, image };
  };

  useEffect(() => {
    if (!rect || !prompt.trim()) { setEst(null); return; }
    const t = setTimeout(() => {
      post<Estimate>('/api/v1/generations/estimate', spec()).then(setEst).catch(() => setEst(null));
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, rect?.x, rect?.y, rect?.w, rect?.h]);

  async function run() {
    if (!rect) return;
    const r = { ...rect };
    setBusy('Starting…');
    try {
      let g = await post<Generation>('/api/v1/generations', spec());
      while (g.status === 'queued' || g.status === 'running') {
        setBusy(g.progress ?? 'Generating…');
        await new Promise((res) => setTimeout(res, 1500));
        g = await get<Generation>(`/api/v1/generations/${g.id}`);
      }
      if (g.status !== 'succeeded' || !g.outputAssetIds[0]) throw new Error(g.error ?? `Job ${g.status}`);
      const out = await loadImageRGBA(`/api/v1/assets/${g.outputAssetIds[0]}/file?v=${Date.now()}`);
      if (out.width !== store.doc.width || out.height !== store.doc.height) throw new Error('Result size mismatch');
      // Keep only the selected rectangle in the new layer.
      const W = store.doc.width;
      const layer = new Uint8ClampedArray(W * store.doc.height * 4);
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * W + x) * 4;
        layer[i] = out.data[i]; layer[i + 1] = out.data[i + 1]; layer[i + 2] = out.data[i + 2]; layer[i + 3] = out.data[i + 3];
      }
      store.addLayerWithPixels(`AI: ${prompt.trim().slice(0, 28)}`, layer);
      onMessage('info', `AI edit added as a new layer (${fmtUsd(g.actualCost)}). Hide or erase it to compare, Ctrl+Z to undo.`);
      onClose();
    } catch (e) {
      onMessage('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel" style={{ position: 'absolute', top: 8, right: 8, width: 320, zIndex: 20, boxShadow: '0 12px 30px rgba(0,0,0,.5)' }}>
      <div className="panel-head"><h3>AI edit selection</h3><button className="btn ghost sm" onClick={onClose}>×</button></div>
      <div className="panel-body">
        {!rect ? (
          <div className="small muted">Select a rectangle first (<kbd>M</kbd>), then describe the change. Pixels outside the selection are never modified.</div>
        ) : (
          <>
            <div className="small muted mono">Region {rect.w}×{rect.h} at {rect.x},{rect.y}</div>
            <textarea className="textarea" autoFocus placeholder="e.g. replace the sword with a glowing blue staff" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <div className="row between small">
              <span className="muted">{est ? `${est.model.name}` : 'Estimating…'}</span>
              <span className="cost">{est ? (est.estimate.usd === null ? 'after run' : `≈ ${fmtUsd(est.estimate.usd)}`) : ''}</span>
            </div>
            <button className="btn primary" disabled={!prompt.trim() || !!busy} onClick={() => void run()}>{busy ?? 'Repaint selection'}</button>
          </>
        )}
      </div>
    </div>
  );
}
