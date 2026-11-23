import { useEffect, useRef } from 'react';
import type { EditorStore, Tool } from './store';
import type { RGBA } from './doc';
import { drawLine, drawRect, floodFill, normRect, plot } from './tools';
import { useStore } from './useStore';

type Mode = 'none' | 'pan' | 'draw' | 'shape' | 'select-new' | 'select-move';

/** Main drawing surface: zoom / pan, onion skin, grid, selection marquee and all pointer tools. */
export function EditorCanvas({ store }: { store: EditorStore }) {
  useStore(store);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const space = useRef(false);
  const st = useRef<{ mode: Mode; start: { x: number; y: number }; last: { x: number; y: number }; color: RGBA | null; grab: { x: number; y: number }; panX: number; panY: number; moved: boolean; tool: Tool }>({
    mode: 'none', start: { x: 0, y: 0 }, last: { x: 0, y: 0 }, color: null, grab: { x: 0, y: 0 }, panX: 0, panY: 0, moved: false, tool: 'pencil',
  });

  // ── rendering ──
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const off = document.createElement('canvas');
    const offCtx = off.getContext('2d')!;
    const tile = document.createElement('canvas');
    tile.width = tile.height = 16;
    const tctx = tile.getContext('2d')!;
    tctx.fillStyle = '#ffffff'; tctx.fillRect(0, 0, 16, 16);
    tctx.fillStyle = '#e9f1f1'; tctx.fillRect(0, 0, 8, 8); tctx.fillRect(8, 8, 8, 8);
    const pattern = ctx.createPattern(tile, 'repeat')!;
    let raf = 0;
    let ants = 0;

    const drawRGBA = (data: Uint8ClampedArray, alpha: number) => {
      const { width, height } = store.doc;
      if (off.width !== width || off.height !== height) { off.width = width; off.height = height; }
      const id = offCtx.createImageData(width, height);
      id.data.set(data);
      offCtx.putImageData(id, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(off, store.ox, store.oy, width * store.zoom, height * store.zoom);
      ctx.globalAlpha = 1;
    };

    const draw = () => {
      raf = 0;
      const dpr = window.devicePixelRatio || 1;
      const cw = wrap.clientWidth, ch = wrap.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#edf4f4';
      ctx.fillRect(0, 0, cw, ch);
      const { width, height, frames } = store.doc;
      const z = store.zoom, ox = store.ox, oy = store.oy;
      const W = width * z, H = height * z;
      // checkerboard (transparency)
      ctx.save();
      ctx.translate(ox, oy);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      // onion skin
      if (store.onion && frames.length > 1) {
        const prev = frames[(store.frameIndex - 1 + frames.length) % frames.length];
        const next = frames[(store.frameIndex + 1) % frames.length];
        drawRGBA(store.composite(prev), 0.28);
        if (frames.length > 2) drawRGBA(store.composite(next), 0.12);
      }
      drawRGBA(store.compositeWithFloating(store.frame), 1);
      // pixel grid
      if (store.showGrid && z >= 6) {
        ctx.beginPath();
        for (let x = 1; x < width; x++) { ctx.moveTo(ox + x * z + 0.5, oy); ctx.lineTo(ox + x * z + 0.5, oy + H); }
        for (let y = 1; y < height; y++) { ctx.moveTo(ox, oy + y * z + 0.5); ctx.lineTo(ox + W, oy + y * z + 0.5); }
        ctx.strokeStyle = 'rgba(18,48,58,0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // canvas border
      ctx.strokeStyle = '#cbdede';
      ctx.strokeRect(ox - 0.5, oy - 0.5, W + 1, H + 1);
      // mirror axis
      if (store.mirrorX) {
        ctx.strokeStyle = 'rgba(42,167,171,0.75)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(ox + W / 2 + 0.5, oy);
        ctx.lineTo(ox + W / 2 + 0.5, oy + H);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // selection marquee (marching ants)
      const sel = store.selection;
      if (sel) {
        const x = ox + sel.x * z + 0.5, y = oy + sel.y * z + 0.5, w = sel.w * z - 1, h = sel.h * z - 1;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#000';
        ctx.lineDashOffset = -ants;
        ctx.strokeRect(x, y, w, h);
        ctx.strokeStyle = '#fff';
        ctx.lineDashOffset = -ants + 4;
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
      // brush cursor
      const hv = hover.current;
      if (hv && ['pencil', 'eraser', 'line', 'rect'].includes(store.tool) && st.current.mode !== 'pan') {
        const size = store.brush;
        const o = Math.floor((size - 1) / 2);
        ctx.strokeStyle = store.tool === 'eraser' ? 'rgba(214,69,61,0.95)' : 'rgba(255,122,24,0.95)';
        ctx.strokeRect(ox + (hv.x - o) * z + 0.5, oy + (hv.y - o) * z + 0.5, size * z - 1, size * z - 1);
      } else if (hv && store.tool !== 'select' && hv.x >= 0 && hv.y >= 0 && hv.x < width && hv.y < height) {
        ctx.strokeStyle = 'rgba(18,48,58,0.55)';
        ctx.strokeRect(ox + hv.x * z + 0.5, oy + hv.y * z + 0.5, z - 1, z - 1);
      }
    };

    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
    const unsub = store.subscribe(schedule);
    const ro = new ResizeObserver(() => { store.setViewport(wrap.clientWidth, wrap.clientHeight); schedule(); });
    ro.observe(wrap);
    const antTimer = window.setInterval(() => { if (store.selection) { ants = (ants + 1) % 8; schedule(); } }, 120);
    schedule();
    return () => { unsub(); ro.disconnect(); cancelAnimationFrame(raf); clearInterval(antTimer); };
  }, [store]);

  // ── wheel zoom & space-to-pan ──
  useEffect(() => {
    const wrap = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        if (Math.abs(e.deltaY) < 1) return;
        store.zoomStep(e.deltaY < 0 ? 1 : -1, cx, cy);
      } else {
        store.setView(store.zoom, store.ox - e.deltaX, store.oy);
      }
    };
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isField(e.target)) { space.current = true; wrap.style.cursor = 'grab'; e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') { space.current = false; wrap.style.cursor = ''; }
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      wrap.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [store]);

  const toPixel = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left - store.ox) / store.zoom), y: Math.floor((e.clientY - r.top - store.oy) / store.zoom) };
  };

  const inside = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number } | null) =>
    !!r && p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

  const onPointerDown = (e: React.PointerEvent) => {
    const s = st.current;
    if (s.mode !== 'none') return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || space.current) {
      s.mode = 'pan';
      s.panX = e.clientX - store.ox;
      s.panY = e.clientY - store.oy;
      wrapRef.current!.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const p = toPixel(e);
    const secondary = e.button === 2;
    const tool: Tool = e.altKey ? 'eyedropper' : store.tool;
    const { width: w, height: h } = store.doc;
    s.tool = tool;
    s.start = p;
    s.last = p;
    s.moved = false;
    s.color = tool === 'eraser' ? null : secondary ? store.secondary : store.primary;
    switch (tool) {
      case 'eyedropper':
        store.pickColor(p.x, p.y, secondary);
        return;
      case 'fill': {
        if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) return;
        store.beginCelEdit(store.fillGlobal ? 'Fill (global)' : 'Fill');
        floodFill(store.activeCel(), w, h, p.x, p.y, s.color, store.fillGlobal);
        store.endCelEdit();
        return;
      }
      case 'pencil':
      case 'eraser':
        store.beginCelEdit(tool === 'eraser' ? 'Erase' : 'Draw');
        plot(store.activeCel(), w, h, p.x, p.y, store.brush, s.color, store.mirrorX);
        store.touch();
        store.emit();
        s.mode = 'draw';
        return;
      case 'line':
      case 'rect':
        store.beginCelEdit(tool === 'line' ? 'Line' : 'Rectangle');
        s.mode = 'shape';
        shape(p, e.shiftKey);
        return;
      case 'select': {
        const fl = store.floating;
        if (fl && inside(p, { x: fl.x, y: fl.y, w: fl.w, h: fl.h })) {
          s.mode = 'select-move';
          s.grab = { x: p.x - fl.x, y: p.y - fl.y };
          return;
        }
        if (inside(p, store.selection)) {
          store.liftSelection();
          const f2 = store.floating!;
          s.mode = 'select-move';
          s.grab = { x: p.x - f2.x, y: p.y - f2.y };
          return;
        }
        store.setSelection(null);
        s.mode = 'select-new';
        return;
      }
    }
  };

  const shape = (p: { x: number; y: number }, shift: boolean) => {
    const s = st.current;
    const { width: w, height: h } = store.doc;
    store.revertStroke();
    const cel = store.activeCel();
    if (s.tool === 'line') drawLine(cel, w, h, s.start.x, s.start.y, p.x, p.y, store.brush, s.color, store.mirrorX);
    else drawRect(cel, w, h, s.start.x, s.start.y, p.x, p.y, store.brush, s.color, store.shapeFilled || shift, store.mirrorX);
    store.touch();
    store.emit();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = st.current;
    const p = toPixel(e);
    const prevHover = hover.current;
    hover.current = p;
    if (s.mode === 'pan') {
      store.setView(store.zoom, e.clientX - s.panX, e.clientY - s.panY);
      return;
    }
    if (p.x !== s.last.x || p.y !== s.last.y) s.moved = true;
    const { width: w, height: h } = store.doc;
    switch (s.mode) {
      case 'draw':
        if (p.x === s.last.x && p.y === s.last.y) break;
        drawLine(store.activeCel(), w, h, s.last.x, s.last.y, p.x, p.y, store.brush, s.color, store.mirrorX);
        s.last = p;
        store.touch();
        store.emit();
        return;
      case 'shape':
        if (p.x === s.last.x && p.y === s.last.y) break;
        s.last = p;
        shape(p, e.shiftKey);
        return;
      case 'select-new':
        store.selection = normRect(s.start.x, s.start.y, p.x, p.y, w, h);
        store.emit();
        return;
      case 'select-move':
        store.moveFloating(p.x - s.grab.x, p.y - s.grab.y);
        return;
    }
    if (!prevHover || prevHover.x !== p.x || prevHover.y !== p.y) store.emit();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = st.current;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    switch (s.mode) {
      case 'pan':
        wrapRef.current!.style.cursor = space.current ? 'grab' : '';
        break;
      case 'draw':
      case 'shape':
        store.endCelEdit();
        break;
      case 'select-new':
        if (!s.moved) { store.selection = null; store.emit(); }
        break;
    }
    s.mode = 'none';
  };

  return (
    <div
      ref={wrapRef}
      className={`ed-view tool-${store.tool}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => { hover.current = null; store.emit(); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} className="px" />
    </div>
  );
}
