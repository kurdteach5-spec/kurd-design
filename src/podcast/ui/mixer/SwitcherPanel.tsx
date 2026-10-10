// The switcher control panel, laid out like ATEM Software Control: upstream key, next transition and
// transition style on the left; program and preview buses in the middle; CUT / AUTO / T-bar, downstream
// keys and fade to black on the right.
import { useRef, useState, type ReactNode } from 'react';
import { usePod, segmentAt, allInputsOf, inputsOf } from '../../store';
import { performTransition, programCut, setPreview, dskCut, dskAuto, tbarMove, tbarCancel, activeOverlay, setDsk, ssLayout, activeSS, useSS, previewOf } from '../../mixer';
import { presetRects, type SplitLayout } from '../../types';
import { shortName, longName } from '../../labels';
import type { TransStyle } from '../../types';

function LayoutIcon({ layout }: { layout: SplitLayout }) {
  return <svg width="26" height="15" viewBox="0 0 26 15" aria-hidden><rect x="0.5" y="0.5" width="25" height="14" rx="1.5" fill="none" stroke="currentColor" />{presetRects(layout, 16 / 9, 0.04).map((b, i) => <rect key={i} x={1.5 + b.x * 23} y={1.5 + b.y * 12} width={b.w * 23} height={b.h * 12} fill="currentColor" opacity={i ? 0.95 : 0.6} />)}</svg>;
}

type Tone = 'red' | 'green' | 'amber' | 'white' | 'off';
const INK: Record<Tone, string> = { red: '#ffffff', green: '#ffffff', amber: '#000000', white: '#000000', off: '#d6d9de' };
const TONES: Record<Tone, string> = {
  red: 'bg-[#e02424] border-[#ff7070] text-white shadow-[0_0_14px_rgba(255,50,50,.6)]',
  green: 'bg-[#16a34a] border-[#5ee38d] text-white shadow-[0_0_14px_rgba(40,210,100,.55)]',
  amber: 'bg-[#f0b400] border-[#ffd866] text-black shadow-[0_0_12px_rgba(255,190,0,.5)]',
  white: 'bg-[#e8eaed] border-white text-black',
  off: 'bg-[#2b2e33] border-[#43474e] text-[#d6d9de] hover:bg-[#34383e]',
};

function Btn({ tone = 'off', onClick, children, label, w = 58, h = 40, disabled, title }: { tone?: Tone; onClick: () => void; children: ReactNode; label: string; w?: number; h?: number; disabled?: boolean; title?: string }) {
  return (
    <button type="button" aria-label={label} data-tip={title ?? label} disabled={disabled} onClick={onClick}
      className={`shrink-0 rounded-[4px] border text-[11px] font-semibold leading-tight flex flex-col items-center justify-center select-none transition-shadow disabled:opacity-35 ${TONES[tone]}`}
      style={{ width: w, height: h, color: INK[tone] }} aria-pressed={tone !== 'off'}>
      {children}
    </button>
  );
}

function Group({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 shrink-0 ${className}`}>
      <div className="text-[10px] font-semibold tracking-[0.08em] text-[#8b9099] uppercase">{title}</div>
      {children}
    </div>
  );
}

function TBar() {
  const ref = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);
  const [flip, setFlip] = useState(false); // like a hardware T-bar: the next move goes the other way
  const onDown = (e: React.PointerEvent) => {
    const el = ref.current!; const r = el.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const at = (y: number) => { const v = Math.max(0, Math.min(1, (y - r.top) / r.height)); return flip ? 1 - v : v; };
    const move = (ev: PointerEvent) => { const v = at(ev.clientY); setP(v); tbarMove(v); if (v >= 0.999) { done(); setFlip((f) => !f); setP(0); } };
    const done = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    const up = () => { done(); if (p < 0.999 && p > 0) { /* left part-way: the transition stays where the bar is */ } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    move(e.nativeEvent);
  };
  const shown = flip ? 1 - p : p;
  return (
    <div className="flex flex-col items-center gap-1">
      <div ref={ref} className="relative w-[34px] h-[92px] rounded-[4px] bg-[#16181b] border border-[#3a3e45] cursor-ns-resize touch-none" onPointerDown={onDown}
        onDoubleClick={() => { tbarCancel(); setP(0); }} role="slider" aria-label="T-bar" aria-valuenow={Math.round(p * 100)} data-tip="T-bar: drag to make the transition by hand">
        <div className="absolute left-1/2 -translate-x-1/2 top-1 bottom-1 w-[3px] bg-[#2a2d32] rounded" />
        <div className="absolute left-[2px] right-[2px] h-[14px] rounded-[3px] bg-gradient-to-b from-[#d9dce1] to-[#8e939b] shadow" style={{ top: `calc(${shown * 100}% * (92 - 16) / 92)` }} />
      </div>
    </div>
  );
}

export function SwitcherPanel() {
  const inputs = usePod((s) => allInputsOf(s));
  const rec = usePod((s) => inputsOf(s));
  const pgm = usePod((s) => segmentAt(s.time, s.segments)?.cam ?? null);
  const pvw = usePod((s) => previewOf(s));
  const st = usePod((s) => ({ trans: s.trans, dsk: s.dsk, ftbRate: s.ftbRate }));
  usePod((s) => s.videoOut); useSS((s) => s.active);
  const ss = usePod((s) => s.splits.find((x) => x.id === activeSS()) ?? null);
  const dskOn = usePod((s) => [!!activeOverlay('dsk', 1, s.time, s), !!activeOverlay('dsk', 2, s.time, s)]);
  usePod((s) => s.labels); usePod((s) => s.cameras); usePod((s) => s.speakers);
  const setTrans = (patch: Partial<typeof st.trans>) => usePod.setState((s) => ({ trans: { ...s.trans, ...patch } }));
  const rate = (d: number) => `${Math.floor(d)}:${String(Math.round((d % 1) * 30)).padStart(2, '0')}`;
  const busRow = (bus: 'pgm' | 'pvw') => (
    <div className="flex items-center gap-[5px]">
      <div className={`w-[62px] shrink-0 text-[10px] font-bold tracking-[0.06em] ${bus === 'pgm' ? 'text-[#ff6b6b]' : 'text-[#4ee08a]'}`}>{bus === 'pgm' ? 'PROGRAM' : 'PREVIEW'}</div>
      {inputs.map((id, i) => {
        const on = bus === 'pgm' ? pgm === id : pvw === id;
        const gap = i === rec.length && rec.length > 0;
        return (
          <div key={id} className={`flex ${gap ? 'ms-3' : ''}`}>
            <Btn tone={on ? (bus === 'pgm' ? 'red' : 'green') : 'off'} label={`${bus === 'pgm' ? 'Program' : 'Preview'} ${shortName(id)}`} title={longName(id)}
              onClick={() => (bus === 'pgm' ? programCut(id) : setPreview(id))}>
              <span translate="no" className="max-w-[54px] truncate">{shortName(id)}</span>
              {i < 9 && <span className="text-[9px] opacity-60 font-normal">{bus === 'pgm' ? `⇧${i + 1}` : i + 1}</span>}
            </Btn>
          </div>
        );
      })}
    </div>
  );
  const styles: { id: TransStyle; label: string }[] = [{ id: 'mix', label: 'MIX' }, { id: 'dip', label: 'DIP' }, { id: 'wipe', label: 'WIPE' }, { id: 'dve', label: 'DVE' }];
  return (
    <div className="bg-[#1d1f23] border-t border-[#33363c] px-3 py-2.5 flex flex-wrap gap-x-5 gap-y-3 items-start">
      {/* left: SuperSource, transition style */}
      <Group title="SuperSource">
        <div className="grid grid-cols-3 gap-[5px]">
          {([['side2', 'Side by side'], ['grid4', 'Grid 2×2'], ['pip', 'Picture in picture'], ['side3', 'Three'], ['stack2', 'Top / bottom']] as const).map(([l, n]) => (
            <Btn key={l} tone={ss?.preset === l ? 'amber' : 'off'} label={`SuperSource: ${n}`} w={40} h={30} onClick={() => { const id = ssLayout(l); if (id) setPreview(id); }}><LayoutIcon layout={l} /></Btn>
          ))}
          <Btn tone={usePod.getState().videoOut === 'ss' ? 'white' : 'off'} label="EDIT: design the split screen (move, resize, crop, cameras)" w={40} h={30} onClick={() => { if (!activeSS()) ssLayout('side2'); usePod.setState((s) => ({ videoOut: s.videoOut === 'ss' ? 'mv' : 'ss' })); }}>EDIT</Btn>
        </div>
      </Group>
      <div className="flex flex-col gap-2.5 shrink-0">
        <Group title="Transition style">
          <div className="grid grid-cols-2 gap-[5px]">{styles.map((x) => <Btn key={x.id} tone={st.trans.style === x.id ? 'amber' : 'off'} label={x.label} onClick={() => setTrans({ style: x.id })} w={50} h={30}>{x.label}</Btn>)}</div>
        </Group>
      </div>
      {/* buses */}
      <div className="flex flex-col gap-2 shrink-0 pt-[18px] max-w-full overflow-x-auto no-scrollbar">
        {busRow('pgm')}
        {busRow('pvw')}
      </div>
      {/* transition */}
      <Group title="Transition">
        <div className="flex gap-2 items-start">
          <div className="flex flex-col gap-[5px]">
            <Btn tone="white" label="CUT (Space)" onClick={() => performTransition(false)} w={66} h={40}>CUT</Btn>
            <Btn tone="off" label="AUTO (Enter)" onClick={() => performTransition(true)} w={66} h={40}>AUTO</Btn>
            <label className="flex items-center gap-1 text-[10px] text-[#8b9099]" data-tip="Transition rate (seconds:frames)"><span>RATE</span>
              <select className="field h-[20px] text-[11px] w-[54px] px-1" value={String(st.trans.dur)} aria-label="Transition rate" onChange={(e) => setTrans({ dur: Number(e.target.value) })}>
                {[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((d) => <option key={d} value={d}>{rate(d)}</option>)}
              </select>
            </label>
          </div>
          <TBar />
        </div>
      </Group>
      {/* downstream keys */}
      {([0, 1] as const).map((i) => (
        <Group key={i} title={`Logo / DSK ${i + 1}`}>
          <div className="grid grid-cols-2 gap-[5px]">
            <Btn tone={st.dsk[i].tie ? 'amber' : 'off'} label={`DSK ${i + 1} TIE`} onClick={() => setDsk(i, { tie: !st.dsk[i].tie })} w={50} h={34}>TIE</Btn>
            <label className="flex flex-col items-center justify-center text-[9px] text-[#8b9099] w-[50px] h-[34px] rounded-[4px] border border-[#43474e] bg-[#2b2e33]">RATE
              <select className="bg-transparent text-[11px] text-[#d6d9de] w-[44px] text-center" value={String(st.dsk[i].rate)} aria-label={`DSK ${i + 1} rate`} onChange={(e) => setDsk(i, { rate: Number(e.target.value) })}>
                {[0.25, 0.5, 1, 1.5, 2].map((d) => <option key={d} value={d}>{rate(d)}</option>)}
              </select>
            </label>
            <Btn tone={dskOn[i] ? 'red' : 'off'} label={`DSK ${i + 1} ON AIR`} onClick={() => dskCut(i)} w={50} h={34}>ON AIR</Btn>
            <Btn tone="off" label={`DSK ${i + 1} AUTO`} onClick={() => dskAuto(i)} w={50} h={34}>AUTO</Btn>
          </div>
        </Group>
      ))}
    </div>
  );
}

