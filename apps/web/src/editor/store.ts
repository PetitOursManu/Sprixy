import {
  type Doc, type EFrame, type Layer, type RGBA,
  celOf, cloneDoc, compositeFrame, emptyCel, uid, rgbaToHex, hexToRgba, blendOver,
} from './doc';
import { History, type DocSnapshot, type HistoryEntry } from './history';
import { clearRect, copyRect, pasteOver, type Rect } from './tools';

export type Tool = 'pencil' | 'eraser' | 'fill' | 'select' | 'eyedropper' | 'line' | 'rect';

export const ZOOM_STEPS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];

export interface Floating {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  x: number;
  y: number;
  /** Cel content before the selection was lifted / pasted. */
  before: Uint8ClampedArray;
  frameId: string;
  layerId: string;
}

/**
 * Mutable editor store. Pixel buffers are edited in place for speed; React components
 * subscribe through `subscribe` / `getVersion` (useSyncExternalStore).
 */
export class EditorStore {
  doc: Doc;
  frameIndex = 0;
  layerId: string;
  tool: Tool = 'pencil';
  brush = 1;
  primary: RGBA = [20, 16, 24, 255];
  secondary: RGBA = [255, 255, 255, 255];
  fillGlobal = false;
  mirrorX = false;
  shapeFilled = false;
  showGrid = true;
  onion = false;
  zoom = 8;
  ox = 0;
  oy = 0;
  selection: Rect | null = null;
  floating: Floating | null = null;
  clipboard: { data: Uint8ClampedArray; w: number; h: number } | null = null;
  recent: string[] = [];
  custom: string[] = [];
  projectPalette: string[] = [];
  assetPalette: string[] = [];
  dirty = false;
  history = new History(200);
  version = 0;
  /** Bumped when something affecting every frame's composite changes (layer visibility/opacity/order). */
  epoch = 0;
  private listeners = new Set<() => void>();
  private strokeBefore: Uint8ClampedArray | null = null;
  private strokeLabel = '';
  private cache = new Map<string, { key: string; data: Uint8ClampedArray }>();

  constructor(doc: Doc) {
    this.doc = doc;
    this.layerId = doc.layers[doc.layers.length - 1].id;
  }

  // ── subscription ──
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getVersion = () => this.version;
  emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ── accessors ──
  get frame(): EFrame { return this.doc.frames[this.frameIndex]; }
  get layer(): Layer { return this.doc.layers.find((l) => l.id === this.layerId) ?? this.doc.layers[0]; }
  activeCel(): Uint8ClampedArray { return celOf(this.doc, this.frame, this.layer.id); }
  touch(frame: EFrame = this.frame): void { frame.rev++; }

  /** Cached composite of a frame (visible layers). */
  composite(frame: EFrame): Uint8ClampedArray {
    const key = `${frame.rev}:${this.epoch}`;
    const hit = this.cache.get(frame.id);
    if (hit && hit.key === key) return hit.data;
    const data = compositeFrame(this.doc, frame);
    this.cache.set(frame.id, { key, data });
    return data;
  }

  /** Composite including the floating selection (what the user sees). */
  compositeWithFloating(frame: EFrame): Uint8ClampedArray {
    const base = this.composite(frame);
    if (!this.floating || this.floating.frameId !== frame.id) return base;
    const out = base.slice();
    const tmp = emptyCel(this.doc.width, this.doc.height);
    pasteOver(tmp, this.doc.width, this.doc.height, this.floating.data, this.floating.w, this.floating.h, this.floating.x, this.floating.y);
    blendOver(out, tmp, this.layer.opacity);
    return out;
  }

  // ── history plumbing ──
  private snapshot(): DocSnapshot {
    return { doc: cloneDoc(this.doc), frameIndex: this.frameIndex, layerId: this.layerId };
  }
  private restore(s: DocSnapshot): void {
    this.doc = cloneDoc(s.doc);
    for (const f of this.doc.frames) f.rev++;
    this.frameIndex = Math.min(s.frameIndex, this.doc.frames.length - 1);
    this.layerId = this.doc.layers.some((l) => l.id === s.layerId) ? s.layerId : this.doc.layers[this.doc.layers.length - 1].id;
    this.epoch++;
    this.cache.clear();
  }
  private pushEntry(e: HistoryEntry): void {
    this.history.push(e);
    this.dirty = true;
  }

  /** Structural change recorded as a full snapshot. */
  docChange(label: string, fn: () => void): void {
    this.commitFloating();
    const before = this.snapshot();
    fn();
    this.epoch++;
    this.pushEntry({ kind: 'doc', label, before, after: this.snapshot() });
    this.emit();
  }

  beginCelEdit(label: string): void {
    this.commitFloating();
    this.strokeBefore = this.activeCel().slice();
    this.strokeLabel = label;
  }
  /** Restore the cel to its state at stroke start (used for shape previews). */
  revertStroke(): void {
    if (this.strokeBefore) this.activeCel().set(this.strokeBefore);
  }
  get inStroke(): boolean { return this.strokeBefore !== null; }
  endCelEdit(): void {
    const before = this.strokeBefore;
    this.strokeBefore = null;
    if (!before) return;
    const after = this.activeCel();
    let changed = false;
    for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) { changed = true; break; }
    if (changed) {
      this.pushEntry({ kind: 'cel', label: this.strokeLabel, frameId: this.frame.id, layerId: this.layer.id, before, after: after.slice() });
      this.noteColorUsed();
    }
    this.touch();
    this.emit();
  }

  private applyCel(frameId: string, layerId: string, data: Uint8ClampedArray): void {
    const f = this.doc.frames.find((x) => x.id === frameId);
    if (!f) return;
    f.cels[layerId] = data.slice();
    f.rev++;
    const fi = this.doc.frames.indexOf(f);
    if (fi >= 0) this.frameIndex = fi;
    if (this.doc.layers.some((l) => l.id === layerId)) this.layerId = layerId;
  }

  undo(): void {
    if (this.floating) { this.commitFloating(); }
    const e = this.history.popUndo();
    if (!e) { this.emit(); return; }
    if (e.kind === 'cel') this.applyCel(e.frameId, e.layerId, e.before);
    else this.restore(e.before);
    this.selection = null;
    this.dirty = true;
    this.emit();
  }

  redo(): void {
    if (this.floating) this.commitFloating();
    const e = this.history.popRedo();
    if (!e) return;
    if (e.kind === 'cel') this.applyCel(e.frameId, e.layerId, e.after);
    else this.restore(e.after);
    this.selection = null;
    this.dirty = true;
    this.emit();
  }

  // ── tools & colors ──
  setTool(t: Tool): void {
    if (t !== 'select') this.commitFloating();
    this.tool = t;
    this.emit();
  }
  setPrimary(c: RGBA): void { this.primary = c; this.emit(); }
  setSecondary(c: RGBA): void { this.secondary = c; this.emit(); }
  swapColors(): void { [this.primary, this.secondary] = [this.secondary, this.primary]; this.emit(); }
  noteColorUsed(): void {
    if (this.tool === 'eraser') return;
    const hex = rgbaToHex(this.primary);
    this.recent = [hex, ...this.recent.filter((c) => c !== hex)].slice(0, 16);
  }
  addCustomColor(hex: string): void {
    if (!this.custom.includes(hex)) this.custom = [...this.custom, hex];
    this.emit();
  }
  removeCustomColor(hex: string): void {
    this.custom = this.custom.filter((c) => c !== hex);
    this.emit();
  }
  pickColor(x: number, y: number, secondary = false): void {
    if (x < 0 || y < 0 || x >= this.doc.width || y >= this.doc.height) return;
    const d = this.composite(this.frame);
    const i = (y * this.doc.width + x) * 4;
    if (d[i + 3] === 0) return;
    const c: RGBA = [d[i], d[i + 1], d[i + 2], 255];
    if (secondary) this.secondary = c; else this.primary = c;
    this.emit();
  }
  usePaletteColor(hex: string, secondary = false): void {
    const c = hexToRgba(hex);
    if (secondary) this.secondary = c; else this.primary = c;
    this.emit();
  }

  // ── view ──
  setView(zoom: number, ox: number, oy: number): void {
    this.zoom = zoom;
    this.ox = Math.round(ox);
    this.oy = Math.round(oy);
    this.emit();
  }
  /** Viewport size in CSS pixels (set by the canvas component). */
  viewW = 0;
  viewH = 0;
  setViewport(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    const first = this.viewW === 0 && this.viewH === 0;
    this.viewW = w;
    this.viewH = h;
    if (first) this.fit();
    else this.emit();
  }
  fit(): void {
    const { width, height } = this.doc;
    const avail = Math.max(1, Math.min((this.viewW - 40) / width, (this.viewH - 40) / height));
    let z = ZOOM_STEPS[0];
    for (const s of ZOOM_STEPS) if (s <= avail) z = s;
    this.setView(z, (this.viewW - width * z) / 2, (this.viewH - height * z) / 2);
  }
  /** Zoom to an absolute level keeping the screen point (cx, cy) fixed (defaults to the viewport centre). */
  zoomTo(z: number, cx = this.viewW / 2, cy = this.viewH / 2): void {
    const nz = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], z));
    const k = nz / this.zoom;
    this.setView(nz, cx - (cx - this.ox) * k, cy - (cy - this.oy) * k);
  }
  zoomStep(dir: 1 | -1, cx?: number, cy?: number): void {
    const i = ZOOM_STEPS.findIndex((s) => s >= this.zoom);
    const cur = i < 0 ? ZOOM_STEPS.length - 1 : ZOOM_STEPS[i] === this.zoom ? i : dir > 0 ? i - 1 : i;
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, cur + dir))];
    this.zoomTo(next, cx, cy);
  }
  toggle(key: 'showGrid' | 'onion' | 'mirrorX' | 'fillGlobal' | 'shapeFilled'): void {
    this[key] = !this[key];
    this.emit();
  }
  setBrush(n: number): void { this.brush = Math.max(1, Math.min(8, n)); this.emit(); }

  // ── layers ──
  selectLayer(id: string): void { this.commitFloating(); this.layerId = id; this.emit(); }
  addLayer(): void {
    this.docChange('Add layer', () => {
      const l: Layer = { id: uid('ly'), name: `Layer ${this.doc.layers.length + 1}`, visible: true, opacity: 1 };
      const idx = this.doc.layers.findIndex((x) => x.id === this.layerId);
      this.doc.layers.splice(idx + 1, 0, l);
      for (const f of this.doc.frames) f.cels[l.id] = emptyCel(this.doc.width, this.doc.height);
      this.layerId = l.id;
    });
  }
  duplicateLayer(): void {
    this.docChange('Duplicate layer', () => {
      const src = this.layer;
      const l: Layer = { ...src, id: uid('ly'), name: `${src.name} copy` };
      const idx = this.doc.layers.indexOf(src);
      this.doc.layers.splice(idx + 1, 0, l);
      for (const f of this.doc.frames) f.cels[l.id] = (f.cels[src.id] ?? emptyCel(this.doc.width, this.doc.height)).slice();
      this.layerId = l.id;
    });
  }
  deleteLayer(): void {
    if (this.doc.layers.length <= 1) return;
    this.docChange('Delete layer', () => {
      const idx = this.doc.layers.findIndex((x) => x.id === this.layerId);
      const [removed] = this.doc.layers.splice(idx, 1);
      for (const f of this.doc.frames) delete f.cels[removed.id];
      this.layerId = this.doc.layers[Math.max(0, idx - 1)].id;
    });
  }
  moveLayer(dir: 1 | -1): void {
    const idx = this.doc.layers.findIndex((x) => x.id === this.layerId);
    const to = idx + dir;
    if (to < 0 || to >= this.doc.layers.length) return;
    this.docChange(dir > 0 ? 'Move layer up' : 'Move layer down', () => {
      const [l] = this.doc.layers.splice(idx, 1);
      this.doc.layers.splice(to, 0, l);
    });
  }
  mergeDown(): void {
    const idx = this.doc.layers.findIndex((x) => x.id === this.layerId);
    if (idx <= 0) return;
    this.docChange('Merge down', () => {
      const top = this.doc.layers[idx], below = this.doc.layers[idx - 1];
      for (const f of this.doc.frames) {
        const dst = celOf(this.doc, f, below.id);
        // Bake the lower layer's opacity, then blend the top one with its own opacity.
        if (below.opacity < 1) for (let i = 3; i < dst.length; i += 4) dst[i] = Math.round(dst[i] * below.opacity);
        const src = f.cels[top.id];
        if (src && top.visible) blendOver(dst, src, top.opacity);
        delete f.cels[top.id];
        f.rev++;
      }
      below.opacity = 1;
      this.doc.layers.splice(idx, 1);
      this.layerId = below.id;
    });
  }
  /** Non-destructive layer props (not part of undo history, but mark the document dirty). */
  setLayerProps(id: string, props: Partial<Pick<Layer, 'name' | 'visible' | 'opacity'>>): void {
    const l = this.doc.layers.find((x) => x.id === id);
    if (!l) return;
    Object.assign(l, props);
    this.epoch++;
    this.dirty = true;
    this.emit();
  }

  // ── frames ──
  selectFrame(i: number): void {
    if (i < 0 || i >= this.doc.frames.length) return;
    this.commitFloating();
    this.frameIndex = i;
    this.emit();
  }
  addFrame(): void {
    this.docChange('Add frame', () => {
      const f: EFrame = { id: uid('fr'), duration: this.frame.duration, rev: 0, cels: {} };
      for (const l of this.doc.layers) f.cels[l.id] = emptyCel(this.doc.width, this.doc.height);
      this.doc.frames.splice(this.frameIndex + 1, 0, f);
      this.frameIndex++;
    });
  }
  duplicateFrame(): void {
    this.docChange('Duplicate frame', () => {
      const src = this.frame;
      const f: EFrame = { id: uid('fr'), duration: src.duration, rev: 0, cels: Object.fromEntries(Object.entries(src.cels).map(([k, v]) => [k, v.slice()])) };
      this.doc.frames.splice(this.frameIndex + 1, 0, f);
      this.frameIndex++;
    });
  }
  deleteFrame(): void {
    if (this.doc.frames.length <= 1) return;
    this.docChange('Delete frame', () => {
      this.doc.frames.splice(this.frameIndex, 1);
      this.frameIndex = Math.min(this.frameIndex, this.doc.frames.length - 1);
    });
  }
  moveFrame(dir: 1 | -1): void {
    const to = this.frameIndex + dir;
    if (to < 0 || to >= this.doc.frames.length) return;
    this.docChange('Move frame', () => {
      const [f] = this.doc.frames.splice(this.frameIndex, 1);
      this.doc.frames.splice(to, 0, f);
      this.frameIndex = to;
    });
  }
  setFrameDuration(i: number, ms: number): void {
    const f = this.doc.frames[i];
    if (!f || !Number.isFinite(ms) || ms <= 0) return;
    this.docChange('Frame duration', () => { this.doc.frames[i].duration = Math.round(ms); });
  }
  setAllDurations(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.docChange('Set frame rate', () => { for (const f of this.doc.frames) f.duration = Math.round(ms); });
  }

  // ── selection ──
  setSelection(r: Rect | null): void {
    this.commitFloating();
    this.selection = r;
    this.emit();
  }
  selectAll(): void { this.setSelection({ x: 0, y: 0, w: this.doc.width, h: this.doc.height }); }

  /** Cut the selected pixels of the active cel into a floating buffer (for moving). */
  liftSelection(): void {
    if (!this.selection || this.floating) return;
    const cel = this.activeCel();
    const before = cel.slice();
    const r = this.selection;
    const data = copyRect(cel, this.doc.width, r);
    clearRect(cel, this.doc.width, r);
    this.floating = { data, w: r.w, h: r.h, x: r.x, y: r.y, before, frameId: this.frame.id, layerId: this.layer.id };
    this.touch();
    this.emit();
  }
  moveFloating(x: number, y: number): void {
    if (!this.floating) return;
    this.floating.x = x;
    this.floating.y = y;
    this.selection = { x, y, w: this.floating.w, h: this.floating.h };
    this.emit();
  }
  commitFloating(): void {
    const fl = this.floating;
    if (!fl) return;
    this.floating = null;
    const frame = this.doc.frames.find((f) => f.id === fl.frameId);
    if (!frame || !this.doc.layers.some((l) => l.id === fl.layerId)) return;
    const cel = celOf(this.doc, frame, fl.layerId);
    pasteOver(cel, this.doc.width, this.doc.height, fl.data, fl.w, fl.h, fl.x, fl.y);
    frame.rev++;
    let changed = false;
    for (let i = 0; i < cel.length; i++) if (cel[i] !== fl.before[i]) { changed = true; break; }
    if (changed) this.pushEntry({ kind: 'cel', label: 'Move selection', frameId: frame.id, layerId: fl.layerId, before: fl.before, after: cel.slice() });
    // Clip the selection to the canvas.
    if (this.selection) {
      const x0 = Math.max(0, this.selection.x), y0 = Math.max(0, this.selection.y);
      const x1 = Math.min(this.doc.width, this.selection.x + this.selection.w), y1 = Math.min(this.doc.height, this.selection.y + this.selection.h);
      this.selection = x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    }
  }
  deleteSelection(): void {
    if (this.floating) {
      const fl = this.floating;
      this.floating = null;
      const cel = this.activeCel();
      let changed = false;
      for (let i = 0; i < cel.length; i++) if (cel[i] !== fl.before[i]) { changed = true; break; }
      if (changed) this.pushEntry({ kind: 'cel', label: 'Delete selection', frameId: fl.frameId, layerId: fl.layerId, before: fl.before, after: cel.slice() });
      this.selection = null;
      this.touch();
      this.emit();
      return;
    }
    if (!this.selection) return;
    this.beginCelEdit('Delete selection');
    clearRect(this.activeCel(), this.doc.width, this.selection);
    this.endCelEdit();
  }
  copy(): void {
    if (this.floating) {
      this.clipboard = { data: this.floating.data.slice(), w: this.floating.w, h: this.floating.h };
    } else if (this.selection) {
      this.clipboard = { data: copyRect(this.activeCel(), this.doc.width, this.selection), w: this.selection.w, h: this.selection.h };
    }
    this.emit();
  }
  cut(): void {
    this.copy();
    this.deleteSelection();
  }
  paste(): void {
    if (!this.clipboard) return;
    this.commitFloating();
    const x = this.selection ? this.selection.x : 0, y = this.selection ? this.selection.y : 0;
    const cel = this.activeCel();
    this.floating = { data: this.clipboard.data.slice(), w: this.clipboard.w, h: this.clipboard.h, x, y, before: cel.slice(), frameId: this.frame.id, layerId: this.layer.id };
    this.selection = { x, y, w: this.clipboard.w, h: this.clipboard.h };
    this.tool = 'select';
    this.emit();
  }
  deselect(): void {
    this.commitFloating();
    this.selection = null;
    this.emit();
  }

  /** Called after a successful save. */
  markSaved(): void {
    this.dirty = false;
    this.emit();
  }
}
