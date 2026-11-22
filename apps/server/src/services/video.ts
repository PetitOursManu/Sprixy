import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from '../config.js';
import { decodeImage } from '../lib/images.js';
import type { RGBAImage } from '@sprixy/core';

let resolved: string | null = null;

/** ffmpeg binary: FFMPEG_PATH, then the bundled ffmpeg-static binary, then `ffmpeg` on PATH. */
export function ffmpegPath(): string {
  if (resolved) return resolved;
  if (config.ffmpegPath) return (resolved = config.ffmpegPath);
  try {
    const req = createRequire(import.meta.url);
    const p = req('ffmpeg-static') as string | null;
    if (p) return (resolved = p);
  } catch { /* optional */ }
  return (resolved = 'ffmpeg');
}

function run(bin: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => { err += String(d); if (err.length > 8000) err = err.slice(-8000); });
    proc.on('error', (e) => reject(new Error(`ffmpeg not available (${e.message}). Install ffmpeg or set FFMPEG_PATH.`)));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${err.slice(-500)}`))));
    signal?.addEventListener('abort', () => proc.kill('SIGKILL'), { once: true });
  });
}

/**
 * Extract `count` evenly spaced frames from a video. Returns decoded RGBA frames.
 * Frames are sampled at `sampleFps` first (cheap), then sub-sampled.
 */
export async function extractFrames(video: Buffer, count: number, opts: { sampleFps?: number; signal?: AbortSignal; skipStart?: number } = {}): Promise<RGBAImage[]> {
  const dir = await mkdtemp(path.join(config.tmpDir, 'vid-'));
  try {
    const input = path.join(dir, 'in.mp4');
    await writeFile(input, video);
    await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', input, '-vf', `fps=${opts.sampleFps ?? 16}`, path.join(dir, 'f_%05d.png')], opts.signal);
    const files = (await readdir(dir)).filter((f) => f.startsWith('f_')).sort();
    if (!files.length) throw new Error('No frames could be extracted from the video');
    const start = Math.min(files.length - 1, opts.skipStart ?? 0);
    const usable = files.slice(start);
    const n = Math.max(1, Math.min(count, usable.length));
    const picked: string[] = [];
    for (let i = 0; i < n; i++) picked.push(usable[Math.floor((i * usable.length) / n)]);
    return Promise.all(picked.map(async (f) => decodeImage(await readFile(path.join(dir, f)))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
