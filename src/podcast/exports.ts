// Exports of the multicam edit:
//  • an edit package for Premiere Pro / DaVinci Resolve / Final Cut 7 (XML), CMX3600 EDL, CSV shot list,
//    a written edit report, and the edit itself (JSON) — all in one .zip;
//  • the edit as a Motion composition (for titles, lower thirds, graphics).
import { ZipWriter } from '../motion/export/zip';
import { saveBlob } from '../file-system/exporters';
import { toast, toastError } from '../state/uiStore';
import { usePod, analyze, camsReady, masterTracks, speakerName, isBroll, rigOf, automixTracks, splitOf, soundSegments } from './store';
import { openRegions } from './audioMix';
import { isVirtual } from './types';
import { editStats } from './autoEdit';
import { camName, longName } from './labels';
import type { EditSettings, Segment } from './types';

/** export range: In/Out points if set, otherwise the whole recording */
export function exportRange(): { start: number; end: number } {
  const s = usePod.getState(); const an = s.analysis;
  const start = an?.start ?? 0, end = an?.end ?? 0;
  const a = s.inPoint ?? start, b = s.outPoint ?? end;
  return { start: Math.max(start, Math.min(a, b)), end: Math.min(end, Math.max(a, b)) };
}
/** shots inside a range, trimmed to it */
export function shotsIn(range: { start: number; end: number }, segs = usePod.getState().segments): Segment[] {
  return segs.filter((x) => x.end > range.start && x.start < range.end).map((x) => {
    const st = Math.max(x.start, range.start);
    return { ...x, start: st, end: Math.min(x.end, range.end), ...(x.srcIn !== undefined ? { srcIn: x.srcIn + (st - x.start) } : {}) };
  });
}

/** source time of a shot's first frame */
const srcTimeAt = (x: Segment, t: number) => { const src = usePod.getState().sources[x.cam]; return x.srcIn !== undefined ? x.srcIn + (t - x.start) : t + (src?.offset ?? 0); };

const NTSC: Record<number, number> = { 23.976: 24, 29.97: 30, 59.94: 60 };
const timebase = (fps: number) => NTSC[fps] ?? Math.round(fps);
const isNtsc = (fps: number) => fps in NTSC;
function tc(frames: number, fps: number): string {
  const tb = timebase(fps);
  const f = Math.max(0, Math.round(frames));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(f / (tb * 3600)))}:${p(Math.floor(f / (tb * 60)) % 60)}:${p(Math.floor(f / tb) % 60)}:${p(f % tb)}`;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const baseName = () => {
  const s = usePod.getState();
  const ref = s.cameras.find((c) => c.role === 'wide') ?? s.cameras[0];
  return (ref ? s.sources[ref.id]?.name ?? 'podcast' : 'podcast').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_');
};
/** a box (x, y, w, h in 0..1 of the frame, crop per side) in output pixels: camera, scale (%), clip centre, crop (% of the source per side) */
function boxCell(b: { cam: string | null; x: number; y: number; w: number; h: number; crop: { l: number; r: number; t: number; b: number } }) {
  const s = usePod.getState();
  const W = s.output.width, H = s.output.height;
  const cam = b.cam!; const src = s.sources[cam];
  const bw = b.w * W, bh = b.h * H;
  const cw = src.width * Math.max(0.01, 1 - b.crop.l - b.crop.r), ch = src.height * Math.max(0.01, 1 - b.crop.t - b.crop.b);
  const k = Math.max(bw / cw, bh / ch);
  const visW = bw / k, visH = bh / k;
  const ccx = src.width * (b.crop.l + (1 - b.crop.l - b.crop.r) / 2), ccy = src.height * (b.crop.t + (1 - b.crop.t - b.crop.b) / 2);
  const left = ccx - visW / 2, top = ccy - visH / 2;
  const bx = (b.x + b.w / 2) * W, by = (b.y + b.h / 2) * H;
  return {
    cam, scale: k * 100, k,
    cx: bx - (ccx - src.width / 2) * k, cy: by - (ccy - src.height / 2) * k,
    crop: { l: (left / src.width) * 100, r: ((src.width - left - visW) / src.width) * 100, t: (top / src.height) * 100, b: ((src.height - top - visH) / src.height) * 100 },
    vis: { x: left, y: top, w: visW, h: visH },
  };
}
/** boxes of a split shot */
function splitCells(splitId: string) {
  const s = usePod.getState(); const sp = splitOf(splitId); if (!sp) return [];
  return sp.boxes.filter((b) => b.on && b.cam && !isVirtual(b.cam) && s.sources[b.cam]?.width).map(boxCell);
}
/** picture-in-picture keys (DVE) whose fill is a camera recording, as boxes on upper video tracks */
function pipCells(range: { start: number; end: number }) {
  const s = usePod.getState();
  return s.overlays.filter((o) => o.kind === 'usk' && o.key?.type === 'dve' && o.end > range.start && o.start < range.end && s.sources[o.key.fill]?.width && !s.broll.includes(o.key.fill))
    .map((o) => ({ o, cell: boxCell({ cam: o.key!.fill, ...o.key!.dve, crop: o.key!.dve.crop }) }));
}

const TRANS_XML: Record<string, { name: string; id: string; cat: string }> = {
  mix: { name: 'Cross Dissolve', id: 'Cross Dissolve', cat: 'Dissolve' },
  dip: { name: 'Dip to Color Dissolve', id: 'Dip to Color Dissolve', cat: 'Dissolve' },
  wipe: { name: 'Edge Wipe', id: 'Edge Wipe', cat: 'Wipe' },
  dve: { name: 'Push', id: 'Push Slide', cat: 'Slide' },
};

/** short reel names for EDL: CAM1…, WIDE1…, INS1…, BROLL1…, MIC1… */
function reels(): Record<string, string> {
  const s = usePod.getState(); const out: Record<string, string> = {};
  let p = 0, w = 0, i = 0;
  for (const c of s.cameras) out[c.id] = c.role === 'wide' ? `WIDE${++w}` : c.role === 'insert' ? `INS${++i}` : `CAM${++p}`;
  s.broll.forEach((id, k) => { out[id] = `BROLL${k + 1}`; });
  s.speakers.forEach((x, k) => { if (x.mic) out[x.mic] = `MIC${k + 1}`; });
  s.splits.forEach((x, k) => { out[x.id] = `SPLIT${k + 1}`; });
  return out;
}

function buildXml(range: { start: number; end: number }, segs: Segment[], fps: number): string {
  const s = usePod.getState();
  const tb = timebase(fps), ntsc = isNtsc(fps) ? 'TRUE' : 'FALSE';
  const rate = `<rate><timebase>${tb}</timebase><ntsc>${ntsc}</ntsc></rate>`;
  const fr = (sec: number) => Math.round(sec * fps);
  const total = fr(range.end - range.start);
  const defined = new Set<string>();
  const fileXml = (id: string) => {
    const src = s.sources[id];
    if (defined.has(id)) return `<file id="file-${id}"/>`;
    defined.add(id);
    const media = src.kind === 'video'
      ? `<video><samplecharacteristics>${rate}<width>${src.width}</width><height>${src.height}</height></samplecharacteristics></video><audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>`
      : `<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>`;
    return `<file id="file-${id}"><name>${esc(src.name)}</name><pathurl>file://localhost/${encodeURIComponent(src.name)}</pathurl>${rate}<duration>${fr(src.duration)}</duration><timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode><media>${media}</media></file>`;
  };
  let n = 0;
  const param = (id: string, name: string, v: string) => `<parameter authoringApp="PremierePro"><parameterid>${id}</parameterid><name>${name}</name>${v}</parameter>`;
  const motion = (c: ReturnType<typeof splitCells>[number]) =>
    `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>${param('scale', 'Scale', `<valuemin>0</valuemin><valuemax>1000</valuemax><value>${c.scale.toFixed(2)}</value>`)}${param('center', 'Center', `<value><horiz>${c.cx.toFixed(2)}</horiz><vert>${c.cy.toFixed(2)}</vert></value>`)}</effect></filter>`
    + `<filter><effect><name>Crop</name><effectid>crop</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>${([['left', c.crop.l], ['right', c.crop.r], ['top', c.crop.t], ['bottom', c.crop.b]] as const).map(([k, v]) => param(k, k[0].toUpperCase() + k.slice(1), `<valuemin>0</valuemin><valuemax>100</valuemax><value>${Math.max(0, v).toFixed(2)}</value>`)).join('')}</effect></filter>`;
  const clip = (id: string, from: number, to: number, srcFrom: number, track: 'video' | 'audio', filters = '') => {
    const src = s.sources[id];
    const start = fr(from - range.start), end = fr(to - range.start);
    const inF = fr(srcFrom), outF = inF + (end - start);
    n++;
    return `<clipitem id="clipitem-${n}"><name>${esc(src.name)}</name><enabled>TRUE</enabled><duration>${fr(src.duration)}</duration>${rate}<start>${start}</start><end>${end}</end><in>${inF}</in><out>${outF}</out>${fileXml(id)}${filters}${track === 'audio' ? '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>' : ''}</clipitem>`;
  };
  // video tracks: V1 = the cut; split screens put their other cells on V2, V3…
  const tracks: string[][] = [[]];
  segs.forEach((x, i) => {
    const prev = segs[i - 1];
    const dur = x.trans?.dur ?? x.mix ?? 0;
    if (dur > 0 && x.start > range.start && !isVirtual(x.cam) && prev && !isVirtual(prev.cam)) {
      // transition from the previous shot, starting at the cut
      const a0 = fr(x.start - range.start), a1 = a0 + Math.max(1, fr(dur));
      const t = TRANS_XML[x.trans?.style ?? 'mix'];
      tracks[0].push(`<transitionitem><start>${a0}</start><end>${a1}</end><alignment>start</alignment>${rate}<effect><name>${t.name}</name><effectid>${t.id}</effectid><effectcategory>${t.cat}</effectcategory><effecttype>transition</effecttype><mediatype>video</mediatype></effect></transitionitem>`);
    }
    if (isVirtual(x.cam)) return; // black, colours, stills: a gap in the edit (see the report)
    if (!splitOf(x.cam)) { tracks[0].push(clip(x.cam, x.start, x.end, srcTimeAt(x, x.start), 'video')); return; }
    splitCells(x.cam).forEach((c, k) => {
      while (tracks.length <= k) tracks.push([]);
      tracks[k].push(clip(c.cam, x.start, x.end, x.start + s.sources[c.cam].offset, 'video', motion(c)));
    });
  });
  // picture-in-picture keys on a track above everything
  const pips = pipCells(range);
  if (pips.length) tracks.push(pips.map(({ o, cell }) => { const a = Math.max(range.start, o.start), b = Math.min(range.end, o.end); return clip(cell.cam, a, b, a + s.sources[cell.cam].offset, 'video', motion(cell)); }));
  const video = tracks.map((t) => `<track>\n${t.join('\n')}\n</track>`).join('\n');
  // sound: per person, only while they speak (automix), or the master track(s)
  const mix = automixTracks();
  const pictureSound = s.settings.audioMode === 'picture'
    ? (() => {
      // sound follows the picture: one track per simultaneous source, cut at the sound cuts (J / L cuts kept)
      const parts = soundSegments().map((g) => ({ ...g, start: Math.max(range.start, g.start), end: Math.min(range.end, g.end) })).filter((g) => g.end > g.start);
      const n = Math.max(1, ...parts.map((g) => g.sources.length));
      return Array.from({ length: n }, (_, k) => `<track>${parts.map((g) => { const id = g.sources[k]; const src = id ? s.sources[id] : null; if (!src) return ''; const a = Math.max(g.start, -src.offset), b = Math.min(g.end, src.duration - src.offset); return b > a ? clip(id, a, b, a + src.offset, 'audio') : ''; }).join('')}</track>`).join('\n');
    })()
    : null;
  const audio = pictureSound ?? (mix.length && s.analysis
    ? mix.map((tr) => { const src = s.sources[tr.source]; return `<track>${openRegions(tr, s.analysis!, range.start, range.end).map((g) => { const a = Math.max(g.start, -src.offset), b = Math.min(g.end, src.duration - src.offset); return b > a ? clip(tr.source, a, b, a + src.offset, 'audio') : ''; }).join('')}</track>`; }).join('\n')
    : masterTracks().map((id) => { const src = s.sources[id]; const a = Math.max(range.start, -src.offset), b = Math.min(range.end, src.duration - src.offset); return `<track>${clip(id, a, b, a + src.offset, 'audio')}</track>`; }).join('\n'));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
<sequence id="sequence-1">
<name>${esc(baseName())} — multicam edit</name>
<duration>${total}</duration>
${rate}
<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
<media>
<video>
<format><samplecharacteristics>${rate}<width>${s.output.width}</width><height>${s.output.height}</height><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>
${video}
</video>
<audio>
${audio}
</audio>
</media>
</sequence>
</xmeml>
`;
}

function buildEdl(range: { start: number; end: number }, segs: Segment[], fps: number): string {
  const s = usePod.getState(); const R = reels();
  const fr = (sec: number) => Math.round(sec * fps);
  const lines = [`TITLE: ${baseName().toUpperCase().slice(0, 60)} MULTICAM`, 'FCM: NON-DROP FRAME', ''];
  let ev = 0;
  const event = (id: string, ch: string, from: number, to: number, srcFrom: number) => {
    const src = s.sources[id];
    const r0 = fr(from - range.start), r1 = fr(to - range.start);
    const s0 = fr(srcFrom), s1 = s0 + (r1 - r0);
    ev++;
    lines.push(`${String(ev).padStart(3, '0')}  ${(R[id] ?? 'AX').padEnd(8)} ${ch.padEnd(5)} C        ${tc(s0, fps)} ${tc(s1, fps)} ${tc(r0, fps)} ${tc(r1, fps)}`);
    lines.push(`* FROM CLIP NAME: ${src.name}`);
    lines.push('');
  };
  for (const x of segs) {
    if (isVirtual(x.cam)) {
      ev++; const r0 = fr(x.start - range.start), r1 = fr(x.end - range.start);
      lines.push(`${String(ev).padStart(3, '0')}  BL       V     C        ${tc(0, fps)} ${tc(r1 - r0, fps)} ${tc(r0, fps)} ${tc(r1, fps)}`, `* SWITCHER SOURCE: ${longName(x.cam)}`, '');
      continue;
    }
    const sp = splitOf(x.cam);
    if (!sp) { event(x.cam, 'V', x.start, x.end, srcTimeAt(x, x.start)); continue; }
    // EDL has one picture per event: the first cell, with a note (the XML keeps the full split screen)
    const cells = splitCells(x.cam); if (!cells.length) continue;
    event(cells[0].cam, 'V', x.start, x.end, x.start + s.sources[cells[0].cam].offset);
    lines.splice(lines.length - 1, 0, `* SPLIT SCREEN (${sp.boxes.length} boxes): ${cells.map((c) => s.sources[c.cam].name).join(' + ')}`);
  }
  const mix = automixTracks();
  if (s.settings.audioMode === 'picture') {
    for (const g of soundSegments()) { const a0 = Math.max(range.start, g.start), b0 = Math.min(range.end, g.end); if (b0 <= a0) continue; for (const id of g.sources) { const src = s.sources[id]; if (!src) continue; const a = Math.max(a0, -src.offset), b = Math.min(b0, src.duration - src.offset); if (b > a) event(id, 'AA', a, b, a + src.offset); } }
  } else if (mix.length && s.analysis) {
    for (const tr of mix) { const src = s.sources[tr.source]; for (const g of openRegions(tr, s.analysis, range.start, range.end)) { const a = Math.max(g.start, -src.offset), b = Math.min(g.end, src.duration - src.offset); if (b > a) event(tr.source, 'AA', a, b, a + src.offset); } }
  } else for (const id of masterTracks()) { const src = s.sources[id]; const a = Math.max(range.start, -src.offset), b = Math.min(range.end, src.duration - src.offset); event(id, 'AA', a, b, a + src.offset); }
  return lines.join('\r\n');
}

function buildCsv(range: { start: number; end: number }, segs: Segment[], fps: number): string {
  const rows = ['shot,start,end,duration_s,camera,reason'];
  segs.forEach((x, i) => rows.push([i + 1, tc((x.start - range.start) * fps, fps), tc((x.end - range.start) * fps, fps), (x.end - x.start).toFixed(2), `"${camName(x.cam).replace(/"/g, "'")}"`, x.reason].join(',')));
  return rows.join('\n');
}

const REASON_TEXT: Record<Segment['reason'], string> = {
  speaker: 'follows the speaker', crosstalk: 'several people talking (wide)', pause: 'long pause (wide)', opening: 'establishing shot',
  closing: 'closing shot', reaction: 'listener reaction', variety: 'wide cutaway in a long answer', angle: 'other angle of the speaker',
  insert: 'insert (detail camera)', broll: 'B-roll insert', split: 'split screen (quick exchange)', manual: 'manual edit',
};

function buildReport(range: { start: number; end: number }, segs: Segment[], st: EditSettings): string {
  const s = usePod.getState(); const an = s.analysis; const R = reels();
  const stats = editStats(segs, an);
  const pc = (v: number) => `${((v ?? 0) * 100).toFixed(1)} %`;
  const L: string[] = [];
  L.push(`MULTICAM EDIT REPORT — ${baseName()}`, 'Made with KURD DESIGN · Podcast', '');
  L.push('CAMERAS');
  for (const c of s.cameras) {
    const src = s.sources[c.id]; const conf = an?.syncConfidence[c.id];
    L.push(`  ${(R[c.id] ?? '').padEnd(7)} ${camName(c.id).padEnd(28)} ${src.name} — offset ${src.offset >= 0 ? '+' : ''}${src.offset.toFixed(3)} s${conf !== undefined ? ` (sync confidence ${conf.toFixed(1)})` : ' (reference)'}`);
  }
  const mics = s.speakers.filter((x) => x.mic);
  if (mics.length) { L.push('', 'MICROPHONES'); for (const x of mics) { const src = s.sources[x.mic!]; L.push(`  ${(R[x.mic!] ?? '').padEnd(7)} ${speakerName(x.id).padEnd(28)} ${src.name} — offset ${src.offset >= 0 ? '+' : ''}${src.offset.toFixed(3)} s`); } }
  if (s.splits.length) { L.push('', 'SPLIT SCREENS'); for (const sp of s.splits) L.push(`  ${(R[sp.id] ?? '').padEnd(7)} ${sp.boxes.filter((b) => b.on).map((b) => (b.cam ? camName(b.cam) : '—')).join(' + ')}`); }
  if (s.broll.length) { L.push('', 'B-ROLL'); for (const id of s.broll) L.push(`  ${(R[id] ?? '').padEnd(7)} ${s.sources[id]?.name ?? ''} (${(s.sources[id]?.duration ?? 0).toFixed(1)} s)`); }
  L.push('', 'PEOPLE');
  for (const x of s.speakers) L.push(`  ${speakerName(x.id).padEnd(28)} cameras: ${rigOf().speakerCams[x.id].map((c) => R[c]).join(', ') || '—'}   talk time ${pc(stats.talk[x.id])}`);
  if (an) L.push(`  Both / several at once: ${pc(stats.talk.both)}   Silence: ${pc(stats.talk.silence)}   Voice separation: ${an.separation.toFixed(1)} dB`);
  if (s.pictureCheck) L.push(`  Voices matched to people by picture movement${s.pictureCheck.changed ? ' (re-assigned automatically)' : ''}`);
  L.push('', 'EDIT');
  L.push(`  Range: ${tc(range.start * st.fps, st.fps)} – ${tc(range.end * st.fps, st.fps)} (${(range.end - range.start).toFixed(1)} s) at ${st.fps} fps`);
  L.push(`  Shots: ${stats.shots}   Cuts: ${stats.cuts}   Average shot length (ASL): ${stats.asl.toFixed(2)} s   Cuts per minute: ${stats.cutsPerMinute.toFixed(1)}`);
  L.push('  Screen time:');
  for (const [id, v] of Object.entries(stats.share).sort((a, b) => b[1] - a[1])) L.push(`    ${camName(id).padEnd(30)} ${pc(v)}`);
  L.push('', 'RULES USED');
  L.push(`  Pacing: ${st.pacing}; shortest shot ${st.minShot} s; longest speaker shot ${st.maxShot} s before a cutaway`);
  L.push(`  Listener speech shorter than ${st.minTurn} s does not cause a cut; silence longer than ${st.wideOnSilence} s goes wide`);
  L.push(`  Cut timing: ${st.cutTiming === 'pause' ? 'in the pause before the new speaker' : st.cutTiming === 'onset' ? 'on the first word' : 'slightly after the first word (J-cut)'}`);
  L.push(`  Crosstalk → wide: ${st.wideOnCrosstalk ? 'yes' : 'no'}; reaction shots: ${st.reactions ? 'yes' : 'no'}; wide cutaways: ${st.wideCutaways ? 'yes' : 'no'}; angle changes: ${st.angles ? 'yes' : 'no'}`);
  L.push(`  Split screen for quick exchanges / crosstalk: ${st.splitDialog ? 'yes' : 'no'}; sound: ${st.audioMode === 'speaker' ? `only the person speaking (others ${st.duckDb <= -60 ? 'off' : `${st.duckDb} dB`})` : st.audioMode === 'picture' ? 'follows the picture (J / L cuts kept)' : 'master track'}`);
  L.push(`  Inserts / B-roll: ${st.inserts}${st.inserts !== 'off' ? ` (${st.insertLen} s each, only inside long answers, never at the start or end of a turn)` : ''}; opening wide ${st.openingWide} s; closing wide ${st.closingWide} s`);
  const ovs = s.overlays.filter((o) => o.end > range.start && o.start < range.end);
  const trs = segs.filter((x) => (x.trans?.dur ?? x.mix ?? 0) > 0);
  if (ovs.length || trs.length || segs.some((x) => isVirtual(x.cam))) {
    L.push('', 'VISION MIXER');
    if (trs.length) L.push(`  Transitions: ${trs.length} (${[...new Set(trs.map((x) => x.trans?.style ?? 'mix'))].join(', ')})`);
    for (const o of ovs) {
      const what = o.kind === 'ftb' ? 'Fade to black' : o.kind === 'dsk' ? `DSK ${o.slot} · ${longName(o.dsk?.fill ?? '')}` : `Key 1 (${o.key?.type ?? ''}) · ${longName(o.key?.fill ?? '')}`;
      L.push(`  ${tc((Math.max(range.start, o.start) - range.start) * st.fps, st.fps)} – ${tc((Math.min(range.end, o.end) - range.start) * st.fps, st.fps)}  ${what}`);
    }
    L.push('  In the XML: picture-in-picture keys are on the top video track; black, colours and stills are gaps; other keys, DSK pictures and fade to black are only in the rendered video.');
  }
  L.push('', 'SHOT LIST');
  segs.forEach((x, i) => L.push(`  ${String(i + 1).padStart(4)}  ${tc((x.start - range.start) * st.fps, st.fps)}  ${(x.end - x.start).toFixed(2).padStart(6)} s  ${camName(x.cam).padEnd(30)} ${REASON_TEXT[x.reason]}`));
  L.push('', 'IMPORT', '  Premiere Pro: File › Import › the .xml file, then relink the media to the original files.', '  DaVinci Resolve: File › Import › Timeline › the .xml (or .edl) file, with the original files in the Media Pool.', '  Source timecode starts at 00:00:00:00 for every file.', '  Split screens are on video tracks 1, 2… with position, scale and crop; the sound of each person is on its own audio track, cut to the moments they speak.');
  return L.join('\n');
}

export function editJson(): string {
  const s = usePod.getState();
  const file = (id: string | null) => (id && s.sources[id] ? { name: s.sources[id].name, size: s.sources[id].file.size, offset: s.sources[id].offset } : null);
  return JSON.stringify({
    format: 'kurd-design-podcast', version: 2,
    cameras: s.cameras.map((c) => ({ ...c, file: file(c.id) })),
    speakers: s.speakers.map((x) => ({ id: x.id, name: x.name, mic: file(x.mic) })),
    broll: s.broll.map((id) => ({ id, file: file(id) })),
    splits: s.splits,
    // vision mixer
    labels: s.labels, colors: s.colors, trans: s.trans, usk: s.usk, dsk: s.dsk, ftbRate: s.ftbRate, overlays: s.overlays, multiview: s.multiview, audioIn: s.audioIn,
    settings: s.settings, segments: s.segments, master: s.master, inPoint: s.inPoint, outPoint: s.outPoint,
  }, null, 1);
}

export async function downloadEditPackage() {
  const s = usePod.getState();
  if (!s.segments.length) { toastError('Make the edit first.'); return; }
  const range = exportRange(); const segs = shotsIn(range); const fps = s.settings.fps;
  const z = new ZipWriter(); const enc = new TextEncoder(); const name = baseName();
  z.add(`${name}-multicam.xml`, enc.encode(buildXml(range, segs, fps)));
  z.add(`${name}-multicam.edl`, enc.encode(buildEdl(range, segs, fps)));
  z.add(`${name}-shots.csv`, enc.encode(buildCsv(range, segs, fps)));
  z.add(`${name}-edit-report.txt`, enc.encode(buildReport(range, segs, s.settings)));
  z.add(`${name}.kdpodcast.json`, enc.encode(editJson()));
  try { if (await saveBlob(z.finish(), `${name}-edit-package.zip`)) toast('Edit package downloaded'); } catch (e) { toastError((e as Error).message); }
}

export async function saveEdit() {
  try { if (await saveBlob(new Blob([editJson()], { type: 'application/json' }), `${baseName()}.kdpodcast.json`)) toast('Edit saved'); } catch (e) { toastError((e as Error).message); }
}

type SavedFile = { name: string; offset: number } | null;
/** Opens a saved edit: matches the saved files to the loaded ones by name, re-analyses, then restores the cuts. */
export async function openEdit(file: File) {
  let data: {
    format?: string; version?: number; settings?: EditSettings; segments?: Segment[]; master?: string; inPoint?: number | null; outPoint?: number | null;
    cameras?: { id: string; role: 'speaker' | 'wide' | 'insert'; speaker: string | null; file: SavedFile }[];
    speakers?: { id: string; name: string; mic: SavedFile }[]; broll?: { id: string; file: SavedFile }[];
    splits?: import('./types').Split[];
    labels?: Record<string, string>; colors?: { col1: string; col2: string }; trans?: import('./types').TransParams; usk?: import('./types').KeyConfig; dsk?: [import('./types').DskConfig, import('./types').DskConfig];
    ftbRate?: number; overlays?: import('./types').Overlay[]; multiview?: import('./types').MultiviewConfig; audioIn?: Record<string, { mode: 'auto' | 'afv' | 'on' | 'off'; db: number }>;
  };
  try { data = JSON.parse(await file.text()); } catch { toastError('This is not a saved podcast edit.'); return; }
  if (data.format !== 'kurd-design-podcast' || !Array.isArray(data.segments) || !Array.isArray(data.cameras)) { toastError('This is not a saved podcast edit.'); return; }
  if (!camsReady()) { toastError('Add the same camera videos first, then open the edit.'); return; }
  const s = usePod.getState();
  // map saved ids → loaded ids by file name
  const byName = (n?: string) => Object.values(s.sources).find((x) => x.name === n)?.id;
  const idMap = new Map<string, string>();
  for (const c of data.cameras) { const id = byName(c.file?.name); if (id) idMap.set(c.id, id); }
  for (const b of data.broll ?? []) { const id = byName(b.file?.name); if (id) idMap.set(b.id, id); }
  const missing = data.cameras.filter((c) => !idMap.has(c.id)).map((c) => c.file?.name ?? '?');
  if (missing.length) { toastError(`Load these files first: ${missing.join(', ')}`); return; }
  const speakers = (data.speakers ?? []).map((x, i) => ({ id: x.id, name: x.name, mic: s.speakers[i]?.mic && s.sources[s.speakers[i].mic!]?.name === x.mic?.name ? s.speakers[i].mic : null }));
  usePod.setState({
    speakers: speakers.length >= 2 ? speakers : s.speakers,
    cameras: data.cameras.map((c) => ({ id: idMap.get(c.id)!, role: c.role, speaker: c.speaker })),
    splits: (data.splits ?? []).filter((x) => Array.isArray(x.boxes)).map((x) => ({ ...x, boxes: x.boxes.map((b) => ({ ...b, cam: b.cam ? idMap.get(b.cam) ?? (isVirtual(b.cam) ? b.cam : null) : null })) })),
    settings: { ...s.settings, ...(data.settings ?? {}) },
  });
  await analyze();
  const st = usePod.getState(); if (!st.analysis) return;
  const sources = { ...st.sources };
  for (const c of data.cameras) { const id = idMap.get(c.id)!; if (c.file) sources[id] = { ...sources[id], offset: c.file.offset }; }
  const splitIds = new Set((data.splits ?? []).map((x) => x.id));
  const segs = data.segments.filter((x) => idMap.has(x.cam) || isBroll(x.cam) || splitIds.has(x.cam) || isVirtual(x.cam)).map((x) => ({ ...x, cam: idMap.get(x.cam) ?? x.cam }));
  const mapId = (id: string) => idMap.get(id) ?? id;
  const mapKeys = <T,>(r: Record<string, T> | undefined) => Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [mapId(k), v]));
  usePod.setState({
    labels: mapKeys(data.labels), audioIn: mapKeys(data.audioIn), ...(data.colors ? { colors: data.colors } : {}), ...(data.trans ? { trans: data.trans } : {}), ...(data.multiview ? { multiview: { ...data.multiview, windows: data.multiview.windows.map((w) => (w ? mapId(w) : w)) } } : {}),
    ...(data.usk ? { usk: { ...data.usk, fill: mapId(data.usk.fill), keySrc: mapId(data.usk.keySrc) } } : {}),
    ...(data.dsk ? { dsk: data.dsk.map((d) => ({ ...d, fill: mapId(d.fill) })) as [import('./types').DskConfig, import('./types').DskConfig] } : {}),
    ...(data.ftbRate ? { ftbRate: data.ftbRate } : {}),
    overlays: (data.overlays ?? []).map((o) => ({ ...o, ...(o.key ? { key: { ...o.key, fill: mapId(o.key.fill), keySrc: mapId(o.key.keySrc) } } : {}), ...(o.dsk ? { dsk: { ...o.dsk, fill: mapId(o.dsk.fill) } } : {}) })),
  });
  usePod.setState({ sources, segments: segs, past: [st.segments], future: [], edited: true, master: data.master ?? st.master, inPoint: data.inPoint ?? null, outPoint: data.outPoint ?? null });
  toast('Edit restored');
}

/** Builds the edit as a Motion composition (one video layer per shot + the master sound). */
export async function sendToMotion() {
  const s = usePod.getState();
  if (!s.segments.length) { toastError('Make the edit first.'); return; }
  const range = exportRange(); const segs = shotsIn(range);
  const [{ importAsset }, M, F, W] = await Promise.all([import('../motion/media/assets'), import('../motion/store'), import('../motion/factory'), import('../state/workspace')]);
  const { openComp } = await import('../motion/actions');
  toast('Preparing the composition…', 'info', 4000);
  const mix = automixTracks();
  const need = new Set<string>([...segs.filter((x) => !isVirtual(x.cam)).flatMap((x) => (splitOf(x.cam) ? splitCells(x.cam).map((c) => c.cam) : [x.cam])), ...(mix.length ? mix.map((t) => t.source) : masterTracks())]);
  const assets: Record<string, Awaited<ReturnType<typeof importAsset>>> = {};
  for (const id of need) {
    const src = s.sources[id];
    try { assets[id] = await importAsset(src.file, src.name); } catch (e) { toastError((e as Error).message); return; }
  }
  M.mcommit((p) => ({ ...p, assets: { ...p.assets, ...Object.fromEntries(Object.values(assets).map((a) => [a.id, a])) }, assetOrder: [...p.assetOrder, ...Object.values(assets).map((a) => a.id)] }), 'Import');
  const fps = Math.round(s.settings.fps * 1000) / 1000;
  const comp = F.newComposition({ name: `${baseName()} — multicam`, width: s.output.width, height: s.output.height, fps, duration: Math.max(1 / fps, range.end - range.start) });
  const layers: ReturnType<typeof F.newMediaLayer>[] = [];
  const { makeKey } = await import('../motion/anim');
  for (let i = segs.length - 1; i >= 0; i--) {
    const x = segs[i];
    if (isVirtual(x.cam)) continue; // black / colour / still: nothing (black) in the composition
    if (splitOf(x.cam)) {
      // one layer per cell: scaled to fill its cell, masked to the cell
      splitCells(x.cam).forEach((c, ci) => {
        const a = assets[c.cam]; const src = s.sources[c.cam];
        const l = F.newMediaLayer(comp, a, 0);
        l.transform = { ...l.transform, scale: { v: [c.scale, c.scale, 100], k: [] }, position: { v: [c.cx, c.cy, 0], k: [] } };
        l.masks = [F.newMask(F.rectPathAt(c.vis.x, c.vis.y, c.vis.w, c.vis.h), 'Cell')];
        l.start = (x.start - range.start) - (x.start + src.offset); l.inPoint = x.start - range.start; l.outPoint = x.end - range.start;
        l.audioOn = false; l.name = `${String(i + 1).padStart(3, '0')} · Split ${ci + 1} · ${camName(c.cam)}`;
        layers.push(l);
      });
      continue;
    }
    const a = assets[x.cam];
    const l = F.newMediaLayer(comp, a, 0);
    const k = (s.output.fit === 'cover' ? Math.max(comp.width / a.width, comp.height / a.height) : Math.min(comp.width / a.width, comp.height / a.height)) * 100;
    l.transform = { ...l.transform, scale: { v: [k, k, 100], k: [] } };
    // comp time c shows source time srcTimeAt(x, c + range.start) → the layer's source starts at c = -(that at c = 0)
    l.start = (x.start - range.start) - srcTimeAt(x, x.start); l.inPoint = x.start - range.start; l.outPoint = x.end - range.start;
    l.audioOn = false; l.name = `${String(i + 1).padStart(3, '0')} · ${camName(x.cam)}`;
    layers.push(l);
  }
  for (const id of mix.length ? mix.map((t) => t.source) : masterTracks()) {
    const src = s.sources[id]; const a = assets[id];
    const l = F.newMediaLayer(comp, a, 0);
    l.start = -(range.start + src.offset); l.inPoint = Math.max(0, l.start); l.outPoint = Math.min(comp.duration, l.start + src.duration);
    if (l.type === 'video') l.visible = false;
    l.name = `Sound · ${src.name}`;
    // automix: volume keyframes (0 dB while the person speaks, off otherwise)
    const tr = mix.find((t) => t.source === id);
    if (tr && s.analysis && (l.type === 'video' || l.type === 'audio')) {
      const keys = [] as ReturnType<typeof makeKey<number>>[];
      const off = s.settings.duckDb <= -60 ? -48 : s.settings.duckDb;
      keys.push(makeKey(0, off, 'linear'));
      for (const g of openRegions(tr, s.analysis, range.start, range.end, 0.4)) {
        const a0 = g.start - range.start, b0 = g.end - range.start;
        keys.push(makeKey(Math.max(0, a0 - 0.06), off), makeKey(Math.max(0, a0), 0), makeKey(b0, 0), makeKey(b0 + 0.06, off));
      }
      const sorted = keys.sort((p, q) => p.t - q.t).filter((k, j, arr) => j === 0 || k.t > arr[j - 1].t + 1e-4);
      l.volume = { v: off, k: sorted };
    }
    layers.push(l);
  }
  comp.layers = layers;
  M.mcommit((p) => ({ ...p, comps: { ...p.comps, [comp.id]: comp }, compOrder: [...p.compOrder, comp.id] }), 'Podcast Edit');
  openComp(comp.id);
  W.setWorkspace('motion');
  toast('The edit is now a composition in Motion');
}
