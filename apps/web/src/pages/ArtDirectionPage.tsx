import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { extractPalette, paletteToHex } from '@sprixy/core';
import { put, type ArtDirection } from '../api';
import { useLoras, useMeta, useProject } from '../hooks';
import { Field, Icon, Spinner, Swatches, useToast } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { AssetPicker } from '../components/AssetPicker';

/** Read an image file into ImageData-like RGBA in the browser. */
async function fileToRgba(file: File) {
  const bmp = await createImageBitmap(file);
  const max = 256;
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

/** Parse Lospec-style palette files: .hex (one color per line), .gpl (GIMP), .txt (Paint.NET). */
function parsePaletteFile(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith(';')) continue;
    const gpl = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(t);
    if (gpl) { out.push('#' + [gpl[1], gpl[2], gpl[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')); continue; }
    const hex = /^#?(?:ff)?([0-9a-f]{6})$/i.exec(t);
    if (hex) out.push(`#${hex[1].toLowerCase()}`);
  }
  return [...new Set(out)].slice(0, 256);
}

const OPTIONS = {
  perspective: [['side', 'Side view (platformer)'], ['top-down', 'Top-down'], ['three-quarter', '3/4 view (JRPG)'], ['isometric', 'Isometric'], ['front', 'Front view']],
  lighting: [['flat', 'Flat'], ['top-left', 'Top-left light'], ['top-right', 'Top-right light'], ['top', 'From above'], ['rim', 'Rim light'], ['dramatic', 'Dramatic'], ['ambient', 'Soft ambient']],
  shading: [['flat', 'Flat colors'], ['cel', 'Cel (2–3 tones)'], ['soft', 'Soft hand-shaded'], ['dithered', 'Dithered']],
  detail: [['minimal', 'Minimal'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']],
  outline: [['none', 'No outline'], ['black', 'Black 1px'], ['dark-colored', 'Darker shade 1px'], ['selective', 'Selective (sel-out)']],
  dither: [['none', 'None'], ['floyd-steinberg', 'Floyd–Steinberg'], ['atkinson', 'Atkinson'], ['bayer2', 'Bayer 2×2'], ['bayer4', 'Bayer 4×4'], ['bayer8', 'Bayer 8×8']],
} as const;

export function ArtDirectionPage() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const meta = useMeta();
  const loras = useLoras(projectId);
  const qc = useQueryClient();
  const toast = useToast();
  const [ad, setAd] = useState<ArtDirection | null>(null);
  const [dirty, setDirty] = useState(false);
  const [picking, setPicking] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const palRef = useRef<HTMLInputElement>(null);
  const [extractN, setExtractN] = useState(16);

  useEffect(() => { if (project.data && !dirty) setAd(project.data.artDirection); }, [project.data, dirty]);

  const save = useMutation({
    mutationFn: () => put(`/api/v1/projects/${projectId}/art-direction`, ad),
    onSuccess: () => { setDirty(false); toast('success', 'Art direction saved — new assets will follow it'); void qc.invalidateQueries({ queryKey: ['project', projectId] }); void qc.invalidateQueries({ queryKey: ['projects'] }); },
    onError: (e) => toast('error', (e as Error).message),
  });

  if (!ad) return <div className="page"><Spinner /></div>;
  const set = (patch: Partial<ArtDirection>) => { setAd({ ...ad, ...patch }); setDirty(true); };
  const setPal = (patch: Partial<ArtDirection['palette']>) => set({ palette: { ...ad.palette, ...patch } });
  const preset = meta.data?.palettes.find((p) => p.id === ad.palette.presetId);
  const colors = ad.palette.colors.length ? ad.palette.colors : preset?.colors ?? [];
  const sel = (k: keyof typeof OPTIONS) => (
    <select className="select" value={String(ad[k])} onChange={(e) => set({ [k]: e.target.value } as Partial<ArtDirection>)}>
      {OPTIONS[k].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const size = (k: 'spriteSize' | 'iconSize' | 'sceneSize', label: string) => (
    <Field label={label}>
      <div className="row" style={{ gap: 6 }}>
        <input className="input mono" type="number" min={4} max={1024} value={ad[k].width} onChange={(e) => set({ [k]: { ...ad[k], width: Number(e.target.value) } } as Partial<ArtDirection>)} />
        <span className="muted">×</span>
        <input className="input mono" type="number" min={4} max={1024} value={ad[k].height} onChange={(e) => set({ [k]: { ...ad[k], height: Number(e.target.value) } } as Partial<ArtDirection>)} />
      </div>
    </Field>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Art direction</h1>
          <p>Applied automatically to every generation, variant and animation of this project.</p>
        </div>
        <div className="row">
          {dirty && <span className="chip accent">unsaved</span>}
          <button className="btn" disabled={!dirty} onClick={() => { setDirty(false); setAd(project.data!.artDirection); }}>Revert</button>
          <button className="btn primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Icon name="check" /> Save</button>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="col" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panel-head"><h2>Palette</h2><span className="mono small muted">{colors.length || 'auto'} colors</span></div>
            <div className="panel-body">
              <Field label="Preset">
                <select className="select" value={ad.palette.colors.length ? '__custom' : ad.palette.presetId ?? ''} onChange={(e) => {
                  if (e.target.value === '__custom') setPal({ colors: colors.length ? colors : ['#000000', '#ffffff'] });
                  else setPal({ presetId: e.target.value || undefined, colors: [] });
                }}>
                  <option value="">None — automatic reduction</option>
                  <option value="__custom">Custom palette</option>
                  {meta.data?.palettes.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.colors.length}) — {p.author}</option>)}
                </select>
              </Field>
              {colors.length > 0 ? (
                <div className="swatches" style={{ gap: 3 }}>
                  {colors.map((c, i) => (
                    <label key={`${c}${i}`} className="swatch lg" style={{ background: c, cursor: 'pointer', position: 'relative' }} title={`${c} — click to edit, right-click to remove`}
                      onContextMenu={(e) => { e.preventDefault(); setPal({ colors: colors.filter((_, j) => j !== i) }); }}>
                      <input type="color" value={c} style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%' }} onChange={(e) => setPal({ colors: colors.map((x, j) => (j === i ? e.target.value : x)) })} />
                    </label>
                  ))}
                  <button className="swatch lg add" onClick={() => setPal({ colors: [...colors, '#808080'] })} title="Add color">+</button>
                </div>
              ) : <div className="small muted">Each asset is reduced to at most {ad.palette.maxColors} colors.</div>}
              <div className="row wrap">
                <button className="btn sm" onClick={() => imgRef.current?.click()}><Icon name="palette" size={14} /> Extract from image</button>
                <input className="input mono" style={{ width: 56, height: 26 }} type="number" min={2} max={64} value={extractN} onChange={(e) => setExtractN(Number(e.target.value))} title="Colors to extract" />
                <button className="btn sm" onClick={() => palRef.current?.click()}>Import .hex / .gpl</button>
                {colors.length > 0 && <button className="btn ghost sm" onClick={() => void navigator.clipboard.writeText(colors.join('\n')).then(() => toast('success', 'Palette copied (.hex)'))}>Copy</button>}
                <input ref={imgRef} type="file" accept="image/*" hidden onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const rgba = await fileToRgba(f);
                  setPal({ colors: paletteToHex(extractPalette(rgba, extractN)), presetId: undefined });
                  e.target.value = '';
                }} />
                <input ref={palRef} type="file" accept=".hex,.gpl,.txt" hidden onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const list = parsePaletteFile(await f.text());
                  if (list.length) setPal({ colors: list, presetId: undefined });
                  else toast('error', 'No color found in this file');
                  e.target.value = '';
                }} />
              </div>
              <div className="grid-2">
                <label className="check"><input type="checkbox" checked={ad.palette.enforce} onChange={(e) => setPal({ enforce: e.target.checked })} /> Enforce on every asset</label>
                <Field label="Max colors when automatic"><input className="input mono" type="number" min={2} max={256} value={ad.palette.maxColors} onChange={(e) => setPal({ maxColors: Number(e.target.value) })} /></Field>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Resolution</h2></div>
            <div className="panel-body">
              <div className="grid-2">
                {size('spriteSize', 'Sprites & characters')}
                {size('iconSize', 'Icons')}
                {size('sceneSize', 'Environments')}
                <Field label="Tile size"><input className="input mono" type="number" min={4} max={256} value={ad.tileSize} onChange={(e) => set({ tileSize: Number(e.target.value) })} /></Field>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Reference images</h2></div>
            <div className="panel-body">
              <p className="small muted">Up to 4 assets used as style references by edit-capable models (FLUX.2 klein, Gemini…).</p>
              <div className="row wrap">
                {ad.referenceAssetIds.map((id) => (
                  <div key={id} className="checker" style={{ width: 64, height: 64, display: 'grid', placeItems: 'center', borderRadius: 3, border: '1px solid var(--line)' }}>
                    <img className="px" src={`/api/v1/assets/${id}/file`} alt="" style={{ maxWidth: '90%', maxHeight: '90%' }} />
                  </div>
                ))}
                <button className="btn sm" onClick={() => setPicking(true)}>{ad.referenceAssetIds.length ? 'Change' : 'Pick from library'}</button>
              </div>
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panel-head"><h2>Look & feel</h2></div>
            <div className="panel-body">
              <div className="grid-2">
                <Field label="Perspective">{sel('perspective')}</Field>
                <Field label="Lighting">{sel('lighting')}</Field>
                <Field label="Shading">{sel('shading')}</Field>
                <Field label="Level of detail">{sel('detail')}</Field>
                <Field label="Outline style">{sel('outline')}</Field>
                <Field label="Dithering (post-process)">{sel('dither')}</Field>
              </div>
              <Field label="Style notes" hint="Free text appended to every prompt, e.g. 'inspired by 16-bit SNES RPGs, warm earthy tones'.">
                <textarea className="textarea" value={ad.styleNotes} onChange={(e) => set({ styleNotes: e.target.value })} />
              </Field>
              <Field label="Negative prompt" hint="Used by models that support it (video).">
                <input className="input" value={ad.negativePrompt} onChange={(e) => set({ negativePrompt: e.target.value })} />
              </Field>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Preferred models</h2></div>
            <div className="panel-body">
              <Field label="Image generation"><ModelPicker capability="txt2img" value={ad.models.image} onChange={(v) => set({ models: { ...ad.models, image: v } })} /></Field>
              <Field label="Edits, variants & directions"><ModelPicker capability="edit" alsoCapability="img2img" value={ad.models.edit} onChange={(v) => set({ models: { ...ad.models, edit: v } })} /></Field>
              <Field label="Animation"><ModelPicker capability="animate" value={ad.models.animate} onChange={(v) => set({ models: { ...ad.models, animate: v } })} /></Field>
              <Field label="AI background removal"><ModelPicker capability="removeBg" value={ad.models.removeBg} onChange={(v) => set({ models: { ...ad.models, removeBg: v } })} /></Field>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Project LoRAs</h2></div>
            <div className="panel-body">
              <p className="small muted">Applied by default to generations with a compatible model (LoRA families must match).</p>
              {ad.loras.map((l, i) => {
                const info = loras.data?.items.find((x) => x.id === l.loraId);
                return (
                  <div key={l.loraId} className="step-item">
                    <span className="grow">{info?.name ?? l.loraId} <span className="chip">{info?.family}</span></span>
                    <input type="range" min={0} max={2} step={0.05} style={{ width: 110 }} value={l.scale} onChange={(e) => set({ loras: ad.loras.map((x, j) => (j === i ? { ...x, scale: Number(e.target.value) } : x)) })} />
                    <span className="mono small">{l.scale.toFixed(2)}</span>
                    <button className="btn ghost sm icon" onClick={() => set({ loras: ad.loras.filter((_, j) => j !== i) })}><Icon name="x" size={13} /></button>
                  </div>
                );
              })}
              {ad.loras.length < 3 && (
                <select className="select" value="" onChange={(e) => { const l = loras.data?.items.find((x) => x.id === e.target.value); if (l) set({ loras: [...ad.loras, { loraId: l.id, scale: l.defaultScale }] }); }}>
                  <option value="">+ Add a LoRA</option>
                  {loras.data?.items.filter((l) => !ad.loras.some((a) => a.loraId === l.id)).map((l) => <option key={l.id} value={l.id}>{l.name} · {l.family} · {l.source}</option>)}
                </select>
              )}
            </div>
          </div>
          {project.data!.effectivePalette.length > 0 && <Swatches colors={project.data!.effectivePalette} size="sm" />}
        </div>
      </div>
      {picking && <AssetPicker projectId={projectId!} initial={ad.referenceAssetIds} onClose={() => setPicking(false)} onPick={(ids) => set({ referenceAssetIds: ids })} />}
    </div>
  );
}
