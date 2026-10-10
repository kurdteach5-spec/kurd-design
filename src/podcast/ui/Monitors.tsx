import { useEffect, useRef } from 'react';
import { usePod, segmentAt, cutTo, setShotCam, setInOut, splitAt } from '../store';
import { elementFor, setProgramCanvas, syncPaused, togglePlay, step, seek } from '../player';
import { camColor, camKey } from '../labels';
import { CamLabel } from './SpeakerLabel';
import { LuPlay, LuPause, LuStepBack, LuStepForward, LuSkipBack, LuSkipForward, LuScissors } from 'react-icons/lu';

export function tcOf(t: number, fps: number) {
  const f = Math.max(0, Math.round(t * fps)); const tb = Math.round(fps);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(f / (tb * 3600)))}:${p(Math.floor(f / (tb * 60)) % 60)}:${p(Math.floor(f / tb) % 60)}:${p(f % tb)}`;
}

function CamTile({ cam, row }: { cam: string; row: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const src = usePod((s) => s.sources[cam]);
  const live = usePod((s) => segmentAt(s.time, s.segments)?.cam === cam);
  const playing = usePod((s) => s.playing);
  const hasEdit = usePod((s) => s.segments.length > 0);
  const key = usePod((s) => camKey(cam, s));
  const color = usePod((s) => camColor(cam, s));
  useEffect(() => {
    const el = elementFor(cam) as HTMLVideoElement | null;
    const b = box.current; if (!el || !b) return;
    el.className = 'absolute inset-0 w-full h-full object-contain';
    b.appendChild(el);
    syncPaused();
    return () => { if (el.parentElement === b) b.removeChild(el); };
  }, [cam, src?.url]);
  return (
    <button type="button" className={`relative ${row ? 'w-[min(42vw,220px)] shrink-0' : 'w-full'} aspect-video rounded-[6px] overflow-hidden bg-black border-2 ${live ? '' : 'border-transparent'} text-start`}
      style={live ? { borderColor: color } : undefined} disabled={!src || !hasEdit}
      aria-label={`${playing ? 'Cut to camera' : 'Use camera'} ${key}`} data-tip={playing ? `Cut to this camera now (${key})` : `Use this camera for the current shot (${key})`}
      onClick={() => { const s = usePod.getState(); if (s.playing) cutTo(cam); else { const cur = segmentAt(s.time); if (cur) setShotCam(cur.id, cam); } }}>
      <div ref={box} className="absolute inset-0" />
      <div className="absolute left-0 right-0 bottom-0 px-1.5 py-0.5 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-1.5 text-[10px] text-white">
        {key && <span className="w-4 h-4 rounded-[3px] flex items-center justify-center font-bold text-[10px] text-black shrink-0" style={{ background: color }}>{key}</span>}
        <CamLabel id={cam} className="truncate" />
        {live && <span className="ms-auto rounded-[3px] bg-[#e5484d] px-1 font-bold">LIVE</span>}
      </div>
    </button>
  );
}

function Program() {
  const ref = useRef<HTMLCanvasElement>(null);
  const out = usePod((s) => s.output);
  useEffect(() => { setProgramCanvas(ref.current); return () => setProgramCanvas(null); }, []);
  useEffect(() => { const c = ref.current; if (!c) return; const k = Math.min(1, 1280 / Math.max(out.width, out.height)); c.width = Math.round(out.width * k); c.height = Math.round(out.height * k); syncPaused(); }, [out.width, out.height, out.fit]);
  return <canvas ref={ref} className="max-w-full max-h-full bg-black rounded-[4px] shadow-[0_8px_30px_rgba(0,0,0,.45)]" style={{ aspectRatio: `${out.width} / ${out.height}` }} aria-label="Program monitor (the edited video)" />;
}

export function Transport() {
  const playing = usePod((s) => s.playing);
  const t = usePod((s) => s.time);
  const fps = usePod((s) => s.settings.fps);
  const an = usePod((s) => s.analysis);
  const cur = usePod((s) => segmentAt(s.time, s.segments));
  const B = ({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) => <button type="button" className="icon-btn" aria-label={label} data-tip={label} onClick={onClick}>{children}</button>;
  return (
    <div className="h-10 shrink-0 flex items-center gap-1 px-2 bg-panel border-t border-line overflow-x-auto overflow-y-hidden no-scrollbar">
      <B label="Go to start (Home)" onClick={() => seek(an?.start ?? 0)}><LuSkipBack size={15} /></B>
      <B label="Previous frame (←)" onClick={() => step(-1)}><LuStepBack size={15} /></B>
      <button type="button" className="h-8 w-10 shrink-0 rounded-[6px] bg-accent text-white flex items-center justify-center" aria-label={playing ? 'Pause (Space)' : 'Play (Space)'} data-tip={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={togglePlay} disabled={!an}>{playing ? <LuPause size={17} /> : <LuPlay size={17} />}</button>
      <B label="Next frame (→)" onClick={() => step(1)}><LuStepForward size={15} /></B>
      <B label="Go to end (End)" onClick={() => seek(an?.end ?? 0)}><LuSkipForward size={15} /></B>
      <span className="num text-sm text-accent ms-2 shrink-0" dir="ltr">{tcOf(t - (an?.start ?? 0), fps)}</span>
      {cur && <span className="ms-2 shrink-0 inline-flex items-center gap-1.5 text-xs text-muted max-w-[40vw]"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: camColor(cur.cam) }} /><CamLabel id={cur.cam} className="truncate" /></span>}
      <div className="flex-1 min-w-[8px]" />
      <B label="Split shot here (S)" onClick={() => splitAt()}><LuScissors size={15} /></B>
      <button type="button" className="btn h-[24px] px-2 text-xs shrink-0" onClick={() => setInOut('in')} data-tip="Set the start of the export range (I)">In</button>
      <button type="button" className="btn h-[24px] px-2 text-xs shrink-0" onClick={() => setInOut('out')} data-tip="Set the end of the export range (O)">Out</button>
      <button type="button" className="btn h-[24px] px-2 text-xs shrink-0" onClick={() => setInOut('clear')} data-tip="Clear the export range (Alt+X)">Clear</button>
    </div>
  );
}

export function Monitors({ vertical }: { vertical: boolean }) {
  const cams = usePod((s) => s.cameras);
  const two = !vertical && cams.length > 4;
  return (
    <div className={`h-full min-h-0 flex ${vertical ? 'flex-col' : 'flex-row'} gap-2 p-2 bg-[#141619]`}>
      <div className="flex-1 min-h-0 min-w-0 flex items-center justify-center"><Program /></div>
      {cams.length > 0 && (
        <div className={vertical ? 'flex flex-row gap-2 shrink-0 overflow-x-auto no-scrollbar' : `grid ${two ? 'grid-cols-2 w-[min(40%,460px)]' : 'grid-cols-1 w-[min(30%,340px)]'} gap-2 shrink-0 content-center overflow-y-auto no-scrollbar`}>
          {cams.map((c) => <CamTile key={c.id} cam={c.id} row={vertical} />)}
        </div>
      )}
    </div>
  );
}
