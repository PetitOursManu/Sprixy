import { useEffect, useRef, useState } from 'react';
import type { Frame } from '../api';
import { Icon } from './ui';

/** Plays frames of a spritesheet image with nearest-neighbour scaling. */
export function AnimationPlayer({ src, frames, fps: initialFps = 10, zoom }: { src: string; frames: Frame[]; fps?: number; zoom: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const [index, setIndex] = useState(0);
  const [fps, setFps] = useState(initialFps);
  const fw = Math.max(...frames.map((f) => f.rect.w));
  const fh = Math.max(...frames.map((f) => f.rect.h));

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);

  useEffect(() => {
    if (!playing) return;
    const f = frames[index];
    const t = setTimeout(() => setIndex((i) => (i + 1) % frames.length), f?.duration && fps === initialFps ? f.duration : 1000 / fps);
    return () => clearTimeout(t);
  }, [playing, index, frames, fps, initialFps]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    const f = frames[index % frames.length];
    ctx.drawImage(img, f.rect.x, f.rect.y, f.rect.w, f.rect.h, Math.floor((fw - f.rect.w) / 2) * zoom, (fh - f.rect.h) * zoom, f.rect.w * zoom, f.rect.h * zoom);
  }, [img, index, frames, zoom, fw, fh]);

  return (
    <div className="col" style={{ alignItems: 'center', gap: 10 }}>
      <canvas ref={canvas} width={fw * zoom} height={fh * zoom} className="px" />
      <div className="row" style={{ background: 'var(--bg-1)', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--line)' }}>
        <button className="btn ghost sm icon" onClick={() => setPlaying(!playing)}><Icon name={playing ? 'pause' : 'play'} size={14} /></button>
        <button className="btn ghost sm" onClick={() => { setPlaying(false); setIndex((i) => (i - 1 + frames.length) % frames.length); }}>‹</button>
        <span className="mono small" style={{ width: 52, textAlign: 'center' }}>{(index % frames.length) + 1}/{frames.length}</span>
        <button className="btn ghost sm" onClick={() => { setPlaying(false); setIndex((i) => (i + 1) % frames.length); }}>›</button>
        <input type="range" min={1} max={30} value={fps} onChange={(e) => setFps(Number(e.target.value))} style={{ width: 90 }} />
        <span className="mono small muted">{fps} fps</span>
      </div>
    </div>
  );
}
