// Edit assistant: reads who speaks when (the speech analysis) and checks the edit the way an editor would —
// the picture should show the person speaking (reaction shots are short), cuts come in the pause before the
// new speaker (not seconds late, not in the middle of a word), no endless shots, no flash frames, no jump cuts,
// crosstalk goes wide. Every tip says why and can be fixed with one click. While switching live it also
// suggests the input to take next.
import { BOTH, isVirtual, type Analysis, type Segment } from './types';
import { quietest, paint } from './autoEdit';
import { usePod, rigOf, segmentAt, speakerName, type PodState } from './store';
import { camName } from './labels';

export type TipKind = 'wrong' | 'late' | 'early' | 'long' | 'short' | 'jump' | 'crosstalk' | 'midword';
export type TipFix =
  | { kind: 'paint'; cam: string; from: number; to: number }
  | { kind: 'move'; seg: number; to: number }
  | { kind: 'delete'; seg: number };
export interface Tip { key: string; t: number; kind: TipKind; msg: string; fix?: TipFix; fixLabel?: string }

interface Turn { who: number; start: number; end: number } // who: 1..V speaker, BOTH crosstalk, 0 silence

function turns(an: Analysis, minLen: number): Turn[] {
  const out: Turn[] = []; const R = an.rate;
  let cur = an.state[0] ?? 0, s0 = 0;
  for (let i = 1; i <= an.state.length; i++) {
    const v = i < an.state.length ? an.state[i] : -1;
    if (v !== cur) { out.push({ who: cur, start: an.t0 + s0 / R, end: an.t0 + i / R }); cur = v; s0 = i; }
  }
  // drop blips shorter than minLen (they belong to their neighbours), then merge equal neighbours
  const kept = out.filter((x) => x.end - x.start >= minLen || x.who === 0);
  const merged: Turn[] = [];
  for (const t of kept) { const l = merged[merged.length - 1]; if (l && l.who === t.who) l.end = t.end; else merged.push({ ...t }); }
  return merged.filter((x) => x.who !== 0 || x.end - x.start >= 0.4);
}

/** people (speaker ids) an input shows */
function shows(cam: string, s: PodState, rig = rigOf(s)): Set<string> | 'all' {
  if (isVirtual(cam)) return new Set();
  if (rig.wides.includes(cam)) return 'all';
  const sp = rig.splits.find((x) => x.id === cam); if (sp) return new Set(sp.people);
  const c = s.cameras.find((x) => x.id === cam);
  if (c?.role === 'speaker' && c.speaker) return new Set([c.speaker]);
  return new Set(); // insert camera, B-roll
}
const showsP = (cam: string, p: string, s: PodState, rig = rigOf(s)) => { const x = shows(cam, s, rig); return x === 'all' || x.has(p); };

function bestFor(p: string | 'both', s: PodState, rig = rigOf(s)): string | null {
  if (p === 'both') return rig.splits.find((x) => x.people.length >= 2)?.id ?? rig.wides[0] ?? null;
  return rig.speakerCams[p]?.[0] ?? null;
}

let cache: { key: unknown[]; tips: Tip[] } | null = null;
/** all tips for the current edit (cached) */
export function editTips(s: PodState = usePod.getState()): Tip[] {
  const an = s.analysis;
  if (!an || an.stub || !s.segments.length) return [];
  const key = [s.segments, an, s.cameras, s.splits, s.settings, s.speakers];
  if (cache && cache.key.every((k, i) => k === key[i])) return cache.tips;
  const tips: Tip[] = [];
  const rig = rigOf(s); const st = s.settings; const segs = s.segments;
  const T = turns(an, Math.max(0.35, st.minTurn * 0.7));
  const who = (k: number) => an.speakers[k - 1];
  const name = (p: string) => speakerName(p, s);
  const cn = (c: string) => camName(c, s);
  const at = (t: number) => { const i = Math.round((t - an.t0) * an.rate); return an.state[Math.max(0, Math.min(an.state.length - 1, i))]; };
  const add = (tip: Omit<Tip, 'key'>) => tips.push({ ...tip, key: `${tip.kind}@${tip.t.toFixed(1)}` });
  const reactionMax = Math.max(2.5, st.minShot * 1.2);

  segs.forEach((x, i) => {
    const len = x.end - x.start;
    const cutaway = x.reason === 'insert' || x.reason === 'broll' || isVirtual(x.cam);
    // 1. the picture shows someone else while a person speaks (longer than a reaction shot)
    if (!cutaway) for (const tr of T) {
      if (tr.who === 0 || tr.who === BOTH) continue;
      const a = Math.max(tr.start, x.start), b = Math.min(tr.end, x.end);
      if (b - a < reactionMax) continue;
      const p = who(tr.who); if (!p || showsP(x.cam, p, s, rig)) continue;
      const cam = bestFor(p, s, rig); if (!cam) continue;
      const from = a > x.start + 0.05 ? quietest(an, a - 0.6, a + 0.1, a - 0.15) : x.start;
      add({ t: a, kind: 'wrong', msg: `${name(p)} is talking for ${(b - a).toFixed(1)} s but the picture shows ${cn(x.cam)}. Better: ${cn(cam)}.`, fix: { kind: 'paint', cam, from, to: b }, fixLabel: `Cut to ${cn(cam)}` });
    }
    // 2. crosstalk on a single person
    if (!cutaway) for (const tr of T) {
      if (tr.who !== BOTH) continue;
      const a = Math.max(tr.start, x.start), b = Math.min(tr.end, x.end);
      if (b - a < 1.5 || shows(x.cam, s, rig) === 'all' || (rig.splits.find((q) => q.id === x.cam)?.people.length ?? 0) >= 2) continue;
      const cam = bestFor('both', s, rig); if (!cam) continue;
      add({ t: a, kind: 'crosstalk', msg: `Several people talk at once for ${(b - a).toFixed(1)} s — the wide shot or a split screen shows them all.`, fix: { kind: 'paint', cam, from: a, to: b }, fixLabel: `Use ${cn(cam)}` });
    }
    // 3. endless shot
    if (!cutaway && len > st.maxShot * 1.6 && shows(x.cam, s, rig) !== 'all') {
      const mid = x.start + len / 2; const t0 = quietest(an, mid - 2, mid + 2, mid);
      const alt = rig.wides[0] ?? (() => { const c = s.cameras.find((q) => q.id === x.cam); return c?.speaker ? rig.speakerCams[c.speaker].find((q) => q !== x.cam) : undefined; })();
      add({ t: x.start, kind: 'long', msg: `${len.toFixed(0)} s on the same shot (${cn(x.cam)}). Viewers need a change of angle about every ${st.maxShot} s.`, ...(alt ? { fix: { kind: 'paint' as const, cam: alt, from: t0, to: Math.min(x.end - st.minShot, t0 + 3) }, fixLabel: `Cutaway to ${cn(alt)}` } : {}) });
    }
    // 4. flash frame
    if (i > 0 && i < segs.length - 1 && len < Math.min(0.6, st.minShot * 0.5)) add({ t: x.start, kind: 'short', msg: `A ${len.toFixed(2)} s shot of ${cn(x.cam)} — it flashes by and looks like a mistake.`, fix: { kind: 'delete', seg: i }, fixLabel: 'Remove the shot' });
    // 5. jump cut
    const prev = segs[i - 1];
    if (prev && prev.cam === x.cam && !isVirtual(x.cam) && !x.trans && x.reason !== 'broll') add({ t: x.start, kind: 'jump', msg: `${cn(x.cam)} follows itself — a jump cut. Join the shots or use another angle.`, fix: { kind: 'delete', seg: i }, fixLabel: 'Join the shots' });
    // 6. cut in the middle of a word
    if (prev && !x.trans && prev.cam !== x.cam) {
      const c = x.start; const b = at(c - 0.12), a2 = at(c + 0.12);
      if (b !== 0 && b !== BOTH && b === a2 && at(c) === b) {
        const to = quietest(an, c - 0.9, c + 0.9, c);
        if (Math.abs(to - c) > 0.08) add({ t: c, kind: 'midword', msg: `This cut is in the middle of ${name(who(b))}'s sentence. Cut in the breath ${Math.abs(to - c).toFixed(1)} s ${to < c ? 'earlier' : 'later'}.`, fix: { kind: 'move', seg: i, to }, fixLabel: 'Move the cut' });
      }
    }
  });
  // 7. late / early cut to a new speaker
  for (let k = 1; k < T.length; k++) {
    const tr = T[k]; if (tr.who === 0 || tr.who === BOTH || tr.end - tr.start < Math.max(2, st.minTurn * 2)) continue;
    const p = who(tr.who); if (!p) continue;
    const segAt = segmentAt(tr.start + 0.05, segs); if (!segAt || showsP(segAt.cam, p, s, rig)) continue;
    const j = segs.findIndex((x) => x.start > tr.start && x.start < tr.start + 4 && showsP(x.cam, p, s, rig));
    if (j > 0 && segs[j].start - tr.start > 0.9) {
      const to = quietest(an, tr.start - 0.7, tr.start, tr.start - 0.2);
      add({ t: tr.start, kind: 'late', msg: `${name(p)} starts talking but the cut to them comes ${(segs[j].start - tr.start).toFixed(1)} s later. Cut in the pause before they speak.`, fix: { kind: 'move', seg: j, to }, fixLabel: 'Cut earlier' });
    }
  }
  for (let k = 0; k < T.length - 1; k++) {
    const tr = T[k]; const nx = T[k + 1]; if (tr.who === 0 || tr.who === BOTH || nx.who === 0 || nx.who === BOTH) continue;
    const p = who(nx.who); if (!p) continue;
    const j = segs.findIndex((x) => x.start < nx.start - 1 && x.start > tr.start + 0.5 && showsP(x.cam, p, s, rig) && !showsP(x.cam, who(tr.who), s, rig));
    if (j > 0 && rig.wides.length && !showsP(segs[j - 1].cam, p, s, rig)) {
      const to = quietest(an, nx.start - 0.7, nx.start, nx.start - 0.2);
      add({ t: segs[j].start, kind: 'early', msg: `The picture goes to ${name(p)} ${(nx.start - segs[j].start).toFixed(1)} s before they speak, while ${name(who(tr.who))} is still talking.`, fix: { kind: 'move', seg: j, to }, fixLabel: 'Cut later' });
    }
  }
  tips.sort((a, b) => a.t - b.t);
  const out = tips.filter((x, i) => i === 0 || x.key !== tips[i - 1].key).slice(0, 300);
  cache = { key, tips: out };
  return out;
}

/** applies a tip's fix to the edit (one undo step) */
export function applyTip(tip: Tip) {
  const s = usePod.getState(); const f = tip.fix; if (!f) return;
  const segs = s.segments;
  let next: Segment[] = segs;
  if (f.kind === 'paint') next = paint(segs, Math.max(s.analysis?.start ?? 0, f.from), Math.min(s.analysis?.end ?? Infinity, f.to), f.cam, 'manual');
  else if (f.kind === 'move') {
    const i = f.seg; if (i <= 0 || i >= segs.length) return;
    const fr = 1 / s.settings.fps; const t = Math.max(segs[i - 1].start + fr, Math.min(segs[i].end - fr, f.to)); const d = t - segs[i].start;
    next = segs.map((x, k) => (k === i - 1 ? { ...x, end: t } : k === i ? { ...x, start: t, ...(x.srcIn !== undefined ? { srcIn: Math.max(0, x.srcIn + d) } : {}) } : x));
  } else if (f.kind === 'delete') {
    const k = f.seg; if (k <= 0 || k >= segs.length) return;
    next = segs.map((x) => ({ ...x })); next[k - 1].end = next[k].end; next.splice(k, 1);
  }
  usePod.setState({ past: [...s.past.slice(-99), s.segments], future: [], segments: next, edited: true });
}

/** while switching: the input that fits who is talking now (null when the program already fits) */
export function suggestedInput(s: PodState = usePod.getState()): string | null {
  const an = s.analysis; if (!an || an.stub) return null;
  const R = an.rate; const i0 = Math.round((s.time - an.t0) * R);
  if (i0 < 0 || i0 >= an.state.length) return null;
  // who talks in the next 0.6 s (look-ahead: the cut comes in the pause before)
  const counts = new Map<number, number>();
  for (let i = i0; i < Math.min(an.state.length, i0 + Math.round(0.6 * R)); i++) counts.set(an.state[i], (counts.get(an.state[i]) ?? 0) + 1);
  let best = 0, n = 0; for (const [k, c] of counts) if (c > n && k !== 0) { best = k; n = c; }
  if (!best) return null;
  const rig = rigOf(s);
  const pgm = segmentAt(s.time, s.segments)?.cam ?? null;
  if (best === BOTH) { if (pgm && (shows(pgm, s, rig) === 'all' || (rig.splits.find((q) => q.id === pgm)?.people.length ?? 0) >= 2)) return null; return bestFor('both', s, rig); }
  const p = an.speakers[best - 1]; if (!p) return null;
  if (pgm && showsP(pgm, p, s, rig)) return null;
  return bestFor(p, s, rig);
}
