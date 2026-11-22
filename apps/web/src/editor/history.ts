import type { Doc } from './doc';

/** Pixel edits store only the touched cel; structural edits store whole-document snapshots. */
export type HistoryEntry =
  | { kind: 'cel'; label: string; frameId: string; layerId: string; before: Uint8ClampedArray; after: Uint8ClampedArray }
  | { kind: 'doc'; label: string; before: DocSnapshot; after: DocSnapshot };

export interface DocSnapshot {
  doc: Doc;
  frameIndex: number;
  layerId: string;
}

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  constructor(public limit = 200) {}

  push(e: HistoryEntry): void {
    this.undoStack.push(e);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  popUndo(): HistoryEntry | undefined {
    const e = this.undoStack.pop();
    if (e) this.redoStack.push(e);
    return e;
  }
  popRedo(): HistoryEntry | undefined {
    const e = this.redoStack.pop();
    if (e) this.undoStack.push(e);
    return e;
  }
  get undoCount(): number { return this.undoStack.length; }
  get redoCount(): number { return this.redoStack.length; }
  get lastLabel(): string | undefined { return this.undoStack[this.undoStack.length - 1]?.label; }
  clear(): void { this.undoStack = []; this.redoStack = []; }
}
