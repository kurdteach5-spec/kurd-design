import { useEffect, useRef, useState } from 'react';
import { useMotion, activeComp } from '../store';
import { exportComposition, FORMAT_INFO, hasWebCodecs, type ExportFormat, type ExportSettings } from '../export/render';
import { useMotionUI } from '../uiState';
import { saveBlob } from '../../file-system/exporters';
import { toast, toastError } from '../../state/uiStore';
import { formatTimecode } from '../anim';
import { FPS_OPTIONS } from '../factory';
import { formatBytes } from '../../utils/id';
import { pause } from '../media/playback';
import { Checkbox, Select } from '../../components/ui/controls';
import { ScrubNumber } from './fields';
import { LuDownload, LuClapperboard } from 'react-icons/lu';

export function RenderPanel() {
  const comp = useMotion((s) => activeComp(s));
  const [s, setS] = useState<ExportSettings>({ format: 'mp4', width: 1920, height: 1080, fps: 30, quality: 85, bitrate: 12, alpha: false, range: 'all', audio: true, motionBlur: true });
  const [size, setSize] = useState<'comp' | 'half' | '1080' | '720' | '4k' | 'custom'>('comp');
  const [job, setJob] = useState<{ p: number; label: string; cancel: { cancelled: boolean } } | null>(null);
  const last = useMotionUI((u) => u.lastRender);
  const compId = comp?.id;
  const prevComp = useRef<string | null>(null);
  useEffect(() => {
    if (!comp || prevComp.current === comp.id) return;
    prevComp.current = comp.id;
    setS((x) => ({ ...x, width: comp.width, height: comp.height, fps: comp.fps, range: comp.workStart > 0 || comp.workEnd < comp.duration ? 'work' : 'all' }));
    setSize('comp');
  }, [compId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!comp) return <div className="p-4 text-muted text-xs">Open a composition to render it.</div>;

  const info = FORMAT_INFO[s.format];
  const aspect = comp.width / comp.height;
  const applySize = (k: typeof size) => {
    setSize(k);
    const h = k === '1080' ? 1080 : k === '720' ? 720 : k === '4k' ? 2160 : k === 'half' ? Math.round(comp.height / 2) : comp.height;
    if (k === 'custom') return;
    const ww = k === 'comp' ? comp.width : k === 'half' ? Math.round(comp.width / 2) : Math.round(h * aspect);
    setS((x) => ({ ...x, width: ww, height: k === 'comp' ? comp.height : h }));
  };
  const start = s.range === 'work' ? comp.workStart : 0, end = s.range === 'work' ? comp.workEnd : comp.duration;
  const frames = Math.max(1, Math.round((end - start) * s.fps));
  const estimate = s.format === 'mp4' || s.format === 'webm' ? ((end - start) * s.bitrate * 1e6) / 8 : s.format === 'gif' ? frames * s.width * s.height * 0.35 : frames * s.width * s.height * (s.format === 'png-seq' ? 1.6 : 0.25);

  const render = async () => {
    pause();
    const cancel = { cancelled: false };
    setJob({ p: 0, label: 'Preparing…', cancel });
    try {
      const blob = await exportComposition(useMotion.getState().project, comp, s, (p, label) => setJob((j) => (j ? { ...j, p, label } : j)), cancel);
      const name = `${comp.name.replace(/[\\/:*?"<>|]+/g, '_')}.${info.ext}`;
      useMotionUI.setState({ lastRender: { blob, name } });
      setJob(null);
      if (await saveBlob(blob, name)) toast(`Rendered ${name} (${formatBytes(blob.size)})`, 'success', 5000);
    } catch (e) {
      setJob(null);
      if ((e as Error).message === 'cancelled') toast('Render cancelled', 'info');
      else { console.error(e); toastError((e as Error).message || 'Render failed.'); }
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div className="flex items-center gap-2 text-ink-strong font-medium"><LuClapperboard size={15} /><span translate="no">{comp.name}</span></div>
      <Row label="Format"><Select value={s.format} width="100%" options={(Object.keys(FORMAT_INFO) as ExportFormat[]).map((f) => ({ value: f, label: FORMAT_INFO[f].label }))} onChange={(v) => setS((x) => ({ ...x, format: v, alpha: FORMAT_INFO[v].alpha ? x.alpha : false }))} /></Row>
      <Row label="Resolution">
        <Select value={size} width="100%" options={[{ value: 'comp', label: `Composition (${comp.width}×${comp.height})` }, { value: 'half', label: 'Half size' }, { value: '720', label: '720p' }, { value: '1080', label: '1080p' }, { value: '4k', label: '4K (2160p)' }, { value: 'custom', label: 'Custom' }]} onChange={(v) => applySize(v)} />
      </Row>
      {size === 'custom' && <Row label="Size"><ScrubNumber value={s.width} min={16} max={7680} label="Width" onChange={(v) => setS((x) => ({ ...x, width: Math.round(v), height: Math.round(v / aspect) }))} /><span className="text-faint">×</span><ScrubNumber value={s.height} min={16} max={4320} label="Height" onChange={(v) => setS((x) => ({ ...x, height: Math.round(v), width: Math.round(v * aspect) }))} /></Row>}
      <Row label="Frame rate"><Select value={String(s.fps)} width="100%" options={[...new Set([...FPS_OPTIONS, comp.fps])].sort((a, b) => a - b).map((f) => ({ value: String(f), label: `${f} fps${f === comp.fps ? ' (composition)' : ''}` }))} onChange={(v) => setS((x) => ({ ...x, fps: Number(v) }))} /></Row>
      <Row label="Duration"><Select value={s.range} width="100%" options={[{ value: 'all', label: `Entire composition (${formatTimecode(comp.duration, comp.fps)})` }, { value: 'work', label: `Work area (${formatTimecode(comp.workEnd - comp.workStart, comp.fps)})` }]} onChange={(v) => setS((x) => ({ ...x, range: v }))} /></Row>
      {(s.format === 'mp4' || s.format === 'webm') && <Row label="Bitrate"><ScrubNumber value={s.bitrate} min={0.5} max={120} step={0.5} unit="Mbps" label="Bitrate" onChange={(v) => setS((x) => ({ ...x, bitrate: v }))} /></Row>}
      {(s.format === 'jpg-seq' || s.format === 'gif') && <Row label={s.format === 'gif' ? 'Quality' : 'JPEG quality'}><ScrubNumber value={s.quality} min={10} max={100} unit="%" label="Quality" onChange={(v) => setS((x) => ({ ...x, quality: Math.round(v) }))} /></Row>}
      <div className="flex flex-col gap-1.5">
        {info.alpha && <Checkbox checked={s.alpha} label={s.format === 'webm' ? 'Alpha channel (transparent video, where supported)' : 'Transparent background (alpha)'} onChange={(v) => setS((x) => ({ ...x, alpha: v }))} />}
        {info.audio && <Checkbox checked={s.audio} label="Include audio" onChange={(v) => setS((x) => ({ ...x, audio: v }))} />}
        <Checkbox checked={s.motionBlur} label="Motion blur (high quality)" onChange={(v) => setS((x) => ({ ...x, motionBlur: v }))} />
      </div>
      <div className="text-faint">{frames} frames · {s.width}×{s.height} · about {formatBytes(estimate)}</div>
      {(s.format === 'mp4' || s.format === 'webm') && !hasWebCodecs() && <div className="text-amber">This browser can’t encode video. Use Chrome or Edge, or choose GIF / image sequence.</div>}
      {job ? (
        <div className="flex flex-col gap-1.5" role="progressbar" aria-valuenow={Math.round(job.p * 100)} aria-label="Render progress">
          <div className="h-2 rounded-full bg-[#1d2025] overflow-hidden"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.max(2, job.p * 100)}%` }} /></div>
          <div className="flex items-center gap-2"><span className="flex-1 text-muted">{job.label}</span><button type="button" className="btn" onClick={() => { job.cancel.cancelled = true; }}>Cancel</button></div>
        </div>
      ) : <button type="button" className="btn btn-primary h-8" onClick={() => void render()}>Render</button>}
      {last && !job && <button type="button" className="btn inline-flex items-center gap-1.5 self-start" onClick={() => void saveBlob(last.blob, last.name)}><LuDownload size={13} />Download {last.name} again</button>}
      <div className="text-2xs text-faint leading-relaxed">Renders run in this browser. MP4 uses H.264 + AAC, WebM uses VP9 + Opus (with alpha where the browser supports it). Image sequences download as a .zip.</div>
    </div>
  );
}
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[86px_1fr] items-center gap-2"><span className="text-muted">{label}</span><div className="flex items-center gap-1.5 min-w-0">{children}</div></div>
);
