import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePod, moveCut, beginCutDrag, setShotCam, deleteShot, undo, redo, fitTimeline, soundSegments, setAudioShift, automixTracks, masterTracks } from '../store';
import { peaksOf, PEAK_RATE, useWaves } from '../waveform';
import { seek, pause } from '../player';
import { BOTH, WIDE_COLOR, VIRTUAL } from '../types';
import { removeOverlay } from '../mixer';
import { editTips, applyTip, type Tip } from '../advisor';
import { create } from '../../state/createStore';

const useTips = create<{ show: boolean; ignored: string[] }>(() => ({ show: true, ignored: [] }));
/** picture and sound cuts move together (linked) or the sound cut moves alone (J / L cut) */
export const useLink = create<{ linked: boolean }>(() => ({ linked: true }));
const SH = 38;

/** the sound of the program: waveform of what is heard, cut with the picture */
function SoundLane({ width, pps, scroll }: { width: number; pps: number; scroll: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const deps = [usePod((x) => x.segments), usePod((x) => x.sources), usePod((x) => x.settings), usePod((x) => x.analysis), usePod((x) => x.speakers), usePod((x) => x.cameras), usePod((x) => x.splits), useWaves((w) => w.n)];
  useEffect(() => {
    const s = usePod.getState();
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1; const H = SH - 6;
    c.width = Math.max(1, Math.round(width * dpr)); c.height = H * dpr;
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, H);
    const xOf = (t: number) => t * pps - scroll;
    const wave = (id: string, a: number, b: number, color: string) => {
      const p = peaksOf(id); const src = s.sources[id]; if (!p || !src) return;
      ctx.fillStyle = color;
      for (let x = Math.max(0, Math.floor(xOf(a))); x < Math.min(width, Math.ceil(xOf(b))); x++) {
        const t0 = (x + scroll) / pps + src.offset, t1 = (x + 1 + scroll) / pps + src.offset;
        let m = 0; for (let i = Math.max(0, Math.floor(t0 * PEAK_RATE)); i <= Math.min(p.length - 1, Math.ceil(t1 * PEAK_RATE)); i++) if (p[i] > m) m = p[i];
        const h = Math.max(1, m * (H - 4)); ctx.fillRect(x, (H - h) / 2, 1, h);
      }
    };
    if (s.settings.audioMode === 'picture') {
      for (const g of soundSegments(s)) {
        if (xOf(g.end) < 0 || xOf(g.start) > width) continue;
        const cam = s.segments[g.seg]?.cam ?? '';
        ctx.fillStyle = 'rgba(80,140,255,0.13)'; ctx.fillRect(xOf(g.start), 0, xOf(g.end) - xOf(g.start), H);
        g.sources.forEach((id, k) => wave(id, g.start, g.end, k ? 'rgba(78,224,138,.8)' : '#4ee08a'));
        void cam;
      }
    } else {
      const ids = s.settings.audioMode === 'speaker' && s.analysis && !s.analysis.stub ? automixTracks(s).map((t) => t.source) : masterTracks(s);
      ids.slice(0, 3).forEach((id, k) => wave(id, s.analysis?.start ?? 0, s.analysis?.end ?? 0, k ? 'rgba(78,224,138,.55)' : '#4ee08a'));
    }
  }, [...deps, width, pps, scroll]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="absolute left-0 top-[3px] pointer-events-none" style={{ width, height: SH - 6 }} aria-hidden />;
}
const TIP_COLOR: Record<Tip['kind'], string> = { wrong: '#ff6b4a', late: '#f0b400', early: '#f0b400', long: '#8fb8ff', short: '#ff6b4a', jump: '#c58bff', crosstalk: '#4ee08a', midword: '#f0b400' };
import { camColor, camKey, camName, speakerColor, longName } from '../labels';
import { SpeakerLabel, CamLabel } from './SpeakerLabel';
import { useWindowSize } from '../../utils/useWindowSize';
import { LuTrash2, LuUndo2, LuRedo2, LuLightbulb, LuCheck, LuX, LuLink, LuUnlink } from 'react-icons/lu';

const REASON: Record<string, string> = {
  speaker: 'Follows the speaker', crosstalk: 'Several talking — wide shot', pause: 'Long pause — wide shot', opening: 'Establishing wide shot',
  closing: 'Closing wide shot', reaction: 'Listener reaction', variety: 'Cutaway in a long answer', angle: 'Other angle of the speaker',
  insert: 'Insert (detail camera)', broll: 'B-roll insert', split: 'Split screen (quick exchange)', manual: 'Manual edit',
};

function niceStep(pps: number) {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800]) if (s * pps >= 70) return s;
  return 3600;
}
const mmss = (t: number) => { const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };

/** speech activity of voice v (0-based) */
function Activity({ v, width, pps, scroll }: { v: number; width: number; pps: number; scroll: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const an = usePod((s) => s.analysis);
  useEffect(() => {
    const c = ref.current; if (!c || !an) return;
    const dpr = window.devicePixelRatio || 1; const H = 24;
    c.width = Math.max(1, Math.round(width * dpr)); c.height = H * dpr;
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, H);
    const lv = an.levels[v]; if (!lv) return;
    const col = speakerColor(an.speakers[v]);
    const who = v + 1;
    for (let x = 0; x < width; x++) {
      const t0 = (x + scroll) / pps, t1 = (x + 1 + scroll) / pps;
      const i0 = Math.max(0, Math.floor((t0 - an.t0) * an.rate)), i1 = Math.min(lv.length, Math.max(i0 + 1, Math.ceil((t1 - an.t0) * an.rate)));
      if (i0 >= lv.length || i1 <= 0) continue;
      let m = 0, mine = 0, both = 0;
      for (let i = i0; i < i1; i++) { if (lv[i] > m) m = lv[i]; if (an.state[i] === who) mine++; else if (an.state[i] === BOTH) both++; }
      const h = Math.max(1, m * (H - 4));
      ctx.fillStyle = mine * 2 >= i1 - i0 ? col : both * 2 >= i1 - i0 ? WIDE_COLOR : '#4a515c';
      ctx.fillRect(x, (H - h) / 2, 1, h);
    }
  }, [an, v, width, pps, scroll]);
  return <canvas ref={ref} className="absolute inset-0" style={{ width, height: 24 }} aria-hidden />;
}

export function PodTimeline() {
  const segs = usePod((s) => s.segments);
  const an = usePod((s) => s.analysis);
  const t = usePod((s) => s.time);
  const view = usePod((s) => s.view);
  const selected = usePod((s) => s.selected);
  const playing = usePod((s) => s.playing);
  const inP = usePod((s) => s.inPoint), outP = usePod((s) => s.outPoint);
  const canUndo = usePod((s) => s.past.length > 0), canRedo = usePod((s) => s.future.length > 0);
  const cams = usePod((s) => s.cameras);
  const splits = usePod((s) => s.splits);
  const broll = usePod((s) => s.broll);
  usePod((s) => s.speakers);
  const overlays = usePod((s) => s.overlays);
  const voices = an?.speakers ?? [];
  const LANES = [{ kind: 'usk', slot: 1, name: 'PIP', color: '#f0b400' }, { kind: 'dsk', slot: 1, name: 'DSK 1', color: '#36b3ff' }, { kind: 'dsk', slot: 2, name: 'DSK 2', color: '#a879ff' }, { kind: 'ftb', slot: 1, name: 'FTB', color: '#8a929d' }] as const;
  const lanes = LANES.filter((l) => overlays.some((o) => o.kind === l.kind && o.slot === l.slot));
  const tipState = useTips();
  const allTips = usePod((s) => editTips(s));
  const tips = allTips.filter((x) => !tipState.ignored.includes(x.key));
  const tipLane = tipState.show && tips.length > 0;
  const OV = 22; const top0 = 66 + SH + lanes.length * OV + (tipLane ? 22 : 0);
  const linked = useLink((x) => x.linked);
  const audioMode = usePod((x) => x.settings.audioMode);
  const sounds = usePod((x) => (x.settings.audioMode === 'picture' ? soundSegments(x) : []));
  const right = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const narrow = useWindowSize().w < 640;
  const labelW = narrow ? 64 : 112;
  useLayoutEffect(() => {
    const el = right.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth)); ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const fitted = useRef(false);
  useEffect(() => { if (an && !fitted.current && width > 50) { fitted.current = true; fitTimeline(width); } if (!an) fitted.current = false; }, [an, width]);
  const { pxPerSec: pps, scroll } = view;
  const xOf = (time: number) => time * pps - scroll;
  const tOf = (x: number) => (x + scroll) / pps;
  // keep the playhead visible while playing
  useEffect(() => {
    if (!playing) return;
    const x = xOf(t);
    if (x > width - 30 || x < 0) usePod.setState((s) => ({ view: { ...s.view, scroll: Math.max(0, t * s.view.pxPerSec - 60) } }));
  }, [t, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const setView = (v: Partial<typeof view>) => usePod.setState((s) => ({ view: { ...s.view, ...v } }));
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const r = right.current!.getBoundingClientRect();
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    if (usePod.getState().playing) pause();
    const go = (cx: number) => seek(tOf(cx - r.left));
    go(e.clientX);
    const mm = (ev: PointerEvent) => go(ev.clientX);
    const up = () => { el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
  };
  const dragCut = (e: React.PointerEvent, i: number) => {
    e.stopPropagation(); e.preventDefault();
    const r = right.current!.getBoundingClientRect();
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    beginCutDrag();
    const mm = (ev: PointerEvent) => moveCut(i, tOf(ev.clientX - r.left), false);
    const up = (ev: PointerEvent) => { moveCut(i, tOf(ev.clientX - r.left), true); el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
  };
  const onWheel = (e: { ctrlKey: boolean; altKey: boolean; metaKey: boolean; clientX: number; deltaX: number; deltaY: number }) => {
    if (!an) return;
    if (e.ctrlKey || e.altKey || e.metaKey) {
      const r = right.current!.getBoundingClientRect(); const mx = e.clientX - r.left; const at = tOf(mx);
      const np = Math.max(0.05, Math.min(400, pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      setView({ pxPerSec: np, scroll: Math.max(0, at * np - mx) });
    } else setView({ scroll: Math.max(0, scroll + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY)) });
  };
  const sel = segs.find((x) => x.id === selected) ?? null;
  const selOv = overlays.find((o) => o.id === selected) ?? null;
  const selTip = selected?.startsWith('tip:') ? tips.find((x) => `tip:${x.key}` === selected) ?? null : null;
  const stepS = niceStep(pps);
  const ticks: number[] = [];
  if (an) for (let s0 = an.start + Math.floor((tOf(0) - an.start) / stepS) * stepS; s0 < tOf(width); s0 += stepS) if (s0 >= an.start) ticks.push(s0);
  const visible = segs.filter((x) => xOf(x.end) > -2 && xOf(x.start) < width + 2);
  const zoomVal = Math.round((Math.log(pps / 0.05) / Math.log(8000)) * 100);

  return (
    <div className="h-full flex flex-col min-h-0 bg-[#1e2126]">
      <div className="h-9 shrink-0 flex items-center gap-1.5 px-2 border-b border-line bg-panel overflow-x-auto overflow-y-hidden no-scrollbar">
        {selTip ? (
          <>
            <LuLightbulb size={14} className="shrink-0" style={{ color: TIP_COLOR[selTip.kind] }} />
            <span className="text-xs text-ink truncate min-w-[160px] max-w-[52vw] shrink" data-tip={selTip.msg}>{selTip.msg}</span>
            {selTip.fix && <button type="button" className="btn btn-primary h-[24px] px-2 text-xs shrink-0 inline-flex items-center gap-1" onClick={() => { applyTip(selTip); usePod.setState({ selected: null }); }}><LuCheck size={13} />{selTip.fixLabel ?? 'Fix'}</button>}
            <button type="button" className="btn h-[24px] px-2 text-xs shrink-0 inline-flex items-center gap-1" onClick={() => { useTips.setState((t) => ({ ignored: [...t.ignored, selTip.key] })); usePod.setState({ selected: null }); }}><LuX size={13} />Ignore</button>
            <button type="button" className="icon-btn shrink-0" aria-label="Next tip" data-tip="Next tip" onClick={() => { const n = tips.find((x) => x.t > selTip.t + 0.01) ?? tips[0]; if (n) { usePod.setState({ selected: `tip:${n.key}` }); seek(n.t); } }}>›</button>
          </>
        ) : selOv ? (
          <>
            <span className="text-xs text-ink shrink-0">{LANES.find((l) => l.kind === selOv.kind && l.slot === selOv.slot)?.name}</span>
            <span className="text-2xs text-faint num shrink-0">{`${mmss(selOv.start - (an?.start ?? 0))} – ${mmss(selOv.end - (an?.start ?? 0))}`}</span>
            <button type="button" className="icon-btn" aria-label="Remove (Delete)" data-tip="Remove (Delete)" onClick={() => { removeOverlay(selOv.id); usePod.setState({ selected: null }); }}><LuTrash2 size={14} /></button>
          </>
        ) : sel ? (
          <>
            <span className="text-xs text-muted shrink-0 hidden sm:inline">Selected shot</span>
            {[...cams.map((c) => c.id), ...splits.map((x) => x.id)].map((cid) => ({ id: cid })).map((c) => {
              const on = sel.cam === c.id; const col = camColor(c.id);
              return (
                <button key={c.id} type="button" className={`h-[24px] px-2 rounded-[4px] text-xs inline-flex items-center gap-1.5 shrink-0 border max-w-[180px] ${on ? 'text-black' : 'text-ink border-line hover:bg-hover'}`}
                  style={on ? { background: col, borderColor: col } : undefined} onClick={() => setShotCam(sel.id, c.id)} aria-pressed={on}>
                  <span className="font-bold">{camKey(c.id)}</span><CamLabel id={c.id} className="truncate" />
                </button>
              );
            })}
            <select className="field h-[24px] text-xs shrink-0 max-w-[140px]" aria-label="Use a switcher source" value={(VIRTUAL as readonly string[]).includes(sel.cam) ? sel.cam : ''} onChange={(e) => { if (e.target.value) setShotCam(sel.id, e.target.value); }}>
              <option value="">Black, colour, still…</option>
              {VIRTUAL.map((id) => <option key={id} value={id}>{longName(id)}</option>)}
            </select>
            {broll.length > 0 && (
              <select className="field h-[24px] text-xs shrink-0 max-w-[160px]" aria-label="Use a B-roll clip" value={broll.includes(sel.cam) ? sel.cam : ''} onChange={(e) => { if (e.target.value) setShotCam(sel.id, e.target.value); }}>
                <option value="">B-roll…</option>
                {broll.map((id) => <option key={id} value={id}>{camName(id)}</option>)}
              </select>
            )}
            <button type="button" className="icon-btn" aria-label="Remove shot (Delete)" data-tip="Remove shot (Delete)" onClick={() => deleteShot(sel.id)}><LuTrash2 size={14} /></button>
            <span className="text-2xs text-faint shrink-0 hidden md:inline">{REASON[sel.reason]}</span>
          </>
        ) : <span className="text-xs text-faint shrink-0">{an ? 'Click a shot to change its camera · drag a cut to move it · camera numbers while playing switch live' : 'The edit appears here after the analysis.'}</span>}
        <div className="flex-1 min-w-[8px]" />
        {allTips.length > 0 && (
          <button type="button" className={`h-[24px] px-2 rounded-[5px] text-xs inline-flex items-center gap-1 shrink-0 border ${tipState.show ? 'border-[#f0b400] text-[#f0b400]' : 'border-line text-muted'}`} aria-pressed={tipState.show}
            data-tip="Editing tips: where the camera or the cut could be better, from who is speaking" onClick={() => useTips.setState({ show: !tipState.show })}>
            <LuLightbulb size={13} /><span>Tips</span><span className="num">{tips.length}</span>
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="Undo" data-tip="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}><LuUndo2 size={14} /></button>
        <button type="button" className="icon-btn" aria-label="Redo" data-tip="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}><LuRedo2 size={14} /></button>
        <input type="range" className="slider w-[80px] md:w-[120px] shrink-0" min={0} max={100} value={zoomVal} aria-label="Timeline zoom" style={{ ['--p' as string]: `${zoomVal}%` }}
          onChange={(e) => { const np = 0.05 * Math.pow(8000, Number(e.target.value) / 100); const mid = tOf(width / 2); setView({ pxPerSec: np, scroll: Math.max(0, mid * np - width / 2) }); }} />
        <button type="button" className="btn h-[24px] px-2 text-xs shrink-0" onClick={() => fitTimeline(width)}>Fit</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" onWheel={(e) => { if (!(e.target as Element).closest('[data-tl-labels]')) onWheel(e); }}>
      <div className="flex" style={{ minHeight: '100%', height: top0 + voices.length * 28 + 6 }}>
        <div data-tl-labels className="shrink-0 border-e border-line bg-[#22262b] text-2xs text-muted flex flex-col overflow-hidden" style={{ width: labelW }} data-tip="Scroll here to see more lanes">
          <div className="h-[22px] shrink-0 border-b border-line" />
          <div className="h-[44px] shrink-0 flex items-center px-2 border-b border-[#2a2e34] font-medium text-ink">Program</div>
          <div className="flex items-center gap-1 px-2 border-b border-[#2a2e34] shrink-0" style={{ height: SH }}>
            <span className="text-[#4ee08a] truncate flex-1">{audioMode === 'picture' ? 'Sound' : audioMode === 'speaker' ? 'Sound · auto' : 'Sound · master'}</span>
            <button type="button" className={`icon-btn !w-5 !h-5 shrink-0 ${linked ? 'text-[#4ee08a]' : 'text-[#f0b400]'}`} aria-pressed={linked} aria-label={linked ? 'Picture and sound are linked' : 'Picture and sound are unlinked'}
              data-tip={linked ? 'Linked: picture and sound cut together. Click to unlink (then drag a sound cut alone for a J / L cut; Alt-drag also works)' : 'Unlinked: drag a sound cut alone (J / L cut). Click to link again'} onClick={() => useLink.setState({ linked: !linked })}>{linked ? <LuLink size={12} /> : <LuUnlink size={12} />}</button>
          </div>
          {lanes.map((l) => <div key={l.name} className="h-[22px] flex items-center gap-1.5 px-2 border-b border-[#2a2e34] shrink-0"><span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: l.color }} /><span>{l.name}</span></div>)}
          {tipLane && <div className="h-[22px] flex items-center gap-1.5 px-2 border-b border-[#2a2e34] shrink-0 text-[#f0b400]"><LuLightbulb size={11} /><span>Tips</span></div>}
          {voices.map((id) => <div key={id} className="h-[28px] flex items-center gap-1.5 px-2 border-b border-[#2a2e34] min-w-0 shrink-0"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: speakerColor(id) }} /><SpeakerLabel id={id} className="truncate" /></div>)}
        </div>
        <div ref={right} className="relative flex-1 min-w-0 overflow-hidden touch-none select-none">
          {/* ruler */}
          <div className="absolute left-0 right-0 top-0 h-[22px] border-b border-line bg-[#24282e] cursor-col-resize" onPointerDown={scrub} role="slider" aria-label="Time ruler" aria-valuenow={Math.round(t)}>
            {ticks.map((s0) => <div key={s0} className="absolute top-0 bottom-0 border-s border-[#3a414b] ps-1 text-[10px] text-faint num" style={{ left: xOf(s0) }}>{mmss(s0 - (an?.start ?? 0))}</div>)}
          </div>
          {/* program lane */}
          <div className="absolute left-0 right-0 top-[22px] h-[44px] border-b border-[#2a2e34]" onPointerDown={scrub}>
            {visible.map((x) => {
              const i = segs.indexOf(x);
              const l = xOf(x.start), w = Math.max(1, xOf(x.end) - l);
              const isSel = x.id === selected;
              return (
                <div key={x.id} className={`absolute top-[4px] bottom-[4px] rounded-[3px] overflow-hidden ${isSel ? 'ring-2 ring-white z-10' : ''}`}
                  style={{ left: l, width: w, background: camColor(x.cam), opacity: x.reason === 'manual' ? 1 : 0.88, backgroundImage: x.reason === 'broll' || x.reason === 'insert' ? 'repeating-linear-gradient(135deg, rgba(0,0,0,.18) 0 6px, transparent 6px 12px)' : undefined }}
                  data-tip={`${(x.end - x.start).toFixed(1)} s · ${REASON[x.reason]}`}
                  onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); usePod.setState({ selected: x.id }); const r = right.current!.getBoundingClientRect(); if (usePod.getState().playing) pause(); seek(tOf(e.clientX - r.left)); }}>
                  {w > 30 && <span className="absolute left-1.5 right-1 top-0 bottom-0 flex items-center text-[10px] font-semibold text-black/75 whitespace-nowrap overflow-hidden pointer-events-none">{w > 90 ? <CamLabel id={x.cam} short className="truncate" /> : camKey(x.cam) || 'B'}</span>}
                  {x.trans && x.trans.dur > 0 && <div className="absolute left-0 top-0 bottom-0 pointer-events-none" style={{ width: Math.min(w, x.trans.dur * pps), background: 'linear-gradient(90deg, rgba(0,0,0,.45), transparent)' }} />}
                  {i > 0 && <div className="absolute left-0 top-0 bottom-0 w-[7px] -translate-x-[3px] cursor-ew-resize hover:bg-white/50" onPointerDown={(e) => dragCut(e, i)} aria-label="Move cut" role="separator" />}
                </div>
              );
            })}
          </div>
          {/* sound */}
          <div className="absolute left-0 right-0 border-b border-[#2a2e34] bg-[#1b2420]" style={{ top: 66, height: SH }} onPointerDown={scrub}>
            <SoundLane width={width} pps={pps} scroll={scroll} />
            {sounds.map((g, k) => {
              if (k === 0) return null;
              const x = xOf(g.start); if (x < -6 || x > width + 6) return null;
              const shift = segs[g.seg]?.audioShift ?? 0;
              return (
                <div key={g.seg} className={`absolute top-0 bottom-0 w-[7px] -ms-[3px] cursor-ew-resize ${shift ? 'bg-[#f0b400]/70' : 'bg-white/25 hover:bg-white/60'}`} style={{ left: x }} role="separator" aria-label="Sound cut"
                  data-tip={shift ? `Sound ${shift < 0 ? 'before' : 'after'} the picture by ${Math.abs(shift).toFixed(2)} s (${shift < 0 ? 'J-cut' : 'L-cut'}) · double-click: back to the picture cut` : 'Sound cut — drag (unlinked or with Alt) for a J / L cut'}
                  onDoubleClick={(e) => { e.stopPropagation(); setAudioShift(g.seg, 0); }}
                  onPointerDown={(e) => {
                    e.stopPropagation(); e.preventDefault();
                    const r = right.current!.getBoundingClientRect(); const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
                    const alone = !useLink.getState().linked || e.altKey;
                    beginCutDrag();
                    const mm = (ev: PointerEvent) => { const t = tOf(ev.clientX - r.left); if (alone) setAudioShift(g.seg, t - usePod.getState().segments[g.seg].start, false); else moveCut(g.seg, t - shift, false); };
                    const up = (ev: PointerEvent) => { const t = tOf(ev.clientX - r.left); if (alone) setAudioShift(g.seg, t - usePod.getState().segments[g.seg].start, true); else moveCut(g.seg, t - shift, true); el.removeEventListener('pointermove', mm); el.removeEventListener('pointerup', up); };
                    el.addEventListener('pointermove', mm); el.addEventListener('pointerup', up);
                  }} />
              );
            })}
          </div>
          {/* keys, downstream keys, fade to black */}
          {lanes.map((l, li) => (
            <div key={l.name} className="absolute left-0 right-0 h-[22px] border-b border-[#2a2e34]" style={{ top: 66 + SH + li * OV }} onPointerDown={scrub}>
              {overlays.filter((o) => o.kind === l.kind && o.slot === l.slot && xOf(o.end) > -2 && xOf(o.start) < width + 2).map((o) => {
                const lft = xOf(o.start), w = Math.max(2, xOf(o.end) - lft);
                const fi = Math.min(100, (o.fadeIn / Math.max(0.001, o.end - o.start)) * 100), fo = Math.min(100, (o.fadeOut / Math.max(0.001, o.end - o.start)) * 100);
                return (
                  <div key={o.id} className={`absolute top-[3px] bottom-[3px] rounded-[3px] ${o.id === selected ? 'ring-2 ring-white z-10' : ''}`}
                    style={{ left: lft, width: w, background: l.color, clipPath: `polygon(0 100%, ${fi}% 0, ${100 - fo}% 0, 100% 100%)` }}
                    data-tip={`${l.name} · ${(o.end - o.start).toFixed(1)} s`}
                    onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); usePod.setState({ selected: o.id }); }} />
                );
              })}
            </div>
          ))}
          {/* editing tips */}
          {tipLane && (
            <div className="absolute left-0 right-0 h-[22px] border-b border-[#2a2e34]" style={{ top: 66 + SH + lanes.length * OV }} onPointerDown={scrub}>
              {tips.filter((x) => xOf(x.t) > -10 && xOf(x.t) < width + 10).map((x) => (
                <button key={x.key} type="button" className={`absolute top-[3px] w-[16px] h-[16px] -ms-[8px] rounded-full flex items-center justify-center ${selected === `tip:${x.key}` ? 'ring-2 ring-white z-10' : ''}`}
                  style={{ left: xOf(x.t), background: TIP_COLOR[x.kind] }} aria-label={x.msg} data-tip={x.msg}
                  onPointerDown={(e) => { e.stopPropagation(); usePod.setState({ selected: `tip:${x.key}` }); if (usePod.getState().playing) pause(); seek(x.t); }}>
                  <LuLightbulb size={10} color="#000" />
                </button>
              ))}
            </div>
          )}
          {/* speaker lanes */}
          {voices.map((id, v) => <div key={id} className="absolute left-0 right-0 h-[28px] border-b border-[#2a2e34]" style={{ top: top0 + v * 28 }} onPointerDown={scrub}><div className="absolute left-0 right-0 top-[2px] h-[24px]"><Activity v={v} width={width} pps={pps} scroll={scroll} /></div></div>)}
          <div className="absolute left-0 right-0 bottom-0" style={{ top: top0 + voices.length * 28 }} onPointerDown={scrub} />
          {/* export range */}
          {(inP !== null || outP !== null) && an && (
            <>
              <div className="absolute top-0 bottom-0 bg-black/45 pointer-events-none" style={{ left: 0, width: Math.max(0, xOf(inP ?? an.start)) }} />
              <div className="absolute top-0 bottom-0 bg-black/45 pointer-events-none" style={{ left: Math.max(0, xOf(outP ?? an.end)), right: 0 }} />
            </>
          )}
          {/* playhead */}
          {an && <div className="absolute top-0 bottom-0 w-px bg-[#ff4d52] pointer-events-none z-20" style={{ left: xOf(t) }}><div className="absolute -top-0 -left-[5px] w-[11px] h-[10px] bg-[#ff4d52]" style={{ clipPath: 'polygon(0 0,100% 0,50% 100%)' }} /></div>}
        </div>
      </div>
      </div>
    </div>
  );
}

