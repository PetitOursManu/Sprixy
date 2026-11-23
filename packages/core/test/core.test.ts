import { describe, it, expect } from 'vitest';
import {
  createImage, setPixel, getPixel, contentBounds, trim, cloneImage,
  hexToRgb, rgbToHex, rgbToOklab, oklabToRgb,
  extractPalette, applyPalette, reduceColors, countColors,
  resizeNearest, upscaleInteger,
  detectPixelGrid, pixelize,
  removeBackgroundFlood, hardenAlpha,
  removeOrphans, addOutline, fillPinholes,
  sliceGrid, autoSlice, alignFrames, packSheet,
  paletteSwap, adjustHsl, replaceColors,
  makeSeamless, seamScore,
  runPipeline, PROCESS_OPS, PALETTE_PRESETS,
  type RGBAImage, type RGBA,
} from '../src/index.js';

function checker(w: number, h: number, cell: number, a: RGBA, b: RGBA): RGBAImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(img, x, y, ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? a : b));
  return img;
}

/** Build a small "logical" sprite then upscale it to simulate AI pseudo pixel art. */
function logicalSprite(): RGBAImage {
  const img = createImage(16, 16, [40, 200, 90, 255]);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) setPixel(img, x, y, [220, 40, 60, 255]);
  setPixel(img, 7, 7, [250, 250, 250, 255]);
  setPixel(img, 2, 13, [30, 30, 200, 255]);
  // a few more details, like a real sprite
  for (let x = 1; x < 15; x += 3) setPixel(img, x, 1, [240, 220, 60, 255]);
  for (let y = 2; y < 15; y += 4) setPixel(img, 14, y, [90, 60, 30, 255]);
  return img;
}

describe('color', () => {
  it('round-trips hex', () => {
    expect(rgbToHex(hexToRgb('#1d2b53'))).toBe('#1d2b53');
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
  });
  it('round-trips OKLab', () => {
    const lab = rgbToOklab(123, 45, 210);
    expect(oklabToRgb(...lab)).toEqual([123, 45, 210]);
  });
});

describe('quantize', () => {
  it('extracts at most N colors', () => {
    const img = createImage(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) setPixel(img, x, y, [x * 8, y * 8, 128, 255]);
    const pal = extractPalette(img, 8);
    expect(pal.length).toBeLessThanOrEqual(8);
    const { image } = reduceColors(img, 8);
    expect(countColors(image)).toBeLessThanOrEqual(8);
  });
  it('maps to a fixed palette with every dither mode', () => {
    const img = createImage(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setPixel(img, x, y, [x * 16, x * 16, x * 16, 255]);
    const pal = [hexToRgb('#000000'), hexToRgb('#ffffff')];
    for (const dither of ['none', 'floyd-steinberg', 'atkinson', 'bayer2', 'bayer4', 'bayer8'] as const) {
      const out = applyPalette(img, pal, { dither });
      expect(countColors(out)).toBeLessThanOrEqual(2);
    }
    // Dithering should mix both colors in the middle gradient.
    const fs = applyPalette(img, pal, { dither: 'floyd-steinberg' });
    expect(countColors(fs)).toBe(2);
  });
  it('keeps transparent pixels transparent', () => {
    const img = createImage(4, 4);
    setPixel(img, 1, 1, [200, 10, 10, 255]);
    const out = applyPalette(img, [hexToRgb('#ff0000')]);
    expect(getPixel(out, 0, 0)[3]).toBe(0);
    expect(getPixel(out, 1, 1)).toEqual([255, 0, 0, 255]);
  });
});

describe('resize', () => {
  it('upscales and downscales losslessly with nearest neighbour', () => {
    const src = logicalSprite();
    const big = upscaleInteger(src, 8);
    expect(big.width).toBe(128);
    const back = resizeNearest(big, 16, 16);
    expect(back.data).toEqual(src.data);
  });
});

describe('pixelize', () => {
  it('detects the pseudo pixel grid of an upscaled sprite', () => {
    const big = upscaleInteger(logicalSprite(), 8);
    const g = detectPixelGrid(big);
    expect(g.scaleX).toBeCloseTo(8, 0);
    expect(g.scaleY).toBeCloseTo(8, 0);
  });
  it('recovers the logical sprite from a noisy upscale', () => {
    const src = logicalSprite();
    const big = upscaleInteger(src, 8);
    // add "AI noise": blur-ish border pixels
    for (let i = 0; i < big.data.length; i += 4 * 37) big.data[i] = Math.min(255, big.data[i] + 9);
    const out = pixelize(big, { width: 16, height: 16 });
    expect(out.width).toBe(16);
    let same = 0;
    for (let i = 0; i < src.data.length; i += 4) if (Math.abs(out.data[i] - src.data[i]) < 12 && out.data[i + 1] === src.data[i + 1]) same++;
    expect(same).toBe(256);
  });
  it('auto-detects grid when no size is given', () => {
    const big = upscaleInteger(logicalSprite(), 6);
    const out = pixelize(big);
    expect(out.width).toBe(16);
    expect(out.height).toBe(16);
  });
});

describe('background', () => {
  it('removes a flat background but keeps the subject', () => {
    const img = createImage(10, 10, [255, 0, 255, 255]);
    for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) setPixel(img, x, y, [10, 10, 10, 255]);
    const out = removeBackgroundFlood(img);
    expect(getPixel(out, 0, 0)[3]).toBe(0);
    expect(getPixel(out, 5, 5)[3]).toBe(255);
    expect(contentBounds(out)).toEqual({ x: 3, y: 3, w: 4, h: 4 });
  });
  it('hardens alpha', () => {
    const img = createImage(2, 1);
    setPixel(img, 0, 0, [1, 2, 3, 100]);
    setPixel(img, 1, 0, [1, 2, 3, 200]);
    const out = hardenAlpha(img);
    expect(getPixel(out, 0, 0)[3]).toBe(0);
    expect(getPixel(out, 1, 0)[3]).toBe(255);
  });
});

describe('outline & cleanup', () => {
  it('removes orphans and adds outline', () => {
    const img = createImage(8, 8);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) setPixel(img, x, y, [200, 200, 0, 255]);
    setPixel(img, 0, 7, [255, 255, 255, 255]);
    const clean = removeOrphans(img);
    expect(getPixel(clean, 0, 7)[3]).toBe(0);
    const outlined = addOutline(clean, { color: [0, 0, 0, 255] });
    expect(outlined.width).toBe(10);
    expect(getPixel(outlined, 2, 3)).toEqual([0, 0, 0, 255]);
  });
  it('fills pinholes', () => {
    const img = createImage(3, 3, [9, 9, 9, 255]);
    setPixel(img, 1, 1, [0, 0, 0, 0]);
    expect(getPixel(fillPinholes(img), 1, 1)[3]).toBe(255);
  });
});

describe('spritesheet', () => {
  it('slices, aligns and packs', () => {
    const frames: RGBAImage[] = [];
    for (let i = 0; i < 4; i++) {
      const f = createImage(16, 16);
      for (let y = 8 - i; y < 16; y++) for (let x = 4; x < 12; x++) setPixel(f, x, y, [i * 50, 100, 100, 255]);
      frames.push(f);
    }
    const sheet = packSheet(frames, { columns: 4 });
    expect(sheet.image.width).toBe(64);
    expect(sheet.frames).toHaveLength(4);
    const sliced = sliceGrid(sheet.image, { frameWidth: 16, frameHeight: 16 });
    expect(sliced.images).toHaveLength(4);
    const auto = autoSlice(sheet.image);
    expect(auto.frames).toHaveLength(4);
    const aligned = alignFrames(auto.images, { mode: 'bottom' });
    expect(new Set(aligned.map((a) => `${a.width}x${a.height}`)).size).toBe(1);
    // bottoms aligned
    for (const a of aligned) expect(getPixel(a, Math.floor(a.width / 2), a.height - 1)[3]).toBe(255);
  });
  it('shelf-packs non-uniform frames', () => {
    const res = packSheet([createImage(10, 4, [1, 1, 1, 255]), createImage(3, 9, [1, 1, 1, 255]), createImage(5, 5, [1, 1, 1, 255])]);
    expect(res.frames).toHaveLength(3);
    for (const f of res.frames) {
      expect(f.rect.x + f.rect.w).toBeLessThanOrEqual(res.image.width);
      expect(f.rect.y + f.rect.h).toBeLessThanOrEqual(res.image.height);
    }
  });
});

describe('recolor & tiles', () => {
  it('palette swaps preserving structure', () => {
    const img = checker(8, 8, 2, [10, 10, 10, 255], [240, 240, 240, 255]);
    const out = paletteSwap(img, ['#200000', '#ff8080']);
    expect(getPixel(out, 0, 0).slice(0, 3)).toEqual([255, 128, 128]);
    expect(getPixel(out, 2, 0).slice(0, 3)).toEqual([32, 0, 0]);
  });
  it('hsl and replace', () => {
    const img = createImage(1, 1, [255, 0, 0, 255]);
    expect(getPixel(adjustHsl(img, { hue: 120 }), 0, 0).slice(0, 3)).toEqual([0, 255, 0]);
    expect(getPixel(replaceColors(img, { '#ff0000': '#0000ff' }), 0, 0).slice(0, 3)).toEqual([0, 0, 255]);
  });
  it('makes a texture more seamless', () => {
    const img = createImage(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) setPixel(img, x, y, [x * 8, y * 8, 0, 255]);
    expect(seamScore(makeSeamless(img))).toBeLessThan(seamScore(img));
  });
});

describe('pipeline', () => {
  it('runs a typical AI-cleanup pipeline', () => {
    const big = upscaleInteger(logicalSprite(), 8);
    const out = runPipeline(cloneImage(big), [
      { op: 'pixelize', width: 16, height: 16 },
      { op: 'applyPalette', presetId: 'pico-8' },
      { op: 'removeOrphans' },
      { op: 'trim' },
    ]);
    expect(out.width).toBeLessThanOrEqual(16);
    expect(countColors(out)).toBeLessThanOrEqual(16);
  });
  it('documents every op and has presets', () => {
    expect(PROCESS_OPS.length).toBeGreaterThan(15);
    expect(PALETTE_PRESETS.find((p) => p.id === 'pico-8')!.colors).toHaveLength(16);
    expect(trim(createImage(4, 4)).width).toBe(1);
  });
});

describe('key-color shadows (real AI output case)', () => {
  it('removes a darker key-tinted drop shadow and background enclosed between legs', async () => {
    const { removeBackgroundFlood, removeKeyColorRegions, estimateBackgroundColor } = await import('../src/index.js');
    const bg: RGBA = [183, 23, 178, 255];        // what the model actually painted
    const shadow: RGBA = [120, 10, 118, 255];    // darker magenta shadow
    const body: RGBA = [60, 50, 110, 255];       // desaturated purple subject (must survive)
    const img = createImage(20, 20, bg);
    for (let y = 2; y < 14; y++) for (let x = 6; x < 14; x++) setPixel(img, x, y, body);
    for (let y = 14; y < 17; y++) { setPixel(img, 6, y, body); setPixel(img, 7, y, body); setPixel(img, 12, y, body); setPixel(img, 13, y, body); }
    for (let x = 4; x < 16; x++) setPixel(img, x, 17, shadow); // shadow closes the gap between legs
    const key = estimateBackgroundColor(img);
    expect(key).toEqual([183, 23, 178]);
    const flood = removeBackgroundFlood(img, { tolerance: 16 });
    expect(getPixel(flood, 10, 15)[3]).toBe(255); // enclosed gap survives a plain flood…
    const out = removeKeyColorRegions(flood, { key });
    expect(getPixel(out, 10, 17)[3]).toBe(0);     // …shadow removed
    expect(getPixel(out, 10, 15)[3]).toBe(0);     // gap between legs removed
    expect(getPixel(out, 8, 8)[3]).toBe(255);     // subject intact
    expect(getPixel(out, 6, 16)[3]).toBe(255);
  });
});
