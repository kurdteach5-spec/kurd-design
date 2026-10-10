// Output format (YouTube, Reels / TikTok / Shorts, square, 4:5, 4:3, 21:9 or any size) and the framing of
// each camera in it: automatic (finds the person) or by hand (drag the frame, zoom).
import { useEffect, useRef, useState } from 'react';
import { usePod } from '../store';
import { elementFor, frameListeners } from '../player';
import { autoFrame, FORMATS } from '../framing';
import { shortName, longName } from '../labels';
import { toast } from '../../state/uiStore';
import { Segmented, Slider } from '../../components/ui/controls';
import { LuScanFace, LuCrosshair } from 'react-icons/lu';

function Aspect({ w, h }: { w: number; h: number }) {
  const k = 18 / Math.max(w, h);
  return <span className="inline-block border border-current rounded-[2px] shrink-0" style={{ width: Math.max(6, w * k), height: Math.max(6, h * k) }} aria-hidden />;
}

/** the camera picture with the part that shows in the output; drag to move it */
function FramePreview({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const out = usePod((s) => s.output);
  const f = usePod((s) => s.framing[id]) ?? { x: 0.5, y: 0.5, zoom: 1 };
  const src = usePod((s) => s.sources[id]);
  const vw = src?.width || 16, vh = src?.height || 9;
  useEffect(() => {
    const draw = () => {
      const c = ref.current; const v = elementFor(id) as HTMLVideoElement | null; if (!c) return;
      c.width = 480; c.height = Math.round((480 * vh) / vw);
      const ctx = c.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
      if (v && v.readyState >= 2) ctx.drawImage(v, 0, 0, c.width, c.height);
    };
    draw(); frameListeners.add(draw); const t = setInterval(draw, 700);
    return () => { frameListeners.delete(draw); clearInterval(t); };
  }, [id, vw, vh]);
  const A = out.width / out.height;
  const fill = out.fit === 'cover';
  let rw = 1, rh = 1; // visible part of the source, 0..1
  if (fill) { if (vw / vh > A) { rh = 1 / f.zoom; rw = (vh * A) / vw / f.zoom; } else { rw = 1 / f.zoom; rh = vw / A / vh / f.zoom; } }
  else { rw = 1 / f.zoom; rh = 1 / f.zoom; }
  rw = Math.min(1, rw); rh = Math.min(1, rh);
  const cx = Math.max(rw / 2, Math.min(1 - rw / 2, f.x)), cy = Math.max(rh / 2, Math.min(1 - rh / 2, f.y));
  const setF = (p: Partial<typeof f>) => usePod.setState((s) => ({ framing: { ...s.framing, [id]: { ...f, ...p } } }));
  const drag = (e: React.PointerEvent) => {
    e.preventDefault(); const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY, fx = cx, fy = cy;
    const mm = (ev: PointerEvent) => setF({ x: Math.max(rw / 2, Math.min(1 - rw / 2, fx + (ev.clientX - x0) / box.width)), y: Math.max(rh / 2, Math.min(1 - rh / 2, fy + (ev.clientY - y0) / box.height)) });
    const up = () => { window.removeEventListener('pointermove', mm); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mm); window.addEventListener('pointerup', up);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative w-full bg-black rounded-[4px] overflow-hidden select-none touch-none" style={{ aspectRatio: `${vw} / ${vh}` }}>
        <canvas ref={ref} className="absolute inset-0 w-full h-full" aria-label={`Picture of ${longName(id)}`} />
        <div className="absolute inset-0 bg-black/55 pointer-events-none" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 ${(cy - rh / 2) * 100}%,${(cx - rw / 2) * 100}% ${(cy - rh / 2) * 100}%,${(cx - rw / 2) * 100}% ${(cy + rh / 2) * 100}%,${(cx + rw / 2) * 100}% ${(cy + rh / 2) * 100}%,${(cx + rw / 2) * 100}% ${(cy - rh / 2) * 100}%,0 ${(cy - rh / 2) * 100}%)` }} />
        <div className="absolute border-2 border-[#f0b400] cursor-move" style={{ left: `${(cx - rw / 2) * 100}%`, top: `${(cy - rh / 2) * 100}%`, width: `${rw * 100}%`, height: `${rh * 100}%` }} onPointerDown={drag} role="slider" aria-label="Framing (drag to move)">
          <div className="absolute left-1/2 top-1/3 w-3 h-3 -ml-1.5 -mt-1.5 border border-[#f0b400] rounded-full" />
        </div>
      </div>
      <Slider label="Zoom" value={Math.round(f.zoom * 100)} min={100} max={300} step={5} unit="%" onChange={(v) => setF({ zoom: v / 100 })} />
      <div className="flex gap-1.5">
        <button type="button" className="btn flex-1 h-[24px] text-xs inline-flex items-center justify-center gap-1" onClick={async () => { toast('Looking for the person…', 'info', 2500); const n = await autoFrame([id]); if (!n) toast('No person found — drag the frame by hand.', 'warning'); }}><LuScanFace size={13} />Auto centre</button>
        <button type="button" className="btn flex-1 h-[24px] text-xs inline-flex items-center justify-center gap-1" onClick={() => setF({ x: 0.5, y: 0.5, zoom: 1 })}><LuCrosshair size={13} />Middle</button>
      </div>
    </div>
  );
}

export function FormatBox() {
  const out = usePod((s) => s.output);
  const cams = usePod((s) => s.cameras.map((c) => c.id));
  usePod((s) => s.labels);
  const [cam, setCam] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cur = cams.includes(cam ?? '') ? cam! : cams[0] ?? null;
  const setOut = (p: Partial<typeof out>) => usePod.setState((s) => ({ output: { ...s.output, ...p } }));
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-1">
        {FORMATS.map((f) => {
          const on = out.width === f.w && out.height === f.h;
          return (
            <button key={f.id} type="button" className={`h-[26px] px-2 rounded-[5px] text-xs inline-flex items-center gap-2 text-start border ${on ? 'border-accent bg-accent-soft text-ink-strong' : 'border-line text-muted hover:text-ink hover:bg-hover'}`} aria-pressed={on} onClick={() => setOut({ width: f.w, height: f.h })}>
              <span className="w-[20px] flex justify-center"><Aspect w={f.w} h={f.h} /></span><span className="flex-1 truncate">{f.label}</span><span className="num text-2xs text-faint">{`${f.w}×${f.h}`}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 text-xs"><span className="text-muted w-[60px]">Custom</span>
        <input type="number" className="field h-[22px] w-[70px] text-xs num" value={out.width} min={160} max={7680} step={2} aria-label="Width" onKeyDown={(e) => e.stopPropagation()} onChange={(e) => { const v = Math.round(Number(e.target.value) / 2) * 2; if (v >= 160 && v <= 7680) setOut({ width: v }); }} />
        <span className="text-faint">×</span>
        <input type="number" className="field h-[22px] w-[70px] text-xs num" value={out.height} min={160} max={7680} step={2} aria-label="Height" onKeyDown={(e) => e.stopPropagation()} onChange={(e) => { const v = Math.round(Number(e.target.value) / 2) * 2; if (v >= 160 && v <= 7680) setOut({ height: v }); }} />
      </div>
      <div className="flex items-center justify-between gap-2"><span className="text-muted text-xs">Framing</span>
        <Segmented value={out.fit} onChange={(v) => setOut({ fit: v })} options={[{ value: 'cover', label: 'Fill', title: 'Fill the frame (crops the sides — follows the framing below)' }, { value: 'contain', label: 'Fit', title: 'Show the whole picture (black bars)' }]} /></div>
      {cams.length > 0 && (
        <>
          <button type="button" className="btn btn-primary h-[28px] text-xs inline-flex items-center justify-center gap-1.5" disabled={busy}
            onClick={async () => { setBusy(true); toast('Finding the people in every camera…', 'info', 3000); const n = await autoFrame(cams); setBusy(false); toast(`${n} of ${cams.length} cameras centred on the person`); }}>
            <LuScanFace size={14} />{busy ? 'Finding the people…' : 'Auto centre every camera'}
          </button>
          <div className="flex flex-wrap gap-1">
            {cams.map((c) => <button key={c} type="button" className={`h-[22px] px-1.5 rounded-[4px] text-[11px] font-semibold border ${c === cur ? 'bg-accent text-white border-transparent' : 'border-line text-muted hover:text-ink'}`} onClick={() => setCam(c)} data-tip={longName(c)} translate="no">{shortName(c)}</button>)}
          </div>
          {cur && <FramePreview id={cur} />}
          <div className="text-2xs text-faint">The yellow frame is what shows in the video. Drag it to centre the person by hand; Auto centre finds the person for you. SuperSource boxes have their own crop.</div>
        </>
      )}
    </div>
  );
}
