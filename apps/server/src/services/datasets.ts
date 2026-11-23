import { zipSync } from 'fflate';
import { upscaleInteger } from '@sprixy/core';
import { decodeImage, encodePng, flattenOnColor } from '../lib/images.js';
import { readStored } from '../lib/storage.js';

export interface DatasetImageRow {
  file: string;
  caption: string;
}

export interface TrainingFilesOptions {
  defaultCaption: string;
  triggerWord?: string;
  /** Target long side after nearest-neighbour upscaling (trainers expect ~1024px). */
  longSide?: number;
  background?: [number, number, number];
}

/**
 * Build the universal "image + same-name .txt caption" layout accepted by fal trainers, ostris/ai-toolkit,
 * kohya-ss, OneTrainer, SimpleTuner and most hosted trainers. Pixel art is upscaled with nearest neighbour so
 * the trainer sees crisp pixels, and transparency is flattened (trainers don't use alpha).
 */
export async function buildTrainingFiles(images: DatasetImageRow[], opts: TrainingFilesOptions) {
  const files: Record<string, Uint8Array> = {};
  const captions: { file_name: string; text: string }[] = [];
  for (const [i, im] of images.entries()) {
    const name = `img_${String(i + 1).padStart(3, '0')}`;
    const decoded = await decodeImage(await readStored(im.file));
    const k = Math.max(1, Math.floor((opts.longSide ?? 1024) / Math.max(decoded.width, decoded.height)));
    files[`${name}.png`] = new Uint8Array(await encodePng(flattenOnColor(upscaleInteger(decoded, k), opts.background ?? [255, 255, 255])));
    const base = im.caption || opts.defaultCaption;
    const text = opts.triggerWord && !base.includes(opts.triggerWord) ? `${opts.triggerWord}, ${base}` : base;
    files[`${name}.txt`] = new TextEncoder().encode(text);
    captions.push({ file_name: `${name}.png`, text });
  }
  return { files, captions };
}

export async function buildTrainingZip(images: DatasetImageRow[], opts: TrainingFilesOptions): Promise<Buffer> {
  const { files } = await buildTrainingFiles(images, opts);
  return Buffer.from(zipSync(files, { level: 6 }));
}

/** Dataset export for training anywhere (own GPU, Kaggle, Colab, RunPod, Civitai…). */
export async function buildExternalTrainingExport(name: string, images: DatasetImageRow[], opts: TrainingFilesOptions): Promise<Buffer> {
  const { files, captions } = await buildTrainingFiles(images, opts);
  const out: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) out[`dataset/${k}`] = v;
  // Hugging Face "imagefolder" metadata (used by diffusers training scripts).
  out['dataset/metadata.jsonl'] = new TextEncoder().encode(captions.map((c) => JSON.stringify(c)).join('\n') + '\n');
  out['sprixy-dataset.json'] = new TextEncoder().encode(JSON.stringify({ name, images: images.length, triggerWord: opts.triggerWord ?? null, defaultCaption: opts.defaultCaption, exportedAt: new Date().toISOString() }, null, 2));
  out['README.md'] = new TextEncoder().encode(readme(name, images.length, opts.triggerWord));
  return Buffer.from(zipSync(out, { level: 6 }));
}

function readme(name: string, count: number, trigger?: string): string {
  return `# ${name} — LoRA training dataset (exported by Sprixy)

${count} images in \`dataset/\`, each with a same-name \`.txt\` caption${trigger ? ` starting with the trigger word **${trigger}**` : ''}.
Pixel art was upscaled with nearest-neighbour (~1024 px long side) and flattened on white.
\`dataset/metadata.jsonl\` holds the same captions in Hugging Face *imagefolder* format.

This layout is accepted as-is by most trainers:

| Trainer | Where | Notes |
| --- | --- | --- |
| ostris **ai-toolkit** | your GPU, RunPod, Kaggle | Point \`folder_path\` to \`dataset/\` in one of its example configs for the base model you use. |
| **kohya-ss** sd-scripts / **OneTrainer** | your GPU | Image + .txt caption pairs are the native format. |
| **fal.ai** trainers | cloud (pay per step) | Zip the \`dataset/\` folder — or simply use "Train a LoRA" in Sprixy. |
| **Civitai** on-site trainer | cloud | Upload the zip of \`dataset/\`. |

Free GPU time exists (e.g. Kaggle notebooks), but recent base models (FLUX.2 klein, Z-Image Turbo) need a
GPU with roughly 16–24 GB of VRAM for LoRA training — check the trainer's documentation for your model.

**Train for the same base model you generate with.** Then import the resulting \`.safetensors\` in Sprixy:
LoRAs → Import LoRA → choose the matching family (z-image, flux2-klein-4b, flux2-klein-9b, flux1) and paste an
https URL to the file (e.g. a Hugging Face \`resolve/main/…safetensors\` link).
`;
}
