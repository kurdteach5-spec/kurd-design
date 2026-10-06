import { useEffect, useRef, useState } from 'react';
import { hexToRgb, hslToRgb, hsvToRgb, isValidHex, normalizeHex, rgbToHex, rgbToHsl, rgbToHsv, type HSV } from '../../utils/color';
import { clamp } from '../../utils/math';

type Mode = 'rgb' | 'hsl' | 'hsv';

/** Saturation/value square + hue strip with HEX / RGB / HSL / HSV entry. */
export function ColorPicker({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(color)));
  const [mode, setMode] = useState<Mode>(() => { try { return (localStorage.getItem('designpro.colormode') as Mode) || 'rgb'; } catch { return 'rgb'; } });
  const last = useRef(color);
  // sync from outside without losing hue on grays
  useEffect(() => {
    if (color.toLowerCase() === last.current.toLowerCase()) return;
    last.current = color;
    const n = rgbToHsv(hexToRgb(color));
    setHsv((h) => ({ h: n.s === 0 || n.v === 0 ? h.h : n.h, s: n.v === 0 ? h.s : n.s, v: n.v }));
  }, [color]);
  const emit = (n: HSV) => { setHsv(n); const hex = rgbToHex(hsvToRgb(n)); last.current = hex; onChange(hex); };

  const sv = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);
  const drag = (ref: React.RefObject<HTMLDivElement | null>, fn: (x: number, y: number) => void) => (e: React.PointerEvent) => {
    const el = ref.current; if (!el) return;
    el.setPointerCapture(e.pointerId);
    const go = (ev: { clientX: number; clientY: number }) => { const r = el.getBoundingClientRect(); fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)); };
    go(e);
    const move = (ev: PointerEvent) => go(ev);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  const rgb = hsvToRgb(hsv);
  const hex = rgbToHex(rgb);
  const [hexText, setHexText] = useState(hex);
  useEffect(() => setHexText(hex), [hex]);

  const triple = mode === 'rgb' ? [rgb.r, rgb.g, rgb.b].map(Math.round)
    : mode === 'hsl' ? (() => { const l = rgbToHsl(rgb); return [Math.round(hsv.h), Math.round(l.s * 100), Math.round(l.l * 100)]; })()
    : [Math.round(hsv.h), Math.round(hsv.s * 100), Math.round(hsv.v * 100)];
  const labels = mode === 'rgb' ? ['R', 'G', 'B'] : mode === 'hsl' ? ['H', 'S', 'L'] : ['H', 'S', 'B'];
  const maxes = mode === 'rgb' ? [255, 255, 255] : [360, 100, 100];
  const setComponent = (i: number, v: number) => {
    const t = [...triple]; t[i] = clamp(v, 0, maxes[i]);
    if (mode === 'rgb') { const n = rgbToHsv({ r: t[0], g: t[1], b: t[2] }); emit({ ...n, h: n.s ? n.h : hsv.h }); }
    else if (mode === 'hsl') emit({ ...rgbToHsv(hslToRgb({ h: t[0], s: t[1] / 100, l: t[2] / 100 })), h: t[0] });
    else emit({ h: t[0], s: t[1] / 100, v: t[2] / 100 });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div ref={sv} className="relative h-32 rounded-[4px] cursor-crosshair touch-none" role="slider" aria-label="Saturation and brightness" aria-valuetext={hex}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
        onPointerDown={drag(sv, (x, y) => emit({ ...hsv, s: x, v: 1 - y }))}
        tabIndex={0}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 0.1 : 0.02;
          if (e.key === 'ArrowRight') emit({ ...hsv, s: clamp(hsv.s + d, 0, 1) }); else if (e.key === 'ArrowLeft') emit({ ...hsv, s: clamp(hsv.s - d, 0, 1) });
          else if (e.key === 'ArrowUp') emit({ ...hsv, v: clamp(hsv.v + d, 0, 1) }); else if (e.key === 'ArrowDown') emit({ ...hsv, v: clamp(hsv.v - d, 0, 1) }); else return;
          e.preventDefault();
        }}>
        <span className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)] pointer-events-none"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div ref={hue} className="relative h-3 rounded-full cursor-pointer touch-none" role="slider" aria-label="Hue" aria-valuenow={Math.round(hsv.h)} tabIndex={0}
        style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
        onPointerDown={drag(hue, (x) => emit({ ...hsv, h: x * 359.9 }))}
        onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); emit({ ...hsv, h: clamp(hsv.h + (e.key === 'ArrowRight' ? 5 : -5), 0, 359.9) }); } }}>
        <span className="absolute top-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)] pointer-events-none" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-[4px] border border-line shrink-0" style={{ background: hex }} />
        <label className="flex items-center gap-1.5 flex-1">
          <span className="text-muted">#</span>
          <input className="field num w-full uppercase" value={hexText.replace('#', '')} aria-label="Hex color" spellCheck={false} maxLength={7}
            onChange={(e) => { setHexText(e.target.value); if (isValidHex(e.target.value) && e.target.value.replace('#', '').length === 6) { const n = normalizeHex(e.target.value); last.current = n; setHsv(rgbToHsv(hexToRgb(n))); onChange(n); } }}
            onBlur={(e) => { if (isValidHex(e.target.value)) { const n = normalizeHex(e.target.value); setHsv(rgbToHsv(hexToRgb(n))); onChange(n); } else setHexText(hex); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        </label>
      </div>
      <div className="flex items-center gap-1.5">
        <select className="field w-[58px]" value={mode} aria-label="Color model" onChange={(e) => { const m = e.target.value as Mode; setMode(m); try { localStorage.setItem('designpro.colormode', m); } catch { /* ignore */ } }}>
          <option value="rgb">RGB</option><option value="hsl">HSL</option><option value="hsv">HSB</option>
        </select>
        {triple.map((v, i) => (
          <label key={i} className="flex items-center gap-1 flex-1">
            <span className="text-faint w-2">{labels[i]}</span>
            <input className="field num w-full text-right px-1" type="number" min={0} max={maxes[i]} value={v} aria-label={labels[i]}
              onChange={(e) => setComponent(i, Number(e.target.value))} />
          </label>
        ))}
      </div>
    </div>
  );
}
