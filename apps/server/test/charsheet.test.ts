import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SPRIXY_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'sprixy-charsheet-'));
process.env.SPRIXY_MASTER_KEY = Buffer.alloc(32, 9).toString('base64');

describe('character sheet method', async () => {
  const { createImage, setPixel, getPixel, contentBounds } = await import('@sprixy/core');
  const { CHARSHEET, charSheetPrompt, sliceCharacterSheet } = await import('../src/services/jobs.js');
  const { FAL_MODELS, PRESET_LORAS, SPRITESHEET_LORA_ID } = await import('../src/providers/catalog.js');

  it('uses the LoRA training wording and a compatible model + preset', () => {
    const p = charSheetPrompt();
    expect(p).toContain('6 by 4 grid');
    expect(p).toContain('Fourth row is 3 walking frames back view facing up');
    const model = FAL_MODELS.find((m) => m.id === CHARSHEET.modelId)!;
    const lora = PRESET_LORAS.find((l) => l.id === SPRITESHEET_LORA_ID)!;
    expect(model.loraFamily).toBe(lora.family);
    expect(model.editLoraEndpoint).toBe('fal-ai/qwen-image-edit-2511/lora');
  });

  it('slices a 768×768 6×4 sheet into 24 aligned 32×48 frames', () => {
    // Fake model output: flat background, one 4×-scaled figure per cell, a distinct color per row.
    const sheet = createImage(768, 768, [255, 0, 255, 255]);
    const rowColors: [number, number, number, number][] = [[200, 40, 40, 255], [40, 200, 40, 255], [40, 40, 200, 255], [220, 200, 60, 255]];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      const x0 = c * 128 + 40, y0 = r * 192 + 40 + c * 4; // figures bob slightly between frames
      for (let y = y0; y < y0 + 112; y++) for (let x = x0; x < x0 + 48; x++) setPixel(sheet, x, y, rowColors[r]);
    }
    const frames = sliceCharacterSheet(sheet, (f) => f);
    expect(frames).toHaveLength(24);
    for (const f of frames) { expect(f.width).toBe(32); expect(f.height).toBe(48); }
    // Background removed, row colors kept, vertical offsets preserved (grid slicing, no re-alignment).
    expect(getPixel(frames[0], 0, 0)[3]).toBe(0);
    expect(getPixel(frames[6], 16, 24).slice(0, 3)).toEqual([40, 200, 40]);
    expect(contentBounds(frames[5])!.y).toBeGreaterThan(contentBounds(frames[0])!.y);
  });
});
