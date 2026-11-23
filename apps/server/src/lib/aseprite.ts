import { deflateSync } from 'node:zlib';

/**
 * Minimal .aseprite writer (RGBA, layers, frames, one animation tag) following the official file spec:
 * https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
 */
export interface AseLayer {
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
}

export interface AseFrame {
  durationMs: number;
  /** One RGBA buffer per layer (width × height × 4), or null for an empty cel. */
  cels: (Uint8ClampedArray | null)[];
}

class Writer {
  private chunks: Buffer[] = [];
  byte(v: number) { const b = Buffer.alloc(1); b.writeUInt8(v & 0xff); this.chunks.push(b); return this; }
  word(v: number) { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); this.chunks.push(b); return this; }
  short(v: number) { const b = Buffer.alloc(2); b.writeInt16LE(v); this.chunks.push(b); return this; }
  dword(v: number) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); this.chunks.push(b); return this; }
  zeros(n: number) { this.chunks.push(Buffer.alloc(n)); return this; }
  bytes(b: Buffer | Uint8Array) { this.chunks.push(Buffer.from(b)); return this; }
  string(s: string) { const b = Buffer.from(s, 'utf8'); this.word(b.length); this.chunks.push(b); return this; }
  build() { return Buffer.concat(this.chunks); }
}

function chunk(type: number, body: Buffer): Buffer {
  const w = new Writer().dword(body.length + 6).word(type);
  return Buffer.concat([w.build(), body]);
}

function contentBox(data: Uint8ClampedArray, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] === 0) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function encodeAseprite(width: number, height: number, layers: AseLayer[], frames: AseFrame[], tagName?: string): Buffer {
  const frameBuffers: Buffer[] = [];
  frames.forEach((frame, fi) => {
    const chunks: Buffer[] = [];
    if (fi === 0) {
      // Color profile: sRGB
      chunks.push(chunk(0x2007, new Writer().word(1).word(0).dword(0).zeros(8).build()));
      for (const l of layers) {
        chunks.push(chunk(0x2004, new Writer()
          .word((l.visible ? 1 : 0) | 2) // visible | editable
          .word(0) // normal layer
          .word(0) // child level
          .word(0).word(0) // default size (ignored)
          .word(0) // blend: normal
          .byte(Math.round(Math.max(0, Math.min(1, l.opacity)) * 255))
          .zeros(3)
          .string(l.name)
          .build()));
      }
      if (tagName && frames.length > 1) {
        chunks.push(chunk(0x2018, new Writer()
          .word(1).zeros(8)
          .word(0).word(frames.length - 1).byte(0).word(0).zeros(6).byte(255).byte(181).byte(71).byte(0)
          .string(tagName)
          .build()));
      }
    }
    frame.cels.forEach((cel, li) => {
      if (!cel) return;
      const box = contentBox(cel, width, height);
      if (!box) return;
      const px = Buffer.alloc(box.w * box.h * 4);
      for (let y = 0; y < box.h; y++) {
        const src = ((box.y + y) * width + box.x) * 4;
        Buffer.from(cel.buffer, cel.byteOffset + src, box.w * 4).copy(px, y * box.w * 4);
      }
      chunks.push(chunk(0x2005, new Writer()
        .word(li).short(box.x).short(box.y).byte(255)
        .word(2) // compressed image
        .short(0) // z-index
        .zeros(5)
        .word(box.w).word(box.h)
        .bytes(deflateSync(px))
        .build()));
    });
    const body = Buffer.concat(chunks);
    const header = new Writer()
      .dword(16 + body.length)
      .word(0xf1fa)
      .word(Math.min(chunks.length, 0xffff))
      .word(Math.max(1, Math.round(frame.durationMs)))
      .zeros(2)
      .dword(chunks.length)
      .build();
    frameBuffers.push(Buffer.concat([header, body]));
  });
  const framesData = Buffer.concat(frameBuffers);
  const header = new Writer()
    .dword(128 + framesData.length)
    .word(0xa5e0)
    .word(frames.length)
    .word(width).word(height)
    .word(32) // RGBA
    .dword(1) // layer opacity is valid
    .word(Math.max(1, Math.round(frames[0]?.durationMs ?? 100)))
    .dword(0).dword(0)
    .byte(0).zeros(3)
    .word(0)
    .byte(1).byte(1) // pixel ratio 1:1
    .short(0).short(0).word(16).word(16)
    .zeros(84)
    .build();
  return Buffer.concat([header, framesData]);
}

// ── Sprixy editor documents (layers) ──

interface SerializedDoc {
  format: 'sprixy-editor';
  version: 1;
  width: number;
  height: number;
  layers: { id: string; name: string; visible: boolean; opacity: number }[];
  frames: { id: string; duration: number; cels: Record<string, string | null> }[];
}

function rleDecode(bytes: Buffer, pixelCount: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixelCount * 4);
  let o = 0;
  for (let i = 0; i + 5 < bytes.length && o < out.length; i += 6) {
    const run = bytes[i] | (bytes[i + 1] << 8);
    for (let k = 0; k < run && o < out.length; k++) {
      out[o++] = bytes[i + 2]; out[o++] = bytes[i + 3]; out[o++] = bytes[i + 4]; out[o++] = bytes[i + 5];
    }
  }
  return out;
}

export interface LayeredDoc {
  width: number;
  height: number;
  layers: AseLayer[];
  frames: AseFrame[];
}

/** Decode the layered document saved by the Sprixy editor (null if absent / invalid). */
export function decodeEditorDoc(raw: unknown): LayeredDoc | null {
  const d = raw as SerializedDoc | null;
  if (!d || d.format !== 'sprixy-editor' || d.version !== 1 || !Array.isArray(d.layers) || !Array.isArray(d.frames)) return null;
  const px = d.width * d.height;
  return {
    width: d.width,
    height: d.height,
    layers: d.layers.map((l) => ({ name: String(l.name ?? 'Layer'), visible: l.visible !== false, opacity: typeof l.opacity === 'number' ? l.opacity : 1 })),
    frames: d.frames.map((f) => ({
      durationMs: typeof f.duration === 'number' ? f.duration : 100,
      cels: d.layers.map((l) => {
        const b = f.cels?.[l.id];
        return b ? rleDecode(Buffer.from(b, 'base64'), px) : null;
      }),
    })),
  };
}

/** Flatten visible layers (straight alpha, source-over with layer opacity) — used to check a doc is up to date. */
export function flattenDoc(doc: LayeredDoc, frameIndex: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(doc.width * doc.height * 4);
  const f = doc.frames[frameIndex];
  doc.layers.forEach((l, li) => {
    const cel = f.cels[li];
    if (!l.visible || !cel) return;
    for (let i = 0; i < out.length; i += 4) {
      const sa = (cel[i + 3] / 255) * l.opacity;
      if (sa <= 0) continue;
      const da = out[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) out[i + c] = Math.round((cel[i + c] * sa + out[i + c] * da * (1 - sa)) / oa);
      out[i + 3] = Math.round(oa * 255);
    }
  });
  return out;
}
