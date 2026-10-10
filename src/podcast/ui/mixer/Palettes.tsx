// Switcher palettes (like ATEM Software Control's side panel): inputs, SuperSource (free split screens),
// upstream key, downstream keys, transition, media, audio and multiview settings.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWindowSize } from '../../../utils/useWindowSize';
import {
  usePod, allInputsOf, inputsOf, addPodcastFiles, removeCamera, addBroll, syncOnly, analyze, cancelAnalysis, addSplit, updateSplit, applySplitPreset, updateBox, addBox, removeBox, removeSplit, editBoxesOf, bringBoxToFront, removeSplitKey, setSoundSettings, setAudioIn, type AudioMode,
} from '../../store';
import { setKey, setDsk, setLabel, addMedia, setMp, removeMedia, pipCorner, useSS, activeSS } from '../../mixer';
import { drawInputTo, frameListeners, seek } from '../../player';
import { shortName, longName } from '../../labels';
import { SPLIT_PRESETS, presetRects, noCrop, defaultSSAnim, type BoxBorder, type SSAnim, type SSIntro, type SplitLayout, type WipePattern, type SSBox } from '../../types';
import { Checkbox, Section, Segmented, Slider } from '../../../components/ui/controls';
import { LuPlus, LuX, LuImagePlus, LuRefreshCw, LuArrowUpToLine, LuRatio, LuVideo, LuImages, LuPackage, LuSave, LuMaximize2, LuLightbulb } from 'react-icons/lu';
import { downloadEditPackage, saveEdit } from '../../exports';
import { FormatBox } from '../FormatBox';
import { presetToCustom, customOf, useMvEdit } from './Multiview';
import { RENDER_FORMATS, type RenderFormat } from '../../ffmpeg';

function pick(accept: string, multiple = false): Promise<File[]> {
  return new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple; i.onchange = () => res([...(i.files ?? [])]); i.click(); });
}
const VIDEO = 'video/*,.mov,.mkv,.mts,.m2ts,.avi,.wmv,.flv,.3gp,.mxf,.mpg,.mpeg,.vob,.ts,.webm,.mp4';
const AUDIO = 'audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.wma,.ac3,.amr,.aif,.aiff';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex items-center gap-2 text-xs"><span className="text-muted w-[92px] shrink-0">{label}</span><div className="flex-1 min-w-0 flex items-center gap-1.5">{children}</div></label>;
}
function SourceSelect({ value, onChange, label, allowNone }: { value: string | null; onChange: (v: string | null) => void; label: string; allowNone?: boolean }) {
  const opts = usePod((s) => allInputsOf(s));
  usePod((s) => s.labels);
  return (
    <select className="field h-[24px] text-xs w-full min-w-0" value={value ?? ''} aria-label={label} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">—</option>}
      {opts.map((o) => <option key={o} value={o}>{`${shortName(o)} · ${longName(o)}`}</option>)}
    </select>
  );
}
const Color = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
  <input type="color" className="w-8 h-[22px] rounded-[4px] border border-line bg-transparent p-0 cursor-pointer" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} />
);
const stop = (e: React.KeyboardEvent) => e.stopPropagation();

// ---------- inputs ----------
function InputsBox() {
  const cams = usePod((s) => s.cameras);
  const ids = usePod((s) => allInputsOf(s));
  const nRec = usePod((s) => inputsOf(s).length);
  const labels = usePod((s) => s.labels);
  const phase = usePod((s) => s.phase);
  const progress = usePod((s) => s.progress);
  const busy = phase === 'decoding' || phase === 'syncing' || phase === 'speakers' || phase === 'checking';
  usePod((s) => s.splits); usePod((s) => s.broll);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <button type="button" className="btn btn-primary flex-1 h-[28px] text-xs inline-flex items-center justify-center gap-1.5" onClick={async () => { await addPodcastFiles(await pick(`${VIDEO},${AUDIO},image/*,.avif,.bmp`, true)); }} data-tip="Videos become cameras, sound files become the people's microphones, pictures become still inputs. Files the browser can't play are converted."><LuVideo size={13} />Add cameras / files</button>
        <button type="button" className="btn h-[28px] text-xs inline-flex items-center justify-center gap-1.5 px-2" onClick={async () => { const fs = await pick(VIDEO, true); if (fs.length) void addBroll(fs); }}><LuImages size={13} />B-roll</button>
      </div>
      {cams.length >= 2 && (busy ? (
        <div className="flex items-center gap-2 text-2xs text-muted" role="status"><div className="flex-1 h-1.5 rounded-full bg-[#1a1d21] overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} /></div><button type="button" className="btn h-[22px] text-2xs" onClick={cancelAnalysis}>Cancel</button></div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <button type="button" className="btn h-[26px] text-xs inline-flex items-center justify-center gap-1.5" onClick={() => void syncOnly()} data-tip="Lines the cameras up in time using their sound (same as the Podcast workspace)"><LuRefreshCw size={13} />Sync cameras by sound</button>
          <button type="button" className="btn h-[26px] text-xs inline-flex items-center justify-center gap-1.5" onClick={() => void analyze({ keepEdit: true })} data-tip="Syncs the cameras and finds who speaks when — then the timeline shows editing tips and the multiview suggests the camera to take. Your cuts are kept."><LuLightbulb size={13} />Find who speaks (tips)</button>
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <div className="flex gap-1.5 text-2xs text-faint px-0.5"><span className="w-[22px]">#</span><span className="w-[64px]">Button</span><span className="flex-1">Name</span></div>
        {ids.map((id, i) => (
          <div key={id} className={`flex items-center gap-1.5 ${i === nRec ? 'mt-1.5 pt-1.5 border-t border-line-soft' : ''}`}>
            <span className="w-[22px] text-2xs text-faint num">{i < nRec ? i + 1 : ''}</span>
            <input className="field h-[22px] text-xs w-[64px] font-semibold" maxLength={6} value={labels[id] ?? ''} placeholder={shortName(id, { ...usePod.getState(), labels: {} })} aria-label={`Short name of ${longName(id)}`} translate="no"
              onChange={(e) => setLabel(id, e.target.value.toUpperCase())} onKeyDown={stop} />
            <span className="flex-1 min-w-0 truncate text-xs text-ink" translate="no">{longName(id, { ...usePod.getState(), labels: {} })}</span>
            {cams.some((c) => c.id === id) && <button type="button" className="icon-btn !w-5 !h-5" aria-label="Remove camera" onClick={() => removeCamera(id)}><LuX size={11} /></button>}
          </div>
        ))}
      </div>
      <div className="text-2xs text-faint">Every camera, SuperSource and B-roll clip you add becomes a new input button. For the automatic edit (who speaks when) use the Podcast workspace — both share the same cameras and timeline.</div>
    </div>
  );
}

// ---------- SuperSource ----------
/** border of one box: each side on its own (top, bottom, left, right), or all together */
function BoxBorderEditor({ border, onChange }: { border?: BoxBorder; onChange: (b: BoxBorder | undefined) => void }) {
  const b = border ?? { t: 0, r: 0, b: 0, l: 0, color: '#ffffff' };
  const [link, setLink] = useState(!border || (b.t === b.r && b.r === b.b && b.b === b.l));
  const set = (p: Partial<BoxBorder>) => onChange({ ...b, ...p });
  return (
    <div className="flex flex-col gap-1.5 pt-1 border-t border-line-soft">
      <div className="flex items-center gap-2 text-xs"><span className="text-ink-strong flex-1">Box border</span>
        <Checkbox checked={link} onChange={setLink} label="Same on all sides" />
        <Color value={b.color} label="Box border colour" onChange={(v) => set({ color: v })} /></div>
      {link
        ? <Slider label="All sides" value={Math.round(b.t * 1000) / 10} min={0} max={3} step={0.1} precision={1} unit="%" onChange={(v) => set({ t: v / 100, r: v / 100, b: v / 100, l: v / 100 })} />
        : (['t', 'b', 'l', 'r'] as const).map((k) => <Slider key={k} label={{ t: 'Top', b: 'Bottom', l: 'Left', r: 'Right' }[k]} value={Math.round(b[k] * 1000) / 10} min={0} max={3} step={0.1} precision={1} unit="%" onChange={(v) => set({ [k]: v / 100 })} />)}
    </div>
  );
}

/** animated split screens: how the boxes come in, and recorded layout changes */
function SSAnimEditor({ id }: { id: string }) {
  const sp = usePod((s) => s.splits.find((x) => x.id === id));
  const t0 = usePod((s) => s.analysis?.start ?? 0);
  if (!sp) return null;
  const a = sp.anim ?? defaultSSAnim();
  const setA = (p: Partial<SSAnim>) => updateSplit(id, { anim: { ...a, ...p } });
  const intros: { value: SSIntro; label: string; title: string }[] = [
    { value: 'none', label: 'None', title: 'No animation' }, { value: 'slide', label: 'Slide', title: 'The boxes slide in from the sides' },
    { value: 'drop', label: 'Drop', title: 'The boxes drop in from the top' }, { value: 'zoom', label: 'Zoom', title: 'The boxes zoom in' },
    { value: 'grow', label: 'Grow', title: 'The boxes grow from their centre' }, { value: 'fade', label: 'Fade', title: 'The boxes fade in' }];
  return (
    <div className="flex flex-col gap-1.5 rounded-[6px] border border-line-soft p-2 mt-1">
      <div className="text-xs text-ink-strong">Animation</div>
      <div className="flex items-center justify-between gap-2"><span className="text-muted text-xs">Boxes come in</span><Segmented value={a.intro} onChange={(v) => setA({ intro: v })} options={intros} /></div>
      {a.intro !== 'none' && <Slider label="Intro length" value={a.dur} min={0.2} max={3} step={0.1} precision={1} unit="s" onChange={(v) => setA({ dur: v })} />}
      <Checkbox checked={a.animateChanges} onChange={(v) => setA({ animateChanges: v })} label="Animate layout changes (recorded on the timeline)" />
      {a.animateChanges && <Slider label="Change length" value={a.changeDur} min={0.2} max={4} step={0.1} precision={1} unit="s" onChange={(v) => setA({ changeDur: v })} />}
      {a.animateChanges && <div className="text-2xs text-faint">Go to a moment in the timeline and click a layout: the boxes move to it from there. Drag boxes to change the layout at that moment.</div>}
      {(sp.keys ?? []).length > 0 && (
        <div className="flex flex-col gap-1">
          {(sp.keys ?? []).map((k) => (
            <div key={k.t} className="flex items-center gap-1.5 text-xs">
              <button type="button" className="text-accent num" onClick={() => seek(k.t)}>{`${Math.floor((k.t - t0) / 60)}:${String(Math.floor((k.t - t0) % 60)).padStart(2, '0')}`}</button>
              <span className="text-muted flex-1">{`Layout change · ${k.dur.toFixed(1)} s · ${k.boxes.length} boxes`}</span>
              <button type="button" className="icon-btn !w-5 !h-5" aria-label="Remove layout change" onClick={() => removeSplitKey(id, k.t)}><LuX size={11} /></button>
            </div>
          ))}
          <button type="button" className="btn h-[22px] text-2xs" onClick={() => updateSplit(id, { keys: [] })}>Clear all layout changes</button>
        </div>
      )}
    </div>
  );
}
const PRESET_NAMES: Record<SplitLayout, string> = { side2: 'Side by side', cropped2: 'Two boxes', stack2: 'Top / bottom', side3: 'Three', grid4: 'Grid 2×2', pip: 'Picture in picture', pip2: 'Two small boxes' };
function PresetIcon({ layout }: { layout: SplitLayout }) {
  const r = presetRects(layout, 16 / 9, 0.03);
  return <svg width="34" height="19" viewBox="0 0 34 19" aria-hidden><rect x="0.5" y="0.5" width="33" height="18" rx="1.5" fill="#111" stroke="#555" />{r.map((b, i) => <rect key={i} x={1 + b.x * 32} y={1 + b.y * 17} width={b.w * 32} height={b.h * 17} fill={['#4f8cff', '#2fbf71', '#f0a030', '#c05bd8'][i]} opacity={0.85} />)}</svg>;
}

export function SuperSourceEditor({ id, large = false }: { id: string; large?: boolean }) {
  const sp = usePod((s) => s.splits.find((x) => x.id === id));
  const out = usePod((s) => s.output);
  const sources = usePod((s) => s.sources);
  const ref = useRef<HTMLCanvasElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<'layout' | 'box' | 'border' | 'anim'>('layout');
  const fit = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  const narrow = useWindowSize().w < 760;
  const recs = usePod((s) => [...s.cameras.map((c) => c.id), ...s.broll, ...s.stills]);
  const now = usePod((s) => s.time);
  usePod((s) => s.labels);
  useLayoutEffect(() => {
    const el = fit.current; if (!large || !el) return;
    const go = () => { const o = usePod.getState().output; const r = el.getBoundingClientRect(); setCw(Math.max(160, Math.min(r.width, (r.height * o.width) / o.height))); };
    go(); const ro = new ResizeObserver(go); ro.observe(el); return () => ro.disconnect();
  }, [large, out.width, out.height]);
  useEffect(() => {
    const W = large ? 1280 : 640;
    const draw = () => { const c = ref.current; if (!c) return; if (c.width !== W) { c.width = W; } c.height = Math.round(W * usePod.getState().output.height / usePod.getState().output.width); drawInputTo(c, id); };
    draw(); frameListeners.add(draw);
    const un = usePod.subscribe((s, p) => { if (s.splits !== p.splits || s.output !== p.output || s.time !== p.time || s.colors !== p.colors || s.mp !== p.mp) draw(); });
    const t = setInterval(draw, 800);
    return () => { frameListeners.delete(draw); un(); clearInterval(t); };
  }, [id, large]);
  if (!sp) return null;
  const boxes = editBoxesOf(sp, now);
  const box = boxes[Math.min(sel, boxes.length - 1)];
  const bi = Math.min(sel, boxes.length - 1);
  const drag = (e: React.PointerEvent, i: number, mode: 'move' | 'tl' | 'tr' | 'bl' | 'br') => {
    e.preventDefault(); e.stopPropagation(); setSel(i);
    const r = area.current!.getBoundingClientRect();
    const b0 = { ...editBoxesOf(usePod.getState().splits.find((x) => x.id === id)!)[i] };
    const x0 = e.clientX, y0 = e.clientY;
    const others = editBoxesOf(usePod.getState().splits.find((x) => x.id === id)!).filter((_, k) => k !== i);
    const xs = [0, 0.5, 1, ...others.flatMap((o) => [o.x, o.x + o.w])], ys = [0, 0.5, 1, ...others.flatMap((o) => [o.y, o.y + o.h])];
    const snap = (v: number, list: number[], free: boolean) => { if (free) return v; let best = v, d = 0.012; for (const c of list) if (Math.abs(c - v) < d) { d = Math.abs(c - v); best = c; } return best; };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / r.width, dy = (ev.clientY - y0) / r.height, free = ev.altKey;
      let { x, y, w, h } = b0;
      if (mode === 'move') {
        x = b0.x + dx; y = b0.y + dy;
        const sx = snap(x, xs, free), sx2 = snap(x + w, xs, free); x = sx !== x ? sx : sx2 !== x + w ? sx2 - w : x;
        const sy = snap(y, ys, free), sy2 = snap(y + h, ys, free); y = sy !== y ? sy : sy2 !== y + h ? sy2 - h : y;
      } else {
        let l = b0.x, t = b0.y, rr = b0.x + b0.w, bb = b0.y + b0.h;
        if (mode === 'tl' || mode === 'bl') l = snap(b0.x + dx, xs, free); else rr = snap(b0.x + b0.w + dx, xs, free);
        if (mode === 'tl' || mode === 'tr') t = snap(b0.y + dy, ys, free); else bb = snap(b0.y + b0.h + dy, ys, free);
        if (ev.shiftKey) { // keep the box's shape
          const k = b0.w / b0.h; const nw = rr - l; const nh = nw / k;
          if (mode === 'tl' || mode === 'tr') t = bb - nh; else bb = t + nh;
        }
        x = Math.min(l, rr - 0.03); y = Math.min(t, bb - 0.03); w = Math.max(0.03, rr - l); h = Math.max(0.03, bb - t);
      }
      updateBox(id, i, { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, w: Math.round(w * 1000) / 1000, h: Math.round(h * 1000) / 1000 });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const fitAspect = () => {
    if (!box?.cam) return; const src = sources[box.cam]; if (!src?.width || !src.height) return;
    const a = (src.width * (1 - box.crop.l - box.crop.r)) / (src.height * (1 - box.crop.t - box.crop.b));
    updateBox(id, bi, { h: Math.min(1, (box.w * out.width) / (out.height * a)) });
  };
  const COLORS = ['#4f8cff', '#2fbf71', '#f0a030', '#c05bd8'];
  const canvasArea = (
    <div ref={area} className="relative w-full bg-black rounded-[4px] overflow-hidden select-none touch-none" style={{ aspectRatio: `${out.width} / ${out.height}` }} onPointerDown={() => setSel(-1)}>
      <canvas ref={ref} className="absolute inset-0 w-full h-full" aria-label="SuperSource preview" />
      {boxes.map((b, i) => (
        <div key={i} className={`absolute ${b.on ? '' : 'opacity-40'}`} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, outline: `${i === bi && sel >= 0 ? 2 : 1}px ${i === bi && sel >= 0 ? 'solid' : 'dashed'} ${COLORS[i]}`, cursor: 'move', zIndex: i === bi ? 5 : 1 }}
          onPointerDown={(e) => drag(e, i, 'move')} role="button" aria-label={`Box ${i + 1}`}>
          <span className={`absolute left-0 top-0 px-1 font-bold text-black ${large ? 'text-[12px]' : 'text-[10px]'}`} style={{ background: COLORS[i] }}>{large && b.cam ? <>{`${i + 1} · `}<span translate="no">{shortName(b.cam)}</span></> : i + 1}</span>
          {i === bi && sel >= 0 && (['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <span key={c} onPointerDown={(e) => drag(e, i, c)} className={`absolute bg-white border border-black rounded-[2px] ${large ? 'w-[15px] h-[15px]' : 'w-[11px] h-[11px]'}`}
              style={{ left: c[1] === 'l' ? (large ? -8 : -6) : undefined, right: c[1] === 'r' ? (large ? -8 : -6) : undefined, top: c[0] === 't' ? (large ? -8 : -6) : undefined, bottom: c[0] === 'b' ? (large ? -8 : -6) : undefined, cursor: c === 'tl' || c === 'br' ? 'nwse-resize' : 'nesw-resize' }} />
          ))}
        </div>
      ))}
    </div>
  );
  const layoutPart = (
    <>
      <div className="text-2xs text-muted">1 · Choose a layout</div>
      <div className="flex flex-wrap gap-1">
        {SPLIT_PRESETS.map((l) => <button key={l} type="button" className={`btn !p-1 h-auto ${sp.preset === l ? '!border-accent !bg-accent-soft' : ''}`} aria-label={PRESET_NAMES[l]} data-tip={PRESET_NAMES[l]} aria-pressed={sp.preset === l} onClick={() => applySplitPreset(id, l)}><PresetIcon layout={l} /></button>)}
      </div>
      <div className="text-2xs text-muted mt-1">2 · Click a camera for each box</div>
      <div className="flex flex-col gap-1.5">
        {boxes.map((b, i) => (
          <div key={i} className={`flex flex-col gap-1 rounded-[5px] p-1 ${i === bi && sel >= 0 ? 'bg-[#262b33]' : ''}`} onClick={() => setSel(i)}>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-[3px] text-[10px] font-bold text-black flex items-center justify-center shrink-0" style={{ background: COLORS[i] }}>{i + 1}</span>
              <input type="checkbox" className="accent-[#4f8cff]" checked={b.on} aria-label={`Box ${i + 1} on`} onChange={(e) => updateBox(id, i, { on: e.target.checked })} />
              <div className="flex-1 min-w-0"><SourceSelect value={b.cam} label={`Source of box ${i + 1}`} allowNone onChange={(v) => updateBox(id, i, { cam: v })} /></div>
              <button type="button" className="icon-btn !w-5 !h-5" aria-label="Bring to front" data-tip="Bring to front" disabled={i === boxes.length - 1} onClick={() => { bringBoxToFront(id, i); setSel(boxes.length - 1); }}><LuArrowUpToLine size={11} /></button>
              <button type="button" className="icon-btn !w-5 !h-5" aria-label="Remove box" disabled={boxes.length <= 1} onClick={() => removeBox(id, i)}><LuX size={11} /></button>
            </div>
            <div className="flex flex-wrap gap-1 ps-[22px]">
              {recs.map((c) => (
                <button key={c} type="button" className={`h-[20px] px-1.5 rounded-[4px] text-[10px] font-semibold border ${b.cam === c ? 'border-transparent' : 'border-line text-muted hover:text-ink'}`} style={b.cam === c ? { background: COLORS[i], color: '#000' } : undefined}
                  aria-label={`Box ${i + 1}: ${longName(c)}`} aria-pressed={b.cam === c} data-tip={longName(c)} onClick={(e) => { e.stopPropagation(); setSel(i); updateBox(id, i, { cam: c }); }} translate="no">{shortName(c)}</button>
              ))}
            </div>
          </div>
        ))}
        {boxes.length < 4 && <button type="button" className="btn h-[24px] text-xs inline-flex items-center justify-center gap-1" onClick={() => { addBox(id); setSel(boxes.length); }}><LuPlus size={12} />Add box</button>}
      </div>
      <div className="text-2xs text-muted mt-1">3 · Drag the boxes on the picture to move them, drag a corner to resize (Shift keeps the shape, Alt turns off snapping)</div>
    </>
  );
  const boxPartEl = (
    <>
      <div className="flex items-center gap-1 text-2xs text-muted">Box
        {boxes.map((_, i) => <button key={i} type="button" className={`w-6 h-6 rounded-[4px] text-[11px] font-bold ${i === bi && sel >= 0 ? 'ring-2 ring-white' : ''}`} style={{ background: COLORS[i], color: '#000' }} aria-label={`Select box ${i + 1}`} onClick={() => setSel(i)}>{i + 1}</button>)}
      </div>
      {box && sel >= 0 && (
        <div className="rounded-[6px] border border-line-soft p-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs text-ink-strong"><span>{`Box ${bi + 1}`}</span><div className="flex-1" />
            <button type="button" className="btn h-[22px] text-2xs inline-flex items-center gap-1" onClick={fitAspect} data-tip="Make the box the same shape as the camera picture (no cropping)"><LuRatio size={11} />Camera shape</button>
            <button type="button" className="btn h-[22px] text-2xs" onClick={() => updateBox(id, bi, { crop: noCrop() })}>Reset crop</button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <label key={k} className="flex flex-col text-2xs text-muted">{{ x: 'X', y: 'Y', w: 'Width', h: 'Height' }[k]}
                <input type="number" className="field h-[22px] text-xs num" step={0.5} value={Math.round(box[k] * 1000) / 10} aria-label={`Box ${k}`} onKeyDown={stop}
                  onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) updateBox(id, bi, { [k]: Math.max(k === 'w' || k === 'h' ? 0.02 : -1, Math.min(2, v / 100)) } as Partial<SSBox>); }} />
              </label>
            ))}
          </div>
          {(['l', 'r', 't', 'b'] as const).map((k) => (
            <Slider key={k} label={{ l: 'Crop left', r: 'Crop right', t: 'Crop top', b: 'Crop bottom' }[k]} value={Math.round(box.crop[k] * 1000) / 10} min={0} max={45} step={0.5} precision={1} unit="%" onChange={(v) => updateBox(id, bi, { crop: { ...box.crop, [k]: v / 100 } })} />
          ))}
        </div>
      )}
    </>
  );
  const borderPartEl = (
    <>
      <div className="flex items-center gap-1 text-2xs text-muted">Box
        {boxes.map((_, i) => <button key={i} type="button" className={`w-6 h-6 rounded-[4px] text-[11px] font-bold ${i === bi && sel >= 0 ? 'ring-2 ring-white' : ''}`} style={{ background: COLORS[i], color: '#000' }} aria-label={`Select box ${i + 1}`} onClick={() => setSel(i)}>{i + 1}</button>)}
      </div>
      {box && sel >= 0 && <BoxBorderEditor key={bi} border={box.border} onChange={(border) => updateBox(id, bi, { border })} />}
      <Row label="Name"><input className="field h-[22px] text-xs w-full" value={sp.name} placeholder={longName(id, { ...usePod.getState(), labels: {} })} aria-label="SuperSource name" onChange={(e) => updateSplit(id, { name: e.target.value })} onKeyDown={stop} translate="no" /></Row>
      <Row label="Background"><Color value={sp.bg} label="Background colour" onChange={(v) => updateSplit(id, { bg: v })} /></Row>
      <Slider label="Border" value={Math.round(sp.border * 1000) / 10} min={0} max={2} step={0.1} precision={1} unit="%" onChange={(v) => updateSplit(id, { border: v / 100 })} />
      {sp.border > 0 && <Row label="Border colour"><Color value={sp.borderColor} label="Border colour" onChange={(v) => updateSplit(id, { borderColor: v })} /></Row>}
    </>
  );
  const animPart = <SSAnimEditor id={id} />;
  const controls = <>{layoutPart}{boxPartEl}{borderPartEl}{animPart}</>;
  if (large) {
    const tabs = [['layout', 'Layout & cameras'], ['box', 'Size & crop'], ['border', 'Borders'], ['anim', 'Animation']] as const;
    return (
      <div className={`h-full min-h-0 flex ${narrow ? 'flex-col' : 'flex-row'} gap-3`}>
        <div ref={fit} className={`${narrow ? 'h-[45%] shrink-0' : 'flex-1 min-w-0'} min-h-0 flex items-center justify-center`}><div style={{ width: cw || undefined }} className="w-full">{canvasArea}</div></div>
        <div className={`${narrow ? 'flex-1' : 'w-[330px] shrink-0'} min-h-0 flex flex-col gap-2`}>
          <div className="grid grid-cols-4 gap-1 shrink-0" role="tablist" aria-label="SuperSource settings">
            {tabs.map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={`h-[30px] px-1 rounded-[5px] text-[11px] leading-tight border ${tab === t ? 'bg-accent border-accent' : 'border-line text-muted hover:text-ink'}`} style={tab === t ? { color: '#fff' } : undefined} onClick={() => { setTab(t); if (sel < 0) setSel(0); }}>{l}</button>)}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pe-1">{tab === 'layout' ? layoutPart : tab === 'box' ? boxPartEl : tab === 'border' ? borderPartEl : animPart}</div>
        </div>
      </div>
    );
  }
  return <div className="flex flex-col gap-2">{canvasArea}{controls}</div>;
}

function SuperSourceBox() {
  const splits = usePod((s) => s.splits);
  const cams = usePod((s) => s.cameras.length);
  usePod((s) => s.labels); useSS((s) => s.active);
  const setCur = (id: string | null) => useSS.setState({ active: id });
  const active = activeSS();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1 items-center">
        {splits.map((x) => (
          <button key={x.id} type="button" className={`h-[24px] px-2 rounded-[5px] text-xs ${x.id === active ? 'bg-accent text-white' : 'btn'}`} onClick={() => setCur(x.id)} translate="no">{shortName(x.id)}</button>
        ))}
        <button type="button" className="btn h-[24px] text-xs inline-flex items-center gap-1" disabled={cams < 1} onClick={() => setCur(addSplit('side2'))}><LuPlus size={12} />New SuperSource</button>
        {active && <button type="button" className="icon-btn !w-6 !h-6 ms-auto" aria-label="Remove SuperSource" data-tip="Remove SuperSource" onClick={() => { if (window.confirm('Remove this SuperSource? Shots that use it become black.')) removeSplit(active); }}><LuX size={13} /></button>}
      </div>
      {active && <button type="button" className="btn btn-primary h-[28px] text-xs inline-flex items-center justify-center gap-1.5" onClick={() => usePod.setState({ videoOut: 'ss' })}><LuMaximize2 size={13} />Open the large editor</button>}
      {active ? <SuperSourceEditor id={active} /> : <div className="text-2xs text-faint">A SuperSource is a split screen you design yourself: up to four boxes, each with its own camera, position, size and crop. It becomes a new input button.</div>}
    </div>
  );
}

// ---------- picture in picture ----------
function PipBox() {
  const k = usePod((s) => s.usk);
  return (
    <div className="flex flex-col gap-2">
      <Row label="Camera"><SourceSelect value={k.fill} label="Picture in picture source" onChange={(v) => v && setKey({ type: 'dve', fill: v, keySrc: v })} /></Row>
      <div className="flex items-center gap-1.5 text-xs"><span className="text-muted w-[92px]">Position</span>
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => <button key={c} type="button" className="btn h-[22px] px-1.5 text-2xs" aria-label={{ tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' }[c]} onClick={() => pipCorner(c)}>{{ tl: '↖', tr: '↗', bl: '↙', br: '↘' }[c]}</button>)}
        <button type="button" className="btn h-[22px] px-1.5 text-2xs" aria-label="Centre" onClick={() => setKey({ dve: { ...k.dve, x: (1 - k.dve.w) / 2, y: (1 - k.dve.h) / 2 } })}>•</button></div>
      <Slider label="Size" value={Math.round(k.dve.w * 100)} min={5} max={100} unit="%" onChange={(v) => { const w = v / 100; setKey({ dve: { ...k.dve, w, h: w, x: Math.min(k.dve.x, 1 - w), y: Math.min(k.dve.y, 1 - w) } }); }} />
      <Slider label="Position X" value={Math.round(k.dve.x * 100)} min={-20} max={100} unit="%" onChange={(v) => setKey({ dve: { ...k.dve, x: v / 100 } })} />
      <Slider label="Position Y" value={Math.round(k.dve.y * 100)} min={-20} max={100} unit="%" onChange={(v) => setKey({ dve: { ...k.dve, y: v / 100 } })} />
      <Slider label="Border" value={Math.round(k.dve.border * 1000) / 10} min={0} max={2} step={0.1} precision={1} unit="%" onChange={(v) => setKey({ dve: { ...k.dve, border: v / 100 } })} />
      {k.dve.border > 0 && <Row label="Border colour"><Color value={k.dve.borderColor} label="Border colour" onChange={(v) => setKey({ dve: { ...k.dve, borderColor: v } })} /></Row>}
      {(['l', 'r', 't', 'b'] as const).map((c) => <Slider key={c} label={{ l: 'Crop left', r: 'Crop right', t: 'Crop top', b: 'Crop bottom' }[c]} value={Math.round(k.dve.crop[c] * 100)} min={0} max={45} unit="%" onChange={(v) => setKey({ dve: { ...k.dve, crop: { ...k.dve.crop, [c]: v / 100 } } })} />)}
      <div className="text-2xs text-faint">A small camera picture over the program. Turn it on and off with the PICTURE IN PICTURE buttons.</div>
    </div>
  );
}

function DskBox() {
  const d = usePod((s) => s.dsk);
  return (
    <div className="flex flex-col gap-3">
      {([0, 1] as const).map((i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="text-xs font-medium text-ink-strong">{`DSK ${i + 1}`}</div>
          <Row label="Fill source"><SourceSelect value={d[i].fill} label={`DSK ${i + 1} fill`} onChange={(v) => v && setDsk(i, { fill: v })} /></Row>
          <div className="flex items-center justify-between gap-2"><span className="text-muted text-xs">Key</span>
            <Segmented value={d[i].keySrc} onChange={(v) => setDsk(i, { keySrc: v })} options={[{ value: 'alpha', label: 'Alpha', title: 'Use the picture\'s transparency (PNG logos, lower thirds)' }, { value: 'luma', label: 'Luma', title: 'Dark parts become transparent' }, { value: 'none', label: 'Full', title: 'No key: the whole fill' }]} /></div>
          {d[i].keySrc === 'luma' && <>
            <Slider label="Clip" value={Math.round(d[i].clip * 100)} min={0} max={100} unit="%" onChange={(v) => setDsk(i, { clip: v / 100 })} />
            <Slider label="Gain" value={Math.round(d[i].gain * 100)} min={0} max={100} unit="%" onChange={(v) => setDsk(i, { gain: v / 100 })} />
            <Checkbox checked={d[i].invert} onChange={(v) => setDsk(i, { invert: v })} label="Invert key" />
          </>}
          <Slider label="Rate" value={d[i].rate} min={0.1} max={4} step={0.1} precision={1} unit="s" onChange={(v) => setDsk(i, { rate: v })} />
        </div>
      ))}
      <div className="text-2xs text-faint">Logos and lower thirds sit on top of everything. Upload a PNG in Media, put it in MP1 / MP2 and press ON AIR of DSK 1 / 2 in the software panel.</div>
    </div>
  );
}

function TransitionBox() {
  const t = usePod((s) => s.trans);
  const ftbRate = usePod((s) => s.ftbRate);
  const setT = (p: Partial<typeof t>) => usePod.setState((s) => ({ trans: { ...s.trans, ...p } }));
  const wipes: { value: WipePattern; label: string; title: string }[] = [
    { value: 'h', label: '▌', title: 'Horizontal' }, { value: 'v', label: '▀', title: 'Vertical' }, { value: 'circle', label: '●', title: 'Circle' }, { value: 'diamond', label: '◆', title: 'Diamond' },
    { value: 'box', label: '■', title: 'Box' }, { value: 'diagL', label: '◤', title: 'Diagonal' }, { value: 'diagR', label: '◥', title: 'Diagonal (other way)' }];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2"><span className="text-muted text-xs">Style</span>
        <Segmented value={t.style} onChange={(v) => setT({ style: v })} options={[{ value: 'mix', label: 'Mix', title: 'Mix (dissolve)' }, { value: 'dip', label: 'Dip', title: 'Dip through a colour' }, { value: 'wipe', label: 'Wipe', title: 'Wipe' }, { value: 'dve', label: 'DVE', title: 'DVE push' }]} /></div>
      <Slider label="Rate" value={t.dur} min={0.1} max={5} step={0.05} precision={2} unit="s" onChange={(v) => setT({ dur: v })} />
      {t.style === 'dip' && <Row label="Dip colour"><Color value={t.dipColor} label="Dip colour" onChange={(v) => setT({ dipColor: v })} /></Row>}
      {t.style === 'wipe' && <>
        <div className="flex items-center justify-between gap-2"><span className="text-muted text-xs">Pattern</span><Segmented value={t.wipe} onChange={(v) => setT({ wipe: v })} options={wipes} /></div>
        <Checkbox checked={t.reverse} onChange={(v) => setT({ reverse: v })} label="Reverse direction" />
        <Slider label="Border" value={Math.round(t.border * 1000) / 10} min={0} max={3} step={0.1} precision={1} unit="%" onChange={(v) => setT({ border: v / 100 })} />
        {t.border > 0 && <Row label="Border colour"><Color value={t.borderColor} label="Wipe border colour" onChange={(v) => setT({ borderColor: v })} /></Row>}
      </>}
      {t.style === 'dve' && <div className="flex items-center justify-between gap-2"><span className="text-muted text-xs">Direction</span>
        <Segmented value={t.dveDir} onChange={(v) => setT({ dveDir: v })} options={[{ value: 'left', label: '←', title: 'Push left' }, { value: 'right', label: '→', title: 'Push right' }, { value: 'up', label: '↑', title: 'Push up' }, { value: 'down', label: '↓', title: 'Push down' }]} /></div>}
      <Slider label="Fade to black rate" value={ftbRate} min={0.1} max={5} step={0.1} precision={1} unit="s" onChange={(v) => usePod.setState({ ftbRate: v })} />
    </div>
  );
}

function MediaBox() {
  const media = usePod((s) => s.media);
  const mp = usePod((s) => s.mp);
  const colors = usePod((s) => s.colors);
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="btn h-[26px] text-xs inline-flex items-center justify-center gap-1.5" onClick={async () => { const fs = await pick('image/*', true); if (fs.length) void addMedia(fs); }}><LuImagePlus size={13} />Upload pictures (logo, lower third, still)</button>
      {media.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {media.map((m) => (
            <div key={m.id} className="relative rounded-[4px] overflow-hidden border border-line bg-[repeating-conic-gradient(#333_0_25%,#222_0_50%)] bg-[length:12px_12px]">
              <img src={m.url} alt={m.name} className="w-full aspect-video object-contain" />
              <div className="absolute left-0 top-0 flex gap-0.5">{mp.map((x, i) => (x === m.id ? <span key={i} className="px-1 text-[9px] font-bold bg-accent text-white">{`MP${i + 1}`}</span> : null))}</div>
              <button type="button" className="absolute right-0 top-0 icon-btn !w-4 !h-4 bg-black/60" aria-label="Remove picture" onClick={() => removeMedia(m.id)}><LuX size={10} /></button>
            </div>
          ))}
        </div>
      )}
      {([0, 1] as const).map((i) => (
        <Row key={i} label={`Media player ${i + 1}`}>
          <select className="field h-[22px] text-xs w-full" value={mp[i] ?? ''} aria-label={`Media player ${i + 1}`} onChange={(e) => setMp(i, e.target.value || null)}>
            <option value="">—</option>
            {media.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Row>
      ))}
      {(['col1', 'col2'] as const).map((c, i) => (
        <Row key={c} label={`Color ${i + 1}`}><Color value={colors[c]} label={`Color ${i + 1}`} onChange={(v) => usePod.setState((s) => ({ colors: { ...s.colors, [c]: v } }))} /></Row>
      ))}
    </div>
  );
}

function AudioBox() {
  const cams = usePod((s) => s.cameras);
  const speakers = usePod((s) => s.speakers);
  const sources = usePod((s) => s.sources);
  const audioIn = usePod((s) => s.audioIn);
  usePod((s) => s.labels);
  const rows = [...cams.map((c) => ({ id: c.id, name: `${shortName(c.id)} · ${longName(c.id)}` })), ...speakers.filter((x) => x.mic && sources[x.mic]).map((x, i) => ({ id: x.mic as string, name: `MIC ${i + 1} · ${sources[x.mic as string].name}` }))];
  const mode = usePod((s) => s.settings.audioMode);
  if (!rows.length) return <div className="text-2xs text-faint">Add cameras to mix their sound.</div>;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">Program sound</span>
        <Segmented<'picture' | 'speaker' | 'master'> value={mode} onChange={(v) => setSoundSettings({ audioMode: v })} options={[
          { value: 'picture', label: 'Picture', title: 'The sound of what is on screen — cuts with the picture (J / L cuts on the timeline Sound lane)' },
          { value: 'speaker', label: 'Speaker', title: 'Only the person speaking is heard (needs “Find who speaks”)' },
          { value: 'master', label: 'Master', title: 'One master track for everything' }]} />
      </div>
      {rows.map((r) => {
        const a = audioIn[r.id] ?? { mode: 'auto' as AudioMode, db: 0 };
        return (
          <div key={r.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2"><span className="flex-1 min-w-0 truncate text-xs text-ink" translate="no">{r.name}</span>
              <Segmented<AudioMode> value={a.mode} onChange={(v) => setAudioIn(r.id, { mode: v })} options={[{ value: 'auto', label: 'Auto', title: 'Automatic: sound follows the speaker (or the master track)' }, { value: 'afv', label: 'AFV', title: 'Audio follow video: heard only while on program' }, { value: 'on', label: 'On', title: 'Always heard' }, { value: 'off', label: 'Off', title: 'Muted' }]} /></div>
            <Slider label="Level" value={a.db} min={-60} max={6} step={1} unit="dB" onChange={(v) => setAudioIn(r.id, { db: v })} />
          </div>
        );
      })}
    </div>
  );
}

function MultiviewBox() {
  const mv = usePod((s) => s.multiview);
  const mvEdit = useMvEdit((s) => s.on);
  const setMv = (p: Partial<typeof mv>) => usePod.setState((s) => ({ multiview: { ...s.multiview, ...p } }));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2"><span className="text-muted text-xs">Layout</span>
        <Segmented value={mv.layout} onChange={(v) => { if (v === 'custom' && !mv.custom) usePod.setState((s) => ({ multiview: { ...s.multiview, layout: 'custom', custom: presetToCustom(s.multiview.layout === 'custom' ? 'classic' : s.multiview.layout, s) } })); else setMv({ layout: v }); }} options={[{ value: 'classic', label: '▭▭', title: 'Preview and program on top, inputs below' }, { value: 'pgmBig', label: '▣', title: 'Big program' }, { value: 'quad', label: '⊞', title: 'Preview, program and groups of four' }, { value: 'custom', label: '✎', title: 'My own layout' }]} /></div>
      <button type="button" className={`btn h-[26px] text-xs inline-flex items-center justify-center gap-1.5 ${mvEdit ? '!bg-accent !text-white' : ''}`} aria-pressed={mvEdit}
        onClick={() => { const s = usePod.getState(); if (s.multiview.layout !== 'custom') usePod.setState({ multiview: { ...s.multiview, layout: 'custom', custom: s.multiview.custom ?? presetToCustom(s.multiview.layout, s) }, videoOut: 'mv' }); else usePod.setState({ videoOut: 'mv' }); useMvEdit.setState({ on: !mvEdit }); }}>
        {mvEdit ? 'Done editing the layout' : 'Design my own layout'}</button>
      {mv.layout === 'custom' && (
        <div className="flex items-center justify-between gap-2"><span className="text-muted text-xs">Columns</span>
          <select className="field h-[22px] text-xs" value={customOf().cols} aria-label="Columns" onChange={(e) => { const cols = Number(e.target.value); usePod.setState((s) => ({ multiview: { ...s.multiview, custom: { ...customOf(s), cols } } })); }}>
            {[2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select></div>
      )}
      {mvEdit && <div className="text-2xs text-faint">On each window: choose what it shows, ⇠ ⇢ ⇡ ⇣ make it narrower / wider / shorter / taller, ◀ ▶ move it, ✕ removes it. “+ Window” adds one.</div>}
      <div className="flex items-center justify-between gap-2"><span className="text-muted text-xs">Windows</span>
        <select className="field h-[22px] text-xs" value={mv.count} aria-label="Number of windows" onChange={(e) => setMv({ count: Number(e.target.value) })}>
          <option value={0}>Automatic (one per input)</option>
          {[4, 6, 8, 10, 12, 16].map((n) => <option key={n} value={n}>{n}</option>)}
        </select></div>
      <Checkbox checked={mv.labels} onChange={(v) => setMv({ labels: v })} label="Names" />
      <Checkbox checked={mv.tally} onChange={(v) => setMv({ tally: v })} label="Tally (red = program, green = preview)" />
      <Checkbox checked={mv.meters} onChange={(v) => setMv({ meters: v })} label="Audio meters" />
      <Checkbox checked={mv.safe} onChange={(v) => setMv({ safe: v })} label="Safe area" />
      <Checkbox checked={mv.clock} onChange={(v) => setMv({ clock: v })} label="Timecode" />
      <button type="button" className="btn h-[24px] text-xs" onClick={() => setMv({ windows: [] })}>Reset window sources</button>
      <div className="text-2xs text-faint">Hover a window and click its number to choose what it shows. Click a window for preview, double-click to put it on program.</div>
    </div>
  );
}

function ExportBox() {
  const has = usePod((s) => s.segments.length > 0);
  const fmt = usePod((s) => s.renderFormat);
  return (
    <div className="flex flex-col gap-2">
      <Row label="File type">
        <select className="field h-[24px] text-xs w-full" value={fmt} aria-label="File type" onChange={(e) => usePod.setState({ renderFormat: e.target.value as RenderFormat })}>
          {RENDER_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </Row>
      <div className="text-2xs text-faint">When your cuts are done, press Render video at the top (or RENDER on the panel): it makes the video of everything you switched. The size is set in Format · Reels & framing.</div>
      <button type="button" className="btn h-[28px] text-xs inline-flex items-center justify-center gap-1.5" disabled={!has} onClick={() => void downloadEditPackage()} data-tip="XML + EDL + shot list + edit report"><LuPackage size={14} />Edit for Premiere / DaVinci (.zip)</button>
      <button type="button" className="btn h-[26px] text-xs inline-flex items-center justify-center gap-1.5" disabled={!has} onClick={() => void saveEdit()}><LuSave size={13} />Save edit</button>
    </div>
  );
}

export function Palettes() {
  const nIn = usePod((s) => allInputsOf(s).length);
  const nSs = usePod((s) => s.splits.length);
  return (
    <div className="flex flex-col">
      <Section title="Inputs" right={<span className="text-2xs text-faint num">{nIn}</span>}><InputsBox /></Section>
      <Section title="Format · Reels & framing" defaultOpen={false}><FormatBox /></Section>
      <Section title="SuperSource (split screen)" right={nSs ? <span className="text-2xs text-faint num">{nSs}</span> : undefined}><SuperSourceBox /></Section>
      <Section title="Picture in picture" defaultOpen={false}><PipBox /></Section>
      <Section title="Logo / lower third (DSK)" defaultOpen={false}><DskBox /></Section>
      <Section title="Transition" defaultOpen={false}><TransitionBox /></Section>
      <Section title="Media & colours" defaultOpen={false}><MediaBox /></Section>
      <Section title="Audio" defaultOpen={false}><AudioBox /></Section>
      <Section title="Multiview" defaultOpen={false}><MultiviewBox /></Section>
      <Section title="Export" defaultOpen={false}><ExportBox /></Section>
    </div>
  );
}
