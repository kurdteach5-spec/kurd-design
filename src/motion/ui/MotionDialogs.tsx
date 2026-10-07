import { useState } from 'react';
import { Dialog, Row } from '../../components/dialogs/Dialog';
import { Select, ColorButton, Checkbox } from '../../components/ui/controls';
import { useMotionUI, closeMotionDialog } from '../uiState';
import { useMotion } from '../store';
import * as A from '../actions';
import { COMP_PRESETS, FPS_OPTIONS } from '../factory';
import { formatTimecode, parseTimecode } from '../anim';
import { MCOMMANDS } from '../commands';
import { formatShortcut } from '../../shortcuts/commands';
import { saveUserPreset } from '../presets';

export function MotionDialogs() {
  const d = useMotionUI((s) => s.dialog);
  if (!d) return null;
  if (d.type === 'comp-settings') return <CompSettings compId={d.compId} />;
  if (d.type === 'shortcuts') return <Shortcuts />;
  if (d.type === 'save-preset') return <SavePreset />;
  if (d.type === 'rename') return <Rename id={d.id} />;
  return null;
}

function CompSettings({ compId }: { compId: string | null }) {
  const c = compId ? useMotion.getState().project.comps[compId] : null;
  const [name, setName] = useState(c?.name ?? `Comp ${useMotion.getState().project.compOrder.length + 1}`);
  const [w, setW] = useState(c?.width ?? 1920);
  const [h, setH] = useState(c?.height ?? 1080);
  const [fps, setFps] = useState(c?.fps ?? 30);
  const [dur, setDur] = useState(formatTimecode(c?.duration ?? 10, c?.fps ?? 30));
  const [bg, setBg] = useState(c?.background ?? '#000000');
  const [mb, setMb] = useState(c?.motionBlur ?? true);
  const [res, setRes] = useState(String(useMotion.getState().quality));
  const preset = COMP_PRESETS.find((p) => p.w === w && p.h === h)?.id ?? 'custom';
  const submit = () => {
    const duration = Math.max(1 / fps, Math.min(3 * 3600, parseTimecode(dur, fps) ?? 10));
    const width = Math.max(16, Math.min(8192, Math.round(w))), height = Math.max(16, Math.min(8192, Math.round(h)));
    if (c) A.updateCompSettings(c.id, { name: name.trim() || c.name, width, height, fps, duration, background: bg, motionBlur: mb });
    else A.createComposition({ name: name.trim() || 'Comp', width, height, fps, duration, background: bg, motionBlur: mb });
    useMotion.setState({ quality: Number(res) as 1 | 0.5 | 0.25 });
    closeMotionDialog();
  };
  return (
    <Dialog title={c ? 'Composition Settings' : 'New Composition'} onClose={closeMotionDialog} onSubmit={submit} width={460}
      footer={<><button className="btn" onClick={closeMotionDialog}>Cancel</button><button className="btn btn-primary" onClick={submit}>{c ? 'OK' : 'Create'}</button></>}>
      <Row label="Name"><input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} data-autofocus aria-label="Composition name" /></Row>
      <Row label="Preset"><Select value={preset} width="100%" options={[...COMP_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom' }]} onChange={(v) => { const p = COMP_PRESETS.find((x) => x.id === v); if (p) { setW(p.w); setH(p.h); } }} /></Row>
      <Row label="Width"><input className="field num w-[90px]" type="number" min={16} max={8192} value={w} onChange={(e) => setW(Number(e.target.value))} aria-label="Width" /><span className="text-muted">px</span></Row>
      <Row label="Height"><input className="field num w-[90px]" type="number" min={16} max={8192} value={h} onChange={(e) => setH(Number(e.target.value))} aria-label="Height" /><span className="text-muted">px</span></Row>
      <Row label="Frame rate"><Select value={String(fps)} width={140} options={[...new Set([...FPS_OPTIONS, fps])].map((f) => ({ value: String(f), label: `${f} fps` }))} onChange={(v) => setFps(Number(v))} /></Row>
      <Row label="Duration"><input className="field num w-[120px]" value={dur} onChange={(e) => setDur(e.target.value)} aria-label="Duration (timecode)" /><span className="text-faint text-2xs">hh:mm:ss:ff</span></Row>
      <Row label="Resolution"><Select value={res} width={140} options={[{ value: '1', label: 'Full' }, { value: '0.5', label: 'Half' }, { value: '0.25', label: 'Quarter' }]} onChange={setRes} /><span className="text-faint text-2xs">preview</span></Row>
      <Row label="Background"><ColorButton color={bg} label="Background color" onChange={setBg} /></Row>
      <Row label=""><Checkbox checked={mb} label="Enable motion blur" onChange={setMb} /></Row>
    </Dialog>
  );
}

function Shortcuts() {
  const groups: [string, string[]][] = [
    ['Playback', ['m.play', 'm.prevFrame', 'm.nextFrame', 'm.back10', 'm.fwd10', 'm.start', 'm.end', 'm.prevKey', 'm.nextKey', 'm.layerIn', 'm.layerOut']],
    ['Tools', ['m.tool.select', 'm.tool.hand', 'm.tool.zoom', 'm.tool.rotate', 'm.tool.anchor', 'm.tool.rect', 'm.tool.pen', 'm.tool.text', 'm.tool.camera']],
    ['Layers', ['m.newSolid', 'm.newText', 'm.newNull', 'm.newAdjustment', 'm.newCamera3d', 'm.duplicate', 'm.split', 'm.delete', 'm.precompose', 'm.trimIn', 'm.trimOut', 'm.moveIn', 'm.moveOut', 'm.lock']],
    ['Keyframes', ['m.easy', 'm.easeIn', 'm.easeOut', 'm.hold', 'm.copy', 'm.paste', 'm.selectKeys', 'm.revealTransform', 'm.revealAll']],
    ['Project', ['m.newComp', 'm.compSettings', 'm.import', 'm.save', 'm.open', 'm.render', 'm.undo', 'm.redo', 'm.workIn', 'm.workOut', 'm.marker', 'm.graph', 'm.zoomIn', 'm.zoomOut', 'm.fit', 'm.tlZoomIn', 'm.tlZoomOut']],
  ];
  return (
    <Dialog title="Motion Keyboard Shortcuts" onClose={closeMotionDialog} footer={null} width={820}>
      <div className="columns-1 md:columns-3 gap-6">
        {groups.map(([g, ids]) => (
          <div key={g} className="break-inside-avoid mb-4">
            <div className="text-ink-strong font-medium mb-1">{g}</div>
            {ids.map((id) => { const c = MCOMMANDS.get(id); return c?.shortcut ? <div key={id} className="flex justify-between gap-3 py-0.5"><span className="text-muted">{c.label}</span><kbd className="text-ink">{formatShortcut(c.shortcut)}</kbd></div> : null; })}
          </div>
        ))}
        <div className="break-inside-avoid mb-4"><div className="text-ink-strong font-medium mb-1">Mouse</div>
          <div className="text-muted py-0.5">Alt + wheel on the timeline: zoom time</div>
          <div className="text-muted py-0.5">Ctrl/Alt + wheel on the viewer: zoom</div>
          <div className="text-muted py-0.5">Middle-drag on the viewer: pan</div>
          <div className="text-muted py-0.5">Shift-drag in the viewer: constrain</div>
          <div className="text-muted py-0.5">Alt-drag a path handle: break symmetry</div>
        </div>
      </div>
    </Dialog>
  );
}

function SavePreset() {
  const [name, setName] = useState('');
  const submit = () => { saveUserPreset(name); closeMotionDialog(); };
  return (
    <Dialog title="Save Animation Preset" onClose={closeMotionDialog} onSubmit={submit} width={380}>
      <Row label="Name"><input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} data-autofocus placeholder="My animation" aria-label="Preset name" /></Row>
      <div className="text-faint text-xs">Saves the selected layer’s keyframes and effects, relative to the current time. Find it under Effects & Presets › My Presets.</div>
    </Dialog>
  );
}

function Rename({ id }: { id: string }) {
  const p = useMotion.getState().project;
  const [name, setName] = useState(p.comps[id]?.name ?? p.assets[id]?.name ?? '');
  const submit = () => { A.renameProjectItem(id, name); closeMotionDialog(); };
  return <Dialog title="Rename" onClose={closeMotionDialog} onSubmit={submit} width={340}><input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} data-autofocus aria-label="Name" /></Dialog>;
}
