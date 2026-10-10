import { useRef, useState } from 'react';
import {
  usePod, addCamera, replaceCameraFile, removeCamera, setCameraRole, moveCamera, addSpeaker, removeSpeaker, renameSpeaker, setSpeakerMic, removeSpeakerMic,
  addBroll, removeBroll, setOffset, analyze, cancelAnalysis, camsReady, swapSpeakers, assignVoice, setPacing, setSettings, regenerate, type MasterAudio,
  addSplit, applySplitPreset, removeSplit, setSoundSettings,
} from '../store';
import { drawInputTo, frameListeners, elementFor } from '../player';
import { type SplitLayout } from '../types';
import { setWorkspace } from '../../state/workspace';
import { useEffect } from 'react';
import { downloadEditPackage, saveEdit, openEdit, sendToMotion, exportRange } from '../exports';
import { recorderFormat } from '../render';
import { useRenderJob, startRender, cancelRender } from '../renderJob';
import { RENDER_FORMATS, type RenderFormat } from '../ffmpeg';
import { FormatBox } from './FormatBox';
import { editStats } from '../autoEdit';
import { camColor, camKey, speakerColor, camName } from '../labels';
import { saveBlob } from '../../file-system/exporters';
import { Checkbox, Section, Segmented, Select, Slider } from '../../components/ui/controls';
import { BROLL_COLOR, type CamRole, type CutTiming, type InsertAmount, type Source } from '../types';
import { SpeakerLabel, CamLabel } from './SpeakerLabel';
import {
  LuUpload, LuX, LuWand, LuArrowLeftRight, LuFilm, LuPackage, LuClapperboard, LuSave, LuFolderOpen, LuMic, LuCircleStop, LuDownload, LuRefreshCw,
  LuPlus, LuChevronUp, LuChevronDown, LuUserPlus, LuVideo, LuImages, LuColumns2,
} from 'react-icons/lu';

const fmtDur = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = Math.floor(s % 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`; };

function pick(accept: string, multiple = false): Promise<File[]> {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.onchange = () => res([...(i.files ?? [])]);
    i.click();
  });
}
const VIDEO = 'video/*,.mov,.mkv,.mts,.m2ts';
const AUDIO = 'audio/*,.wav,.mp3,.m4a,.flac,.aac';

function SyncRow({ src }: { src: Source }) {
  const fps = usePod((s) => s.settings.fps);
  const conf = usePod((s) => s.analysis?.syncConfidence[src.id]);
  return (
    <>
      <div className="flex items-center gap-1 text-2xs text-muted">
        <span className="flex-1">Sync offset</span>
        <button type="button" className="icon-btn !w-5 !h-5 text-xs" aria-label="One frame earlier" onClick={() => setOffset(src.id, src.offset - 1 / fps)}>−</button>
        <span className="num text-ink w-[62px] text-center" dir="ltr">{`${src.offset >= 0 ? '+' : ''}${src.offset.toFixed(3)} s`}</span>
        <button type="button" className="icon-btn !w-5 !h-5 text-xs" aria-label="One frame later" onClick={() => setOffset(src.id, src.offset + 1 / fps)}>+</button>
      </div>
      {conf !== undefined && <div className={`text-2xs ${conf >= 8 ? 'text-ok' : conf >= 5 ? 'text-amber' : 'text-danger'}`}>{conf >= 8 ? 'Synchronised by sound' : conf >= 5 ? 'Synchronised (check by playing)' : 'Sync uncertain — check and adjust'}</div>}
    </>
  );
}

function PeopleBox() {
  const speakers = usePod((s) => s.speakers);
  const sources = usePod((s) => s.sources);
  return (
    <div className="flex flex-col gap-2">
      {speakers.map((sp, i) => (
        <div key={sp.id} className="rounded-[6px] border border-line bg-[#1f2328] p-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: speakerColor(sp.id) }} aria-hidden />
            <input className="field h-[24px] text-xs flex-1 min-w-0" value={sp.name} placeholder={`Speaker ${i + 1}`} aria-label={`Name of speaker ${i + 1}`} translate="no"
              onChange={(e) => renameSpeaker(sp.id, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            {speakers.length > 2 && <button type="button" className="icon-btn !w-5 !h-5" aria-label="Remove person" data-tip="Remove person" onClick={() => removeSpeaker(sp.id)}><LuX size={12} /></button>}
          </div>
          {sp.mic && sources[sp.mic] ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-xs"><LuMic size={12} className="text-muted shrink-0" /><span className="truncate flex-1 text-ink" translate="no">{sources[sp.mic].name}</span>
                <button type="button" className="icon-btn !w-5 !h-5" aria-label="Remove microphone" onClick={() => removeSpeakerMic(sp.id)}><LuX size={11} /></button></div>
              <SyncRow src={sources[sp.mic]} />
            </div>
          ) : (
            <button type="button" className="text-start text-2xs text-muted hover:text-ink inline-flex items-center gap-1.5" onClick={async () => { const [f] = await pick(AUDIO); if (f) void setSpeakerMic(sp.id, f); }}>
              <LuMic size={12} />Add this person's microphone (optional, most accurate)
            </button>
          )}
        </div>
      ))}
      {speakers.length < 8 && <button type="button" className="btn h-[26px] text-xs inline-flex items-center justify-center gap-1.5" onClick={() => addSpeaker()}><LuUserPlus size={13} />Add person</button>}
    </div>
  );
}

function CameraCard({ id, index, count }: { id: string; index: number; count: number }) {
  const cam = usePod((s) => s.cameras.find((c) => c.id === id)!);
  const src = usePod((s) => s.sources[id]);
  const speakers = usePod((s) => s.speakers);
  if (!cam || !src) return null;
  const value = cam.role === 'speaker' ? `sp:${cam.speaker}` : cam.role;
  const options = [
    ...speakers.map((sp, i) => ({ value: `sp:${sp.id}`, label: sp.name.trim() || `Speaker ${i + 1}` })),
    { value: 'wide', label: 'Wide shot (two-shot / group)' },
    { value: 'insert', label: 'Insert camera (details, hands, table)' },
    ...(speakers.length < 8 ? [{ value: 'new', label: 'New person…' }] : []),
  ];
  return (
    <div className="rounded-[6px] border border-line bg-[#1f2328] p-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[11px] font-bold text-black shrink-0" style={{ background: camColor(id) }} aria-hidden>{camKey(id)}</span>
        <CamLabel id={id} className="font-medium text-ink-strong text-xs flex-1 min-w-0 truncate" />
        <button type="button" className="icon-btn !w-5 !h-5" aria-label="Move up" disabled={index === 0} onClick={() => moveCamera(id, -1)}><LuChevronUp size={12} /></button>
        <button type="button" className="icon-btn !w-5 !h-5" aria-label="Move down" disabled={index === count - 1} onClick={() => moveCamera(id, 1)}><LuChevronDown size={12} /></button>
        <button type="button" className="icon-btn !w-5 !h-5" aria-label="Remove camera" onClick={() => removeCamera(id)}><LuX size={12} /></button>
      </div>
      <label className="flex items-center gap-1.5 text-2xs text-muted"><span className="shrink-0">Shows</span>
        <select className="field h-[22px] text-xs flex-1 min-w-0" value={value} aria-label="What this camera shows"
          onChange={(e) => { const v = e.target.value; if (v === 'new') { const sp = addSpeaker(); if (sp) setCameraRole(id, 'speaker', sp); } else if (v.startsWith('sp:')) setCameraRole(id, 'speaker', v.slice(3)); else setCameraRole(id, v as CamRole); }}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <button type="button" className="text-start text-xs text-ink truncate hover:text-accent" onClick={async () => { const [f] = await pick(VIDEO); if (f) void replaceCameraFile(id, f); }} translate="no" data-tip="Replace file">{src.name}</button>
      <div className="text-2xs text-faint num">{fmtDur(src.duration)}{src.width ? ` · ${src.width}×${src.height}` : ''}</div>
      <SyncRow src={src} />
    </div>
  );
}

function CamerasBox() {
  const cams = usePod((s) => s.cameras);
  const [over, setOver] = useState(false);
  const add = async () => { const fs = await pick(VIDEO, true); for (const f of fs) await addCamera(f); };
  return (
    <div className={`flex flex-col gap-2 rounded-[6px] ${over ? 'outline outline-2 outline-accent' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); void (async () => { for (const f of e.dataTransfer.files) await addCamera(f); })(); }}>
      {cams.map((c, i) => <CameraCard key={c.id} id={c.id} index={i} count={cams.length} />)}
      <button type="button" className="w-full h-[46px] rounded-[5px] border border-dashed border-[#4a515c] text-muted hover:text-ink hover:border-accent text-xs flex items-center justify-center gap-1.5" onClick={() => void add()}>
        {cams.length ? <LuPlus size={14} /> : <LuUpload size={14} />}<span>{cams.length ? 'Add camera' : 'Add the camera videos (3 or more)'}</span>
      </button>
      {cams.length > 0 && <div className="text-2xs text-faint">Choose what each camera shows. A person can have several cameras (medium, close-up) — the edit changes angles.</div>}
    </div>
  );
}

function BrollBox() {
  const broll = usePod((s) => s.broll);
  const sources = usePod((s) => s.sources);
  return (
    <div className="flex flex-col gap-1.5">
      {broll.map((id) => sources[id] && (
        <div key={id} className="flex items-center gap-1.5 text-xs rounded-[5px] bg-[#1f2328] border border-line-soft px-2 py-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BROLL_COLOR }} aria-hidden />
          <span className="truncate flex-1 text-ink" translate="no">{sources[id].name}</span>
          <span className="text-2xs text-faint num">{fmtDur(sources[id].duration)}</span>
          <button type="button" className="icon-btn !w-5 !h-5" aria-label="Remove clip" onClick={() => removeBroll(id)}><LuX size={11} /></button>
        </div>
      ))}
      <button type="button" className="btn h-[26px] text-xs inline-flex items-center justify-center gap-1.5" onClick={async () => { const fs = await pick(VIDEO, true); if (fs.length) void addBroll(fs); }}>
        <LuImages size={13} />Add B-roll clips
      </button>
      <div className="text-2xs text-faint">Extra footage (places, objects, archive). Inserts are placed automatically inside long answers, with the conversation sound continuing.</div>
    </div>
  );
}

const LAYOUTS: { value: SplitLayout; label: string }[] = [
  { value: 'side2', label: 'Side by side (2)' }, { value: 'cropped2', label: 'Two boxes' }, { value: 'stack2', label: 'Top and bottom (2)' }, { value: 'side3', label: 'Three side by side' },
  { value: 'grid4', label: 'Grid 2 × 2' }, { value: 'pip', label: 'Picture in picture' }, { value: 'pip2', label: 'Two small boxes' },
];

function SplitPreview({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => { const c = ref.current; if (!c) return; const o = usePod.getState().output; c.width = 320; c.height = Math.round(320 * o.height / o.width); drawInputTo(c, id); };
    for (const b of usePod.getState().splits.find((x) => x.id === id)?.boxes ?? []) if (b.cam) { const el = elementFor(b.cam); el?.addEventListener('loadeddata', draw, { once: true }); }
    draw(); frameListeners.add(draw);
    const un = usePod.subscribe((s, p) => { if (s.splits !== p.splits || s.output !== p.output) draw(); });
    const t = setInterval(draw, 1000);
    return () => { frameListeners.delete(draw); un(); clearInterval(t); };
  }, [id]);
  return <canvas ref={ref} className="w-full rounded-[4px] bg-black" aria-label="Split screen preview" />;
}

function SplitBox() {
  const splits = usePod((s) => s.splits);
  const cams = usePod((s) => s.cameras);
  usePod((s) => s.speakers);
  return (
    <div className="flex flex-col gap-2">
      {splits.map((sp) => (
        <div key={sp.id} className="rounded-[6px] border border-line bg-[#1f2328] p-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <CamLabel id={sp.id} className="font-medium text-ink-strong text-xs flex-1 truncate" />
            <span className="text-2xs text-faint">{`Input ${camKey(sp.id)}`}</span>
            <button type="button" className="icon-btn !w-5 !h-5" aria-label="Remove split screen" onClick={() => removeSplit(sp.id)}><LuX size={12} /></button>
          </div>
          <SplitPreview id={sp.id} />
          <select className="field h-[22px] text-xs" value="" aria-label="Split screen layout" onChange={(e) => { if (e.target.value) applySplitPreset(sp.id, e.target.value as SplitLayout); }}>
            <option value="">Layout…</option>
            {LAYOUTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="text-2xs text-faint">{sp.boxes.filter((b) => b.on && b.cam).map((b) => camName(b.cam!)).join(' · ')}</div>
        </div>
      ))}
      <div className="flex gap-1.5">
        <button type="button" className="btn flex-1 h-[26px] text-xs inline-flex items-center justify-center gap-1.5" disabled={cams.length < 2} onClick={() => addSplit('side2')}><LuColumns2 size={13} />Add split screen</button>
        <button type="button" className="btn h-[26px] text-xs px-2" onClick={() => setWorkspace('mixer')} data-tip="Design split screens freely (SuperSource) in the vision mixer">Design…</button>
      </div>
      <div className="text-2xs text-faint">A split screen becomes an input like a camera. The automatic edit uses a split showing two people for their quick back-and-forth and when they talk at once. Move, resize and crop its boxes freely in the vision mixer (SuperSource).</div>
    </div>
  );
}

function AnalysisBox() {
  const phase = usePod((s) => s.phase);
  const progress = usePod((s) => s.progress);
  const message = usePod((s) => s.message);
  const an = usePod((s) => s.analysis);
  const ready = usePod((s) => camsReady(s));
  const check = usePod((s) => s.pictureCheck);
  const speakers = usePod((s) => s.speakers);
  const segs = usePod((s) => s.segments);
  const busy = phase === 'decoding' || phase === 'syncing' || phase === 'speakers' || phase === 'checking';
  const label = phase === 'decoding' ? 'Reading the sound of each recording…' : phase === 'syncing' ? 'Synchronising the cameras…' : phase === 'speakers' ? 'Finding who speaks when…' : phase === 'checking' ? 'Checking which person is on which camera…' : '';
  const talk = an ? editStats(segs, an).talk : {};
  return (
    <div className="flex flex-col gap-2">
      {!busy && (
        <button type="button" className="btn btn-primary h-[32px] inline-flex items-center justify-center gap-2" disabled={!ready} onClick={() => void analyze()}>
          <LuWand size={15} />{an && !an.stub ? 'Analyse again' : 'Analyse & edit automatically'}
        </button>
      )}
      {!ready && <div className="text-2xs text-faint">Add at least two cameras to start (best: one per person + a wide shot).</div>}
      {busy && (
        <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
          <div className="text-xs text-ink">{label}</div>
          {message && <div className="text-2xs text-faint truncate" translate="no">{message}</div>}
          <div className="h-1.5 rounded-full bg-[#1a1d21] overflow-hidden"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <button type="button" className="btn self-start h-[24px] text-xs" onClick={cancelAnalysis}>Cancel</button>
        </div>
      )}
      {an && !an.stub && !busy && (
        <div className="rounded-[6px] bg-[#1f2328] border border-line-soft p-2 flex flex-col gap-1.5 text-xs">
          <div className="text-2xs text-muted">Voices found</div>
          {an.speakers.map((spId, v) => (
            <div key={v} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: speakerColor(spId) }} />
              <span className="text-faint shrink-0 num">{`${Math.round((talk[spId] ?? 0) * 100)}%`}</span>
              <span className="text-muted shrink-0">{`Voice ${v + 1} is`}</span>
              <select className="field h-[22px] text-xs flex-1 min-w-0" value={spId} aria-label={`Who is voice ${v + 1}`} onChange={(e) => assignVoice(v, e.target.value)}>
                {speakers.map((sp, i) => <option key={sp.id} value={sp.id}>{sp.name.trim() || `Speaker ${i + 1}`}</option>)}
              </select>
            </div>
          ))}
          {check && <div className="text-2xs text-faint">{check.changed ? 'Voices were matched to the people by picture movement (re-assigned).' : 'Voices matched to the people by picture movement.'}</div>}
          <div className={`text-2xs ${an.separation >= 4 ? 'text-ok' : an.separation >= 2.5 ? 'text-amber' : 'text-danger'}`}>{an.separation >= 4 ? 'Voices clearly separated' : an.separation >= 2.5 ? 'Voices partly separated' : 'Voices hard to separate — add microphone recordings'}</div>
          {an.speakers.length === 2 && (
            <button type="button" className="btn h-[24px] text-xs inline-flex items-center justify-center gap-1.5" onClick={swapSpeakers} data-tip="Use this if the edit shows the listener instead of the speaker">
              <LuArrowLeftRight size={13} />Swap speakers
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StyleBox() {
  const st = usePod((s) => s.settings);
  const an = usePod((s) => s.analysis);
  const edited = usePod((s) => s.edited);
  const hasInserts = usePod((s) => s.broll.length > 0 || s.cameras.some((c) => c.role === 'insert'));
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2"><span className="text-muted">Pacing</span>
        <Segmented value={st.pacing} onChange={setPacing} options={[{ value: 'calm', label: 'Calm', title: 'Calm: long shots, few cuts (interviews, documentaries)' }, { value: 'balanced', label: 'Balanced', title: 'Balanced: standard podcast pacing' }, { value: 'dynamic', label: 'Dynamic', title: 'Dynamic: quick cuts (social media clips)' }]} />
      </div>
      <div className="flex items-center justify-between gap-2"><span className="text-muted">Cut timing</span>
        <Select<CutTiming> title="Cut timing" value={st.cutTiming} onChange={(v) => setSettings({ cutTiming: v })} options={[{ value: 'pause', label: 'In the pause (classic)' }, { value: 'onset', label: 'On the first word' }, { value: 'late', label: 'After the first word (J-cut)' }]} />
      </div>
      <Slider label="Shortest shot" value={st.minShot} min={0.6} max={6} step={0.1} precision={1} unit="s" onChange={(v) => setSettings({ minShot: v })} />
      <Slider label="Longest speaker shot" value={st.maxShot} min={4} max={60} step={1} unit="s" onChange={(v) => setSettings({ maxShot: v })} />
      <Slider label="Ignore short replies under" value={st.minTurn} min={0.3} max={4} step={0.1} precision={1} unit="s" onChange={(v) => setSettings({ minTurn: v })} />
      <Slider label="Wide shot after silence of" value={st.wideOnSilence} min={1} max={10} step={0.5} precision={1} unit="s" onChange={(v) => setSettings({ wideOnSilence: v })} />
      <Slider label="Opening wide shot" value={st.openingWide} min={0} max={15} step={0.5} precision={1} unit="s" onChange={(v) => setSettings({ openingWide: v })} />
      <Slider label="Closing wide shot" value={st.closingWide} min={0} max={15} step={0.5} precision={1} unit="s" onChange={(v) => setSettings({ closingWide: v })} />
      <Checkbox checked={st.wideOnCrosstalk} onChange={(v) => setSettings({ wideOnCrosstalk: v })} label="Wide shot when several talk at once" />
      <Checkbox checked={st.reactions} onChange={(v) => setSettings({ reactions: v })} label="Listener reaction shots" />
      <Checkbox checked={st.wideCutaways} onChange={(v) => setSettings({ wideCutaways: v })} label="Wide cutaways in long answers" />
      <Checkbox checked={st.angles} onChange={(v) => setSettings({ angles: v })} label="Change angles (people with several cameras)" />
      <Checkbox checked={st.splitDialog} onChange={(v) => setSettings({ splitDialog: v })} label="Split screen for quick exchanges between two people" />
      <div className="flex items-center justify-between gap-2"><span className="text-muted">Inserts / B-roll</span>
        <Segmented<InsertAmount> value={st.inserts} onChange={(v) => setSettings({ inserts: v })} options={[{ value: 'off', label: 'Off', title: 'No inserts' }, { value: 'few', label: 'Few', title: 'Few inserts (about every 45 s of talk)' }, { value: 'normal', label: 'Normal', title: 'Inserts about every 25 s of talk' }, { value: 'many', label: 'Many', title: 'Many inserts (about every 14 s of talk)' }]} />
      </div>
      {!hasInserts && st.inserts !== 'off' && <div className="text-2xs text-faint">Add B-roll clips or an insert camera to use inserts.</div>}
      {st.inserts !== 'off' && <Slider label="Insert length" value={st.insertLen} min={1.5} max={8} step={0.5} precision={1} unit="s" onChange={(v) => setSettings({ insertLen: v })} />}
      <div className="flex items-center justify-between gap-2"><span className="text-muted">Frame rate</span>
        <Select title="Frame rate" value={String(st.fps)} onChange={(v) => setSettings({ fps: Number(v) })} options={['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'].map((f) => ({ value: f, label: `${f} fps` }))} />
      </div>
      {an && !an.stub && (
        <button type="button" className="btn h-[26px] text-xs inline-flex items-center justify-center gap-1.5" onClick={() => { if (!edited || window.confirm('Re-create the edit? Your manual changes will be replaced (you can undo).')) regenerate(); }}>
          <LuRefreshCw size={13} />Re-create the edit
        </button>
      )}
    </div>
  );
}

function StatsBox() {
  const segs = usePod((s) => s.segments);
  const an = usePod((s) => s.analysis);
  usePod((s) => s.cameras);
  if (!segs.length) return <div className="text-2xs text-faint">The numbers of the edit appear here.</div>;
  const st = editStats(segs, an);
  const pc = (v: number) => `${Math.round((v ?? 0) * 100)}%`;
  const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-2 text-xs"><span className="text-muted">{k}</span><span className="num text-ink">{v}</span></div>;
  const shares = Object.entries(st.share).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-col gap-1">
      <Row k="Shots" v={String(st.shots)} />
      <Row k="Average shot length" v={`${st.asl.toFixed(1)} s`} />
      <Row k="Cuts per minute" v={st.cutsPerMinute.toFixed(1)} />
      <div className="flex h-2 rounded-full overflow-hidden mt-1" aria-label="Screen time per camera">
        {shares.map(([id, v]) => <div key={id} style={{ width: pc(v), background: camColor(id) }} data-tip={camName(id)} />)}
      </div>
      <div className="flex flex-col gap-0.5 mt-1">
        {shares.map(([id, v]) => <div key={id} className="flex items-center gap-1.5 text-2xs text-faint"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: camColor(id) }} /><CamLabel id={id} short className="flex-1 truncate" /><span className="num">{pc(v)}</span></div>)}
      </div>
      {an && <div className="text-2xs text-faint mt-1 flex flex-wrap gap-x-2"><span>Talk time</span>{an.speakers.map((id) => <span key={id}><SpeakerLabel id={id} />{` ${pc(st.talk[id])}`}</span>)}</div>}
    </div>
  );
}

function ExportBox() {
  const out = usePod((s) => s.output);
  const master = usePod((s) => s.master);
  const audioMode = usePod((s) => s.settings.audioMode);
  const duck = usePod((s) => s.settings.duckDb);
  const sources = usePod((s) => s.sources);
  const cams = usePod((s) => s.cameras);
  const speakers = usePod((s) => s.speakers);
  const segs = usePod((s) => s.segments);
  const inP = usePod((s) => s.inPoint), outP = usePod((s) => s.outPoint);
  const jobP = useRenderJob((s) => s.p);
  const job = jobP === null ? null : { p: jobP, cancel: cancelRender };
  const last = useRenderJob((s) => s.last);
  const renderFormat = usePod((s) => s.renderFormat);
  const openRef = useRef<HTMLInputElement>(null);
  const fmt = recorderFormat();
  const has = segs.length > 0;
  const size = `${out.width}x${out.height}`;
  const setOut = (p: Partial<typeof out>) => usePod.setState((s) => ({ output: { ...s.output, ...p } }));
  const masterOpts: { value: MasterAudio; label: string }[] = [{ value: 'auto', label: 'Automatic' }];
  if (speakers.some((x) => x.mic)) masterOpts.push({ value: 'mics', label: 'All microphones' });
  for (const c of cams) if (sources[c.id]) masterOpts.push({ value: c.id, label: camName(c.id) });
  const range = exportRange();
  const render = () => startRender();
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2"><span className="text-muted">Size</span><span className="num text-ink text-xs">{`${size.replace('x', ' × ')} (Format & framing)`}</span></div>
      <div className="flex items-center justify-between gap-2"><span className="text-muted">File type</span>
        <Select<RenderFormat> title="File type" value={renderFormat} onChange={(v) => usePod.setState({ renderFormat: v })} options={RENDER_FORMATS.map((f) => ({ value: f.id, label: f.label }))} />
      </div>
      <div className="flex items-center justify-between gap-2"><span className="text-muted">Quality</span>
        <Segmented value={out.quality} onChange={(v) => setOut({ quality: v })} options={[{ value: 'high', label: 'High', title: 'High quality' }, { value: 'medium', label: 'Medium', title: 'Medium quality' }, { value: 'small', label: 'Small', title: 'Small file' }]} />
      </div>
      <div className="flex items-center justify-between gap-2"><span className="text-muted">Sound</span>
        <Segmented<'speaker' | 'master' | 'picture'> value={audioMode} onChange={(v) => setSoundSettings({ audioMode: v })} options={[{ value: 'speaker', label: 'Speaker', title: 'Only the person speaking is heard (automix)' }, { value: 'picture', label: 'Picture', title: 'The sound of what is on screen: cuts with the picture (J / L cuts on the Sound lane)' }, { value: 'master', label: 'Master', title: 'One master track for the whole edit' }]} />
      </div>
      {audioMode === 'speaker' ? (
        <div className="flex items-center justify-between gap-2"><span className="text-muted">Others while one speaks</span>
          <Select title="Others while one speaks" value={String(duck)} onChange={(v) => setSoundSettings({ duckDb: Number(v) })} options={[{ value: '-60', label: 'Off' }, { value: '-24', label: '−24 dB' }, { value: '-15', label: '−15 dB' }, { value: '-9', label: '−9 dB' }]} />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2"><span className="text-muted">Master track</span>
          <Select<MasterAudio> title="Master track" value={master} onChange={(v) => usePod.setState({ master: v })} options={masterOpts} />
        </div>
      )}
      <div className="text-2xs text-faint">{inP !== null || outP !== null ? `Range ${fmtDur(range.start)} – ${fmtDur(range.end)} (I / O keys)` : 'Whole recording · set a range with I and O'}</div>
      {job ? (
        <div className="flex flex-col gap-1.5" role="status">
          <div className="text-xs">{`Rendering… ${Math.round(job.p * 100)}%`}</div>
          <div className="h-1.5 rounded-full bg-[#1a1d21] overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.round(job.p * 100)}%` }} /></div>
          <div className="text-2xs text-faint">Rendering plays the edit in real time. Keep this tab open and visible.</div>
          <button type="button" className="btn self-start h-[24px] text-xs inline-flex items-center gap-1.5" onClick={job.cancel}><LuCircleStop size={13} />Cancel</button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary h-[30px] inline-flex items-center justify-center gap-2" disabled={!has || !fmt} onClick={() => void render()}>
          <LuFilm size={15} />{fmt ? `Render video (${renderFormat.toUpperCase()})` : 'Video rendering needs Chrome or Edge'}
        </button>
      )}
      {last && !job && <button type="button" className="btn h-[26px] text-xs inline-flex items-center justify-center gap-1.5" onClick={() => void saveBlob(last.blob, last.name)}><LuDownload size={13} />Download again</button>}
      <button type="button" className="btn h-[28px] text-xs inline-flex items-center justify-center gap-1.5" disabled={!has} onClick={() => void downloadEditPackage()} data-tip="XML + EDL + shot list + edit report">
        <LuPackage size={14} />Edit for Premiere / DaVinci (.zip)
      </button>
      <button type="button" className="btn h-[28px] text-xs inline-flex items-center justify-center gap-1.5" disabled={!has} onClick={() => void sendToMotion()} data-tip="Add titles, lower thirds and graphics in Motion">
        <LuClapperboard size={14} />Send to Motion
      </button>
      <div className="flex gap-1.5">
        <button type="button" className="btn flex-1 h-[26px] text-xs inline-flex items-center justify-center gap-1.5" disabled={!has} onClick={() => void saveEdit()}><LuSave size={13} />Save edit</button>
        <button type="button" className="btn flex-1 h-[26px] text-xs inline-flex items-center justify-center gap-1.5" onClick={() => openRef.current?.click()}><LuFolderOpen size={13} />Open edit</button>
        <input ref={openRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openEdit(f); }} />
      </div>
    </div>
  );
}

export function SetupPanel() {
  const nCams = usePod((s) => s.cameras.length);
  const nBroll = usePod((s) => s.broll.length);
  const nSplit = usePod((s) => s.splits.length);
  return (
    <div className="flex flex-col">
      <Section title="1 · People"><PeopleBox /></Section>
      <Section title="2 · Cameras" right={<span className="text-2xs text-faint num inline-flex items-center gap-1"><LuVideo size={11} />{nCams}</span>}><CamerasBox /></Section>
      <Section title="Split screens" defaultOpen={false} right={nSplit ? <span className="text-2xs text-faint num">{nSplit}</span> : undefined}><SplitBox /></Section>
      <Section title="Inserts / B-roll" defaultOpen={false} right={nBroll ? <span className="text-2xs text-faint num">{nBroll}</span> : undefined}><BrollBox /></Section>
      <Section title="3 · Analyse"><AnalysisBox /></Section>
      <Section title="4 · Editing style"><StyleBox /></Section>
      <Section title="Edit numbers" defaultOpen={false}><StatsBox /></Section>
      <Section title="Format · Reels & framing" defaultOpen={false}><FormatBox /></Section>
      <Section title="5 · Export"><ExportBox /></Section>
    </div>
  );
}
