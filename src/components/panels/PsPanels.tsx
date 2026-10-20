// Photoshop panels: Navigator, Histogram, Info and Channels.
import { useEffect, useRef, useState } from 'react';
import { getEngine, subscribeEngine, ZOOM_STEPS } from '../../canvas/engine';
import { useDocuments, selectActiveDoc, commit } from '../../state/documentStore';
import { makeSelection } from '../../canvas/selection';
import { createCanvas, ctx2d } from '../../utils/canvas';
import { useCursor } from '../../state/uiStore';

/** re-renders when the canvas changes (throttled to animation frames) */
function useEngineTick(): number {
  const [n, setN] = useState(0);
  useEffect(() => { let raf = 0; const off = subscribeEngine(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setN((x) => x + 1)); }); return () => { off(); cancelAnimationFrame(raf); }; }, []);
  return n;
}
function useComposite(maxSide: number): HTMLCanvasElement | null {
  const tick = useEngineTick();
  const doc = useDocuments(selectActiveDoc);
  const [c, setC] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const e = getEngine(); const src = e?.composite; const st = e?.state;
      if (!src || !st || src.width < 2) { setC(null); return; }
      const k = Math.min(1, maxSide / Math.max(st.width, st.height));
      const out = createCanvas(Math.max(1, Math.round(st.width * k)), Math.max(1, Math.round(st.height * k)));
      ctx2d(out).drawImage(src, 0, 0, out.width, out.height); setC(out);
    }, 120);
    return () => clearTimeout(t);
  }, [tick, doc?.historyIndex, doc?.id, maxSide]);
  return c;
}

export function NavigatorPanel() {
  const doc = useDocuments(selectActiveDoc);
  const img = useComposite(260);
  const ref = useRef<HTMLCanvasElement>(null);
  useEngineTick();
  const e = getEngine();
  useEffect(() => {
    const cv = ref.current; if (!cv || !img || !e?.state) return;
    cv.width = img.width; cv.height = img.height;
    const x = ctx2d(cv); x.drawImage(img, 0, 0);
    // the part of the document shown in the window
    const st = e.state; const k = img.width / st.width;
    const a = e.screenToDoc({ x: 0, y: 0 }), b = e.screenToDoc({ x: e.width, y: e.height });
    x.strokeStyle = '#ff3b30'; x.lineWidth = 2;
    x.strokeRect(Math.min(a.x, b.x) * k, Math.min(a.y, b.y) * k, Math.abs(b.x - a.x) * k, Math.abs(b.y - a.y) * k);
  });
  if (!doc || !e) return <div className="p-4 text-muted">No document open.</div>;
  const z = e.zoom;
  const goTo = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const r = ev.currentTarget.getBoundingClientRect(); const st = e.state; if (!st) return;
    const dx = ((ev.clientX - r.left) / r.width) * st.width, dy = ((ev.clientY - r.top) / r.height) * st.height;
    e.setView({ panX: -(dx - st.width / 2) * z, panY: -(dy - st.height / 2) * z });
  };
  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="bg-[#0a0a13] rounded-[6px] flex items-center justify-center p-2 min-h-[120px]">
        {img ? <canvas ref={ref} className="max-w-full max-h-[200px] cursor-pointer touch-none" aria-label="Navigator: click or drag to move the view"
          onPointerDown={(ev) => { ev.currentTarget.setPointerCapture(ev.pointerId); goTo(ev); }} onPointerMove={(ev) => { if (ev.buttons) goTo(ev); }} /> : <span className="text-faint text-xs">…</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="num text-xs w-[52px]">{`${Math.round(z * 100)}%`}</span>
        <input type="range" className="slider flex-1" min={0} max={ZOOM_STEPS.length - 1} step={1} aria-label="Zoom"
          value={ZOOM_STEPS.findIndex((s) => s >= z - 1e-6) < 0 ? ZOOM_STEPS.length - 1 : ZOOM_STEPS.findIndex((s) => s >= z - 1e-6)}
          onChange={(ev) => e.setView({ zoom: ZOOM_STEPS[Number(ev.target.value)] })} />
      </div>
    </div>
  );
}

export function HistogramPanel() {
  const img = useComposite(400);
  const ref = useRef<HTMLCanvasElement>(null);
  const [ch, setCh] = useState<'rgb' | 'lum' | 'r' | 'g' | 'b'>('rgb');
  const [stats, setStats] = useState<{ mean: number; sd: number; median: number; px: number } | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const W = cv.width = 256, H = cv.height = 110; const x = ctx2d(cv); x.clearRect(0, 0, W, H);
    if (!img) { setStats(null); return; }
    const d = ctx2d(img, true).getImageData(0, 0, img.width, img.height).data;
    const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++; l[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++; n++; }
    const draw = (h: Uint32Array, color: string, op: GlobalCompositeOperation) => {
      const max = Math.max(1, ...Array.from(h).slice(1, 255));
      x.globalCompositeOperation = op; x.fillStyle = color; x.beginPath(); x.moveTo(0, H);
      for (let i = 0; i < 256; i++) x.lineTo(i, H - Math.min(H, (h[i] / max) * H)); x.lineTo(256, H); x.closePath(); x.fill();
    };
    if (ch === 'rgb') { draw(r, '#ff3b30', 'lighter'); draw(g, '#34c759', 'lighter'); draw(b, '#3a7bff', 'lighter'); }
    else draw(ch === 'r' ? r : ch === 'g' ? g : ch === 'b' ? b : l, ch === 'lum' ? '#d8d8e8' : ch === 'r' ? '#ff3b30' : ch === 'g' ? '#34c759' : '#3a7bff', 'source-over');
    x.globalCompositeOperation = 'source-over';
    const hsrc = ch === 'r' ? r : ch === 'g' ? g : ch === 'b' ? b : l;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hsrc[i];
    const mean = n ? sum / n : 0; let v = 0; for (let i = 0; i < 256; i++) v += hsrc[i] * (i - mean) ** 2;
    let acc = 0, median = 0; for (let i = 0; i < 256; i++) { acc += hsrc[i]; if (acc >= n / 2) { median = i; break; } }
    setStats({ mean, sd: n ? Math.sqrt(v / n) : 0, median, px: n });
  }, [img, ch]);
  return (
    <div className="p-3 flex flex-col gap-2">
      <select className="field h-[22px] text-xs self-start" value={ch} aria-label="Channel" onChange={(e) => setCh(e.target.value as 'rgb')}>
        <option value="rgb">Colors</option><option value="lum">Luminosity</option><option value="r">Red</option><option value="g">Green</option><option value="b">Blue</option>
      </select>
      <canvas ref={ref} className="w-full h-[110px] bg-[#0a0a13] rounded-[4px]" aria-label="Histogram" />
      {stats && <div className="grid grid-cols-2 gap-x-3 text-2xs text-muted num" translate="no">
        <span>Mean: {stats.mean.toFixed(2)}</span><span>Std Dev: {stats.sd.toFixed(2)}</span><span>Median: {stats.median}</span><span>Pixels: {stats.px.toLocaleString()}</span>
      </div>}
    </div>
  );
}

export function InfoPanel() {
  const tick = useEngineTick();
  const cur = useCursor();
  const e = getEngine(); const st = e?.state;
  const [px, setPx] = useState<{ x: number; y: number; c: number[] | null } | null>(null);
  useEffect(() => {
    const h = e?.hover; if (!e || !st || !h) { setPx(null); return; }
    const x = Math.floor(h.x), y = Math.floor(h.y);
    let c: number[] | null = null;
    if (x >= 0 && y >= 0 && x < st.width && y < st.height) { try { c = Array.from(ctx2d(e.composite, true).getImageData(x, y, 1, 1).data); } catch { c = null; } }
    setPx({ x, y, c });
  }, [tick, cur.x, cur.y]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return <div className="p-4 text-muted">No document open.</div>;
  const c = px?.c;
  const cmyk = c ? (() => { const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255; const k = 1 - Math.max(r, g, b); const f = (v: number) => (k >= 1 ? 0 : Math.round(((1 - v - k) / (1 - k)) * 100)); return [f(r), f(g), f(b), Math.round(k * 100)]; })() : null;
  const sel = st.selection;
  return (
    <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs num" translate="no">
      <div className="flex flex-col gap-0.5"><span className="text-[#ff7a7a]">R: {c ? c[0] : ''}</span><span className="text-[#6ee7a0]">G: {c ? c[1] : ''}</span><span className="text-[#7cb3ff]">B: {c ? c[2] : ''}</span><span className="text-muted">A: {c ? c[3] : ''}</span></div>
      <div className="flex flex-col gap-0.5 text-muted"><span>C: {cmyk ? `${cmyk[0]}%` : ''}</span><span>M: {cmyk ? `${cmyk[1]}%` : ''}</span><span>Y: {cmyk ? `${cmyk[2]}%` : ''}</span><span>K: {cmyk ? `${cmyk[3]}%` : ''}</span></div>
      <div className="flex flex-col gap-0.5"><span>X: {px ? px.x : ''}</span><span>Y: {px ? px.y : ''}</span></div>
      <div className="flex flex-col gap-0.5 text-muted"><span>W: {sel ? Math.round(sel.bounds.w) : st.width}</span><span>H: {sel ? Math.round(sel.bounds.h) : st.height}</span></div>
      <div className="col-span-2 text-2xs text-faint">{`Document: ${st.width} × ${st.height} px · ${st.dpi} ppi${sel ? ' · W/H show the selection' : ''}`}</div>
    </div>
  );
}

export function ChannelsPanel() {
  const img = useComposite(120);
  const st = getEngine()?.state;
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!img) { setThumbs({}); return; }
    const d = ctx2d(img, true).getImageData(0, 0, img.width, img.height);
    const out: Record<string, string> = {};
    for (const [name, i] of [['Red', 0], ['Green', 1], ['Blue', 2]] as const) {
      const c = createCanvas(img.width, img.height); const x = ctx2d(c); const o = x.createImageData(img.width, img.height);
      for (let p = 0; p < d.data.length; p += 4) { const v = d.data[p + i]; o.data[p] = o.data[p + 1] = o.data[p + 2] = v; o.data[p + 3] = 255; }
      x.putImageData(o, 0, 0); out[name] = c.toDataURL();
    }
    out.RGB = img.toDataURL(); setThumbs(out);
  }, [img]);
  if (!st) return <div className="p-4 text-muted">No document open.</div>;
  /** Ctrl-click in Photoshop: the channel's brightness becomes the selection */
  const load = (name: string) => {
    const e = getEngine(); if (!e?.state) return;
    const s = e.state; const src = e.composite; const d = ctx2d(src, true).getImageData(0, 0, s.width, s.height).data;
    const m = createCanvas(s.width, s.height); const x = ctx2d(m); const o = x.createImageData(s.width, s.height);
    const i = name === 'Red' ? 0 : name === 'Green' ? 1 : name === 'Blue' ? 2 : -1;
    for (let p = 0; p < d.length; p += 4) { const v = i < 0 ? Math.round(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) : d[p + i]; o.data[p] = o.data[p + 1] = o.data[p + 2] = 255; o.data[p + 3] = Math.round((v * d[p + 3]) / 255); }
    x.putImageData(o, 0, 0);
    const sel = makeSelection(m);
    commit((ss) => ({ ...ss, selection: sel }), { history: `Load ${name} Channel as Selection` });
  };
  return (
    <div className="py-1" role="list" aria-label="Channels">
      {['RGB', 'Red', 'Green', 'Blue'].map((n) => (
        <div key={n} role="listitem" className="flex items-center gap-2.5 h-[44px] px-3 hover:bg-hover">
          {thumbs[n] ? <img src={thumbs[n]} alt="" className="h-[34px] w-[48px] object-contain bg-[#0a0a13] rounded-[3px]" /> : <span className="h-[34px] w-[48px] bg-[#0a0a13] rounded-[3px]" />}
          <span className="flex-1 text-xs">{n}</span>
          <button type="button" className="btn h-[22px] px-2 text-2xs" data-tip="Load the channel's brightness as a selection" onClick={() => load(n)}>Selection</button>
        </div>
      ))}
    </div>
  );
}
