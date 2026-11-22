import { describe, it, expect } from 'vitest';
import { newDoc, serializeDoc, deserializeDoc, rleEncode, rleDecode, compositeFrame, emptyCel } from './doc';
import { bresenham, floodFill, plot } from './tools';
import { EditorStore } from './store';

describe('editor document', () => {
  it('RLE round-trips and serializes layered documents', () => {
    const cel = emptyCel(8, 8);
    cel.set([255, 0, 0, 255], 0);
    cel.set([0, 255, 0, 128], 4 * 37);
    expect(rleDecode(rleEncode(cel), 64)).toEqual(cel);
    const doc = newDoc(8, 8, [cel]);
    const back = deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(doc))))!;
    expect(back.width).toBe(8);
    expect(compositeFrame(back, back.frames[0])).toEqual(compositeFrame(doc, doc.frames[0]));
    expect(deserializeDoc({ format: 'other' })).toBeNull();
  });

  it('draws gap-free lines and fills contiguously or globally', () => {
    const pts: string[] = [];
    bresenham(0, 0, 5, 2, (x, y) => pts.push(`${x},${y}`));
    expect(pts[0]).toBe('0,0');
    expect(pts[pts.length - 1]).toBe('5,2');
    expect(pts).toHaveLength(6);
    const c = emptyCel(4, 4);
    plot(c, 4, 4, 1, 0, 1, [9, 9, 9, 255]);
    plot(c, 4, 4, 1, 1, 1, [9, 9, 9, 255]);
    plot(c, 4, 4, 1, 2, 1, [9, 9, 9, 255]);
    plot(c, 4, 4, 1, 3, 1, [9, 9, 9, 255]);
    plot(c, 4, 4, 3, 3, 1, [9, 9, 9, 255]);
    expect(floodFill(c, 4, 4, 0, 0, [1, 2, 3, 255])).toBe(true);
    expect(c[(3 * 4 + 0) * 4]).toBe(1); // left column filled
    expect(c[(0 * 4 + 2) * 4 + 3]).toBe(0); // right side untouched (wall at x=1)
    floodFill(c, 4, 4, 1, 0, [7, 7, 7, 255], true);
    expect(c[(3 * 4 + 3) * 4]).toBe(7); // global fill reached the isolated pixel
  });
});

describe('editor store', () => {
  it('undo / redo pixel edits and structural changes', () => {
    const s = new EditorStore(newDoc(4, 4));
    s.beginCelEdit('Draw');
    plot(s.activeCel(), 4, 4, 0, 0, 1, [255, 0, 0, 255]);
    s.endCelEdit();
    expect(s.history.undoCount).toBe(1);
    expect(s.dirty).toBe(true);
    s.addLayer();
    s.addFrame();
    expect(s.doc.layers).toHaveLength(2);
    expect(s.doc.frames).toHaveLength(2);
    s.undo();
    s.undo();
    expect(s.doc.layers).toHaveLength(1);
    expect(s.doc.frames).toHaveLength(1);
    s.undo();
    expect(s.activeCel()[3]).toBe(0);
    s.redo();
    expect(s.activeCel()[3]).toBe(255);
  });

  it('moves a selection and records it as one undoable step', () => {
    const s = new EditorStore(newDoc(4, 4));
    s.beginCelEdit('Draw');
    plot(s.activeCel(), 4, 4, 0, 0, 1, [255, 0, 0, 255]);
    s.endCelEdit();
    s.setSelection({ x: 0, y: 0, w: 1, h: 1 });
    s.liftSelection();
    s.moveFloating(2, 2);
    s.deselect();
    const at = (x: number, y: number) => s.activeCel()[(y * 4 + x) * 4 + 3];
    expect(at(0, 0)).toBe(0);
    expect(at(2, 2)).toBe(255);
    s.undo();
    expect(at(0, 0)).toBe(255);
    expect(at(2, 2)).toBe(0);
  });

  it('merges layers respecting opacity', () => {
    const s = new EditorStore(newDoc(1, 1));
    s.beginCelEdit('a');
    plot(s.activeCel(), 1, 1, 0, 0, 1, [0, 0, 0, 255]);
    s.endCelEdit();
    s.addLayer();
    s.setLayerProps(s.layerId, { opacity: 0.5 });
    s.beginCelEdit('b');
    plot(s.activeCel(), 1, 1, 0, 0, 1, [255, 255, 255, 255]);
    s.endCelEdit();
    s.mergeDown();
    expect(s.doc.layers).toHaveLength(1);
    const v = s.activeCel()[0];
    expect(v).toBeGreaterThan(120);
    expect(v).toBeLessThan(135);
  });
});
