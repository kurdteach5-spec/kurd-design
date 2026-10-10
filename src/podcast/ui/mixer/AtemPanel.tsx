// Hardware-style switcher panel modelled on a compact live-production switcher (one button per input,
// CUT / AUTO / FTB, picture in picture, SuperSource, effect, duration, video out, record / render and an audio
// section). Inputs grow with the cameras, split screens and B-roll clips.
import { useEffect, useState, type ReactNode } from 'react';
import { usePod, segmentAt, inputsOf, setAudioIn, type AudioMode } from '../../store';
import { programCut, setPreview, previewOf, performTransition, liveTrans, liveListeners, pipCorner, pipCornerOf, keySet, activeOverlay, ftb, ssLayout, ssOn, activeSS, useSS, type Corner } from '../../mixer';
import { play, pause } from '../../player';
import { useRenderJob, startRender, cancelRender } from '../../renderJob';
import { suggestedInput } from '../../advisor';
import { toastError } from '../../../state/uiStore';
import { shortName, longName } from '../../labels';
import { Logo } from '../../../components/dialogs/EditDialogs';
import { useWindowSize } from '../../../utils/useWindowSize';
import type { TransParams } from '../../types';

type Lit = 'off' | 'red' | 'white' | 'green';
const SMALL: Record<Lit, string> = {
  off: 'border-[#6d7075]',
  red: 'border-[#ff3b30] shadow-[0_0_10px_rgba(255,59,48,.65),inset_0_0_6px_rgba(255,59,48,.35)]',
  white: 'border-[#f4fbff] shadow-[0_0_10px_rgba(220,240,255,.75),inset_0_0_6px_rgba(220,240,255,.3)]',
  green: 'border-[#34d158] shadow-[0_0_10px_rgba(52,209,88,.6)]',
};
// text colours inline: the base stylesheet's `button { color: inherit }` would win over utility classes
const SMALL_INK: Record<Lit, string> = { off: '#e9e9ea', red: '#ff4b40', white: '#ffffff', green: '#4ee070' };
const U = 40; // small button width
const GAP = 6;

function S({ lit = 'off', onClick, children, label, disabled, w = U }: { lit?: Lit; onClick: () => void; children: ReactNode; label: string; disabled?: boolean; w?: number }) {
  return (
    <button type="button" aria-label={label} data-tip={label} disabled={disabled} onClick={onClick} aria-pressed={lit !== 'off'}
      className={`shrink-0 h-[22px] rounded-[5px] border-2 bg-gradient-to-b from-[#333336] to-[#232325] text-[9px] font-bold tracking-[0.02em] whitespace-nowrap leading-none flex items-center justify-center select-none active:translate-y-[1px] disabled:opacity-30 ${SMALL[lit]}`}
      style={{ width: w, color: SMALL_INK[lit] }}>
      {children}
    </button>
  );
}

function Big({ lit, onClick, children, label, w, pulse, hint, h = 44 }: { lit: 'off' | 'red' | 'white' | 'green'; onClick: () => void; children: ReactNode; label: string; w: number; pulse?: boolean; hint?: boolean; h?: number }) {
  const cls = lit === 'green'
    ? 'bg-gradient-to-b from-[#3ee07a] to-[#16a34a] shadow-[0_0_18px_rgba(40,210,100,.7),inset_0_1px_0_rgba(255,255,255,.35)]'
    : lit === 'red'
    ? 'bg-gradient-to-b from-[#ff5146] to-[#e5281d] shadow-[0_0_18px_rgba(255,59,48,.75),inset_0_1px_0_rgba(255,255,255,.35)]'
    : lit === 'white'
      ? 'bg-gradient-to-b from-white to-[#e9eef2] shadow-[0_0_18px_rgba(235,245,255,.85),inset_0_1px_0_#fff]'
      : 'bg-gradient-to-b from-[#ececed] to-[#c9cacc] shadow-[0_2px_0_#0a0a0a,inset_0_1px_0_#fff]';
  return (
    <button type="button" aria-label={label} data-tip={label} onClick={onClick} aria-pressed={lit !== 'off'}
      className={`relative shrink-0 rounded-[8px] text-[14px] font-semibold leading-tight flex flex-col items-center justify-center select-none active:translate-y-[2px] ${cls} ${pulse ? 'animate-pulse' : ''} ${hint ? 'ring-[3px] ring-[#f0b400] ring-offset-2 ring-offset-[#151516]' : ''}`}
      style={{ width: w, height: h, color: lit === 'red' ? '#5a0b06' : lit === 'green' ? '#053516' : lit === 'white' ? '#6f757c' : '#2a2b2d' }}>
      {children}
    </button>
  );
}

const Cap = ({ children, w }: { children: ReactNode; w?: number }) => <div className="text-[8.5px] font-bold tracking-[0.04em] text-[#c9cacc] text-center uppercase whitespace-nowrap leading-none" style={{ width: w }}>{children}</div>;

type IconKind = 'wipeH' | 'wipeV' | 'push' | 'iris' | Corner | 'side2' | 'side3' | 'grid4' | 'pip';
function Icon({ kind }: { kind: IconKind }) {
  const box = <rect x="1" y="1" width="22" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />;
  const p: Record<string, ReactNode> = {
    wipeH: <>{box}<rect x="2" y="2" width="9" height="12" fill="currentColor" /></>,
    wipeV: <>{box}<rect x="2" y="2" width="20" height="5" fill="currentColor" /></>,
    push: <><path d="M2 8h8M7 5l3 3-3 3" stroke="currentColor" strokeWidth="1.8" fill="none" /><rect x="13" y="2" width="9" height="12" rx="1.5" fill="currentColor" /></>,
    iris: <>{box}<circle cx="12" cy="8" r="4.5" fill="currentColor" /></>,
    tl: <>{box}<rect x="3" y="3" width="8" height="5" fill="currentColor" /></>,
    tr: <>{box}<rect x="13" y="3" width="8" height="5" fill="currentColor" /></>,
    bl: <>{box}<rect x="3" y="8" width="8" height="5" fill="currentColor" /></>,
    br: <>{box}<rect x="13" y="8" width="8" height="5" fill="currentColor" /></>,
    side2: <>{box}<rect x="3" y="3" width="8" height="10" fill="currentColor" /><rect x="13" y="3" width="8" height="10" fill="currentColor" /></>,
    side3: <>{box}<rect x="3" y="3" width="5" height="10" fill="currentColor" /><rect x="9.5" y="3" width="5" height="10" fill="currentColor" /><rect x="16" y="3" width="5" height="10" fill="currentColor" /></>,
    grid4: <>{box}<rect x="3" y="3" width="8" height="4" fill="currentColor" /><rect x="13" y="3" width="8" height="4" fill="currentColor" /><rect x="3" y="9" width="8" height="4" fill="currentColor" /><rect x="13" y="9" width="8" height="4" fill="currentColor" /></>,
    pip: <>{box}<rect x="3" y="3" width="18" height="10" fill="currentColor" opacity=".45" /><rect x="13" y="8" width="7" height="4.5" fill="currentColor" /></>,
  };
  return <svg width="22" height="15" viewBox="0 0 24 16" aria-hidden>{p[kind]}</svg>;
}

/** sound controls of one source (a camera, or a person's microphone): AFV / RESET, ON / OFF, level */
function AudioCol({ id, mic }: { id: string | null; mic?: string }) {
  const a = usePod((s) => (id ? s.audioIn[id] : undefined));
  const mode: AudioMode = a?.mode ?? 'auto';
  const db = a?.db ?? 0;
  const name = id ? longName(id) : '';
  const dis = !id;
  const set = (m: AudioMode) => id && setAudioIn(id, { mode: mode === m ? 'auto' : m });
  const lvl = `${db > 0 ? '+' : ''}${db} dB`;
  return (
    <div className="flex flex-col" style={{ gap: GAP }}>
      {mic ? (
        <div className="h-[22px] flex items-center justify-between px-0.5"><span className="text-[8.5px] font-bold text-[#c9cacc]">{mic}</span><span className="text-[8.5px] num text-[#8d9096]" dir="ltr">{id ? lvl : ''}</span></div>
      ) : (
        <div className="flex" style={{ gap: GAP }}>
          <S lit={mode === 'afv' ? 'red' : 'off'} disabled={dis} label={`AFV: ${name} is heard only while it is on program (audio follow video)`} onClick={() => set('afv')}>AFV</S>
          <S disabled={dis} label={`RESET: ${name} back to 0 dB and automatic sound (follows the speaker)`} onClick={() => id && setAudioIn(id, { mode: 'auto', db: 0 })}>RESET</S>
        </div>
      )}
      <div className="flex" style={{ gap: GAP }}>
        <S lit={mode === 'on' ? 'red' : 'off'} disabled={dis} label={`ON: ${name} is always heard`} onClick={() => set('on')}>ON</S>
        <S lit={mode === 'off' ? 'white' : 'off'} disabled={dis} label={`OFF: ${name} is muted`} onClick={() => set('off')}>OFF</S>
      </div>
      <div className="flex" style={{ gap: GAP }}>
        <S disabled={dis} label={`Level up (${name}: ${lvl})`} onClick={() => id && setAudioIn(id, { db: db + 2 })}>▲</S>
        <S disabled={dis} label={`Level down (${name}: ${lvl})`} onClick={() => id && setAudioIn(id, { db: db - 2 })}>▼</S>
      </div>
    </div>
  );
}

const SS_LAYOUTS = [['side2', 'Side by side'], ['grid4', 'Grid 2×2'], ['pip', 'Picture in picture'], ['side3', 'Three']] as const;

export function AtemPanel() {
  const rec = usePod((s) => inputsOf(s));
  usePod((s) => s.labels); usePod((s) => s.cameras);
  const splits = usePod((s) => s.splits);
  const pgm = usePod((s) => segmentAt(s.time, s.segments)?.cam ?? null);
  const pvw = usePod((s) => previewOf(s));
  const [live, setLive] = useState(false);
  useEffect(() => { const f = () => setLive(!!liveTrans); liveListeners.add(f); return () => { liveListeners.delete(f); }; }, []);
  const trans = usePod((s) => s.trans);
  const usk = usePod((s) => s.usk);
  const pipOn = usePod((s) => !!activeOverlay('usk', 1, s.time, s));
  const ftbOn = usePod((s) => !!activeOverlay('ftb', 1, s.time, s));
  const playing = usePod((s) => s.playing);
  const vout = usePod((s) => s.videoOut);
  const mics = usePod((s) => s.speakers.filter((x) => x.mic && s.sources[x.mic]).map((x) => x.mic as string));
  const job = useRenderJob((s) => s.p);
  const suggested = usePod((s) => suggestedInput(s));
  useSS((s) => s.active);
  const ss = splits.find((x) => x.id === activeSS()) ?? null;
  const [hint, setHint] = useState(true);
  const [audio, setAudio] = useState(true);
  const stacked = useWindowSize().w < 760; // phones: inputs above, controls below
  const setT = (p: Partial<TransParams>) => usePod.setState((s) => ({ trans: { ...s.trans, ...p } }));
  const colW = U * 2 + GAP; // one input column
  const inputs = rec.length ? rec : ['', '', '', ''];
  const corner = pipOn && usk.type === 'dve' ? pipCornerOf(usk) : null;
  const effect = trans.style === 'mix' ? 'mix' : trans.style === 'dip' ? 'dip' : trans.style === 'dve' ? 'push' : trans.wipe === 'v' ? 'wipeV' : trans.wipe === 'circle' ? 'iris' : 'wipeH';
  const setEffect = (e: string) => {
    if (e === 'mix' || e === 'dip') setT({ style: e });
    else if (e === 'push') setT({ style: 'dve', dveDir: 'left' });
    else setT({ style: 'wipe', wipe: e === 'wipeV' ? 'v' : e === 'iris' ? 'circle' : 'h' });
  };
  const camOf = (id: string) => (usePod.getState().sources[id] && !usePod.getState().broll.includes(id) ? id : null);
  const grid = (cols: number) => ({ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${U}px)`, gap: GAP });
  return (
    <div className="flex flex-col items-center gap-1 py-2 px-2">
      <div className="relative shrink-0 rounded-[22px] p-[5px] bg-gradient-to-b from-[#4a4b4e] to-[#1a1a1b] shadow-[0_12px_30px_rgba(0,0,0,.6)]">
        <div className="rounded-[18px] bg-gradient-to-b from-[#1e1e20] to-[#121213] px-5 pt-2.5 pb-3.5 flex flex-col gap-2.5" dir="ltr">
          {/* name plate, record and render */}
          <div className="flex items-center gap-3">
            <div className="text-[15px] text-[#f1f1f1] tracking-[0.01em] whitespace-nowrap"><span className="font-semibold">KURD</span> <span className="font-light">Mixer Pro</span></div>
            <S lit={audio ? 'white' : 'off'} w={50} label={audio ? 'Hide the audio buttons (slimmer panel)' : 'Show the audio buttons'} onClick={() => setAudio(!audio)}>AUDIO</S>
            <div className="flex-1" />
            <div className="flex items-center gap-1 text-[8px] font-bold text-[#c9cacc]"><span className={`w-[6px] h-[6px] rounded-[1px] ${playing ? 'bg-[#ff3b30] shadow-[0_0_6px_#ff3b30]' : 'bg-[#5a1a17]'}`} />LIVE</div>
            <S lit={playing ? 'red' : 'off'} label="REC: play and record your switching live on the timeline" onClick={() => { if (!usePod.getState().segments.length) { toastError('Add cameras first.'); return; } play(); }}>REC</S>
            <S label="STOP" onClick={pause}>STOP</S>
            <div className="w-px h-4 bg-[#3a3b3e]" />
            <S lit={job !== null ? 'red' : 'off'} w={62} label="RENDER: make the video file of the program now" onClick={() => void startRender()}>{job !== null ? `${Math.round(job * 100)}%` : 'RENDER'}</S>
            {job !== null && <S label="Stop rendering" onClick={cancelRender}>OFF</S>}
            <div className="flex items-center gap-1.5 text-[10px] text-[#bdbec2] ms-1"><Logo size={15} /></div>
          </div>
          <div className={stacked ? 'flex flex-col gap-3 items-start' : 'flex gap-6 items-end'}>
            {/* ---------- left: audio + inputs ---------- */}
            <div className="flex flex-col" style={{ gap: GAP * 2 }}>
              {audio && (
                <div className="flex items-end" style={{ gap: GAP * 2 }}>
                  {inputs.map((id, i) => <div key={id || i} style={{ width: colW }}><AudioCol id={id ? camOf(id) : null} /></div>)}
                  {mics.slice(0, 2).map((m, i) => <div key={`m${i}`} style={{ width: colW }}><AudioCol id={m} mic={`MIC ${i + 1}`} /></div>)}
                </div>
              )}
              {(['pgm', 'pvw'] as const).map((bus) => (
                <div key={bus} className="flex items-center" style={{ gap: GAP * 2 }}>
                  {inputs.map((id, i) => {
                    const on = !!id && (bus === 'pgm' ? pgm === id : pvw === id);
                    return (
                      <Big key={id || i} w={colW} h={40} hint={bus === 'pvw' && !!id && suggested === id} lit={on ? (bus === 'pgm' ? 'red' : 'green') : 'off'}
                        label={id ? `${bus === 'pgm' ? 'Program' : 'Preview'} ${i + 1}: ${longName(id)}` : `Input ${i + 1} (add a camera)`}
                        onClick={() => (!id ? toastError('Add cameras first.') : bus === 'pgm' ? programCut(id) : setPreview(id))}>
                        <span>{i + 1}</span>
                        {id && <span className="text-[8.5px] font-medium opacity-70 max-w-[80px] truncate" translate="no">{shortName(id)}</span>}
                      </Big>
                    );
                  })}
                  <div className="flex flex-col items-center" style={{ gap: 4 }}>
                    {([['mp1', 'STILL', 'STILL (media player 1)'], ['blk', 'BLACK', 'BLACK']] as const).map(([v, t, l]) => {
                      const on = bus === 'pgm' ? pgm === v : pvw === v;
                      return <button key={v} type="button" className={`w-[40px] h-[17px] rounded-[4px] text-[8px] font-bold ${on ? (bus === 'pgm' ? 'bg-[#ff4136] shadow-[0_0_12px_rgba(255,59,48,.7)]' : 'bg-[#2fd36a] shadow-[0_0_12px_rgba(40,210,100,.7)]') : 'bg-gradient-to-b from-[#d9d9db] to-[#b5b6b8]'}`} style={{ color: on ? '#2a0603' : '#2a2b2d' }} aria-label={`${bus === 'pgm' ? 'Program' : 'Preview'} ${l}`} data-tip={`${bus === 'pgm' ? 'Program' : 'Preview'}: ${l}`} onClick={() => (bus === 'pgm' ? programCut(v) : setPreview(v))}>{t}</button>;
                    })}
                  </div>
                  <div className={`text-[8.5px] font-bold tracking-[0.06em] w-[52px] ${bus === 'pgm' ? 'text-[#ff6b6b]' : 'text-[#4ee08a]'}`}>{bus === 'pgm' ? 'PROGRAM' : 'PREVIEW'}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-6 items-end">
            {/* ---------- middle: duration, effect, video out over CUT / AUTO / FTB ---------- */}
            <div className="flex flex-col" style={{ gap: GAP * 2 }}>
              <div className="flex items-end" style={{ gap: GAP * 2 }}>
                <div className="flex flex-col" style={{ gap: 5 }}>
                  <div style={grid(2)}>
                    {[0.5, 1, 1.5, 2].map((d) => <S key={d} lit={trans.dur === d ? 'white' : 'off'} label={`Duration ${d.toFixed(1)} s`} onClick={() => setT({ dur: d })}>{d.toFixed(1)}</S>)}
                  </div>
                  <Cap w={colW}>Duration</Cap>
                </div>
                <div className="flex flex-col" style={{ gap: 5 }}>
                  <div style={grid(2)}>
                    {(['wipeH', 'wipeV', 'push', 'iris'] as const).map((e) => <S key={e} lit={effect === e ? 'white' : 'off'} label={{ wipeH: 'Wipe left to right', wipeV: 'Wipe top to bottom', push: 'DVE push', iris: 'Circle wipe' }[e]} onClick={() => setEffect(e)}><Icon kind={e} /></S>)}
                    <S lit={effect === 'mix' ? 'white' : 'off'} label="MIX (dissolve)" onClick={() => setEffect('mix')}>MIX</S>
                    <S lit={effect === 'dip' ? 'white' : 'off'} label="DIP (through a colour)" onClick={() => setEffect('dip')}>DIP</S>
                  </div>
                  <Cap w={colW}>Effect</Cap>
                </div>
                <div className="flex flex-col" style={{ gap: 5 }}>
                  <div style={grid(2)}>
                    {[0, 1, 2, 3].map((i) => <S key={i} lit={rec[i] && vout === rec[i] ? 'white' : 'off'} disabled={!rec[i]} label={`Video out: input ${i + 1}`} onClick={() => usePod.setState({ videoOut: rec[i] })}>{i + 1}</S>)}
                    <S lit={vout === 'mv' ? 'white' : 'off'} label="Video out: multiview" onClick={() => usePod.setState({ videoOut: 'mv' })}>M/V</S>
                    <S lit={vout === 'pgm' ? 'white' : 'off'} label="Video out: program" onClick={() => usePod.setState({ videoOut: 'pgm' })}>PGM</S>
                  </div>
                  <Cap w={colW}>Video out</Cap>
                </div>
              </div>
              <div className="flex" style={{ gap: GAP * 2 }}>
                <Big w={colW} lit="white" label="CUT: preview to program" onClick={() => performTransition(false)}>CUT</Big>
                <Big w={colW} lit={live ? 'red' : 'off'} label="AUTO: preview to program with the effect" onClick={() => performTransition(true)}>AUTO</Big>
                <Big w={colW} lit={ftbOn ? 'red' : 'off'} pulse={ftbOn} label="FTB: fade to black" onClick={ftb}>FTB</Big>
              </div>
            </div>
            {/* ---------- right: picture in picture over SuperSource ---------- */}
            <div className="flex flex-col" style={{ gap: GAP * 2 }}>
              <div className="flex flex-col" style={{ gap: 5 }}>
                <div style={grid(3)}>
                  <S lit={corner === 'tl' ? 'white' : 'off'} label="Picture in picture: top left" onClick={() => pipCorner('tl')}><Icon kind="tl" /></S>
                  <S lit={corner === 'tr' ? 'white' : 'off'} label="Picture in picture: top right" onClick={() => pipCorner('tr')}><Icon kind="tr" /></S>
                  <S lit={pipOn ? 'red' : 'off'} label="Picture in picture ON" onClick={() => keySet(true, true)}>ON</S>
                  <S lit={corner === 'bl' ? 'white' : 'off'} label="Picture in picture: bottom left" onClick={() => pipCorner('bl')}><Icon kind="bl" /></S>
                  <S lit={corner === 'br' ? 'white' : 'off'} label="Picture in picture: bottom right" onClick={() => pipCorner('br')}><Icon kind="br" /></S>
                  <S lit={!pipOn ? 'white' : 'off'} label="Picture in picture OFF" onClick={() => keySet(false)}>OFF</S>
                </div>
                <Cap>Picture in picture</Cap>
              </div>
              <div className="flex flex-col" style={{ gap: 5 }}>
                <div style={grid(3)}>
                  {SS_LAYOUTS.slice(0, 2).map(([l, n]) => <S key={l} lit={ss?.preset === l ? 'white' : 'off'} label={`SuperSource: ${n}`} onClick={() => ssLayout(l)}><Icon kind={l} /></S>)}
                  <S lit={ss && pgm === ss.id ? 'red' : 'off'} label="SuperSource ON: put the split screen on program" onClick={ssOn}>ON</S>
                  {SS_LAYOUTS.slice(2).map(([l, n]) => <S key={l} lit={ss?.preset === l ? 'white' : 'off'} label={`SuperSource: ${n}`} onClick={() => ssLayout(l)}><Icon kind={l} /></S>)}
                  <S lit={vout === 'ss' ? 'white' : 'off'} label="EDIT: design the split screen (move, resize, crop, cameras)" onClick={() => { if (!activeSS()) ssLayout('side2'); usePod.setState({ videoOut: usePod.getState().videoOut === 'ss' ? 'mv' : 'ss' }); }}>EDIT</S>
                </div>
                <Cap>SuperSource</Cap>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>
      {hint && (
        <div className="text-2xs text-faint flex items-center gap-2 max-w-[900px] text-center">
          <span>{`Choose the next camera on the green PREVIEW row, then press CUT (straight) or AUTO (${trans.style.toUpperCase()} ${trans.dur} s). The red PROGRAM row cuts at once.`}</span>
          <button type="button" className="icon-btn !w-4 !h-4 text-[10px]" aria-label="Hide hint" onClick={() => setHint(false)}>×</button>
        </div>
      )}
    </div>
  );
}
