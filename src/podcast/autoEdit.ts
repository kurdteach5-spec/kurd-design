// Automatic multicam edit for conversations (podcast, interview, talk show, panel) with any number of
// cameras and speakers.
//
// Follows common conversation-editing practice:
//  • show the person who is speaking and hold the shot while they keep the floor;
//  • short listener interjections ("yeah", "mm-hmm", laughs) don't cause a cut — they become reaction shots;
//  • several people talking at once (crosstalk) or a long silence → a wide shot;
//  • cut in the pause before the new speaker (or on the first word / slightly late, J-cut style);
//  • a speaker with several cameras gets a different angle on each new turn (no identical repeated framing)
//    and an angle change ("punch-in") inside long answers;
//  • no shot shorter than the minimum shot length and no speaker shot longer than the maximum —
//    long answers get cutaways: another angle, the listener's reaction (preferably a real one, or the person
//    the speaker is answering), or the wide shot, placed on pauses and never back to back;
//  • inserts (a detail camera or B-roll clips) only in the middle of long answers: never before the speaker
//    has been established on screen, never at the end of a turn (we always return to the speaker before the
//    next person talks), never during crosstalk, spaced by a set amount of talk time;
//  • open on an establishing wide shot and close on the wide shot.
import { BOTH, SILENCE, INSERT_EVERY, type Analysis, type EditSettings, type EditStats, type Rig, type Segment, type SegmentReason } from './types';

let segSeq = 0;
export const segId = () => `s${Date.now().toString(36)}${(segSeq++).toString(36)}`;

const LONG_SILENCE = 254;

interface Interjection { t: number; e: number; who: number }

/** time of the quietest moment in [a, b] (seconds), preferring points near `near` */
export function quietest(an: Analysis, a: number, b: number, near: number): number {
  const R = an.rate;
  let best = near, bestScore = Infinity;
  for (let i = Math.max(0, Math.floor((a - an.t0) * R)); i <= Math.min(an.loud.length - 1, Math.ceil((b - an.t0) * R)); i++) {
    const t = an.t0 + i / R;
    const score = an.loud[i] + Math.abs(t - near) * 0.08;
    if (score < bestScore) { bestScore = score; best = t; }
  }
  return best;
}

/** replaces [from, to) with one segment of `cam` */
export function paint(segs: Segment[], from: number, to: number, cam: string, reason: SegmentReason, srcIn?: number): Segment[] {
  if (to <= from) return segs;
  const out: Segment[] = [];
  for (const s of segs) {
    if (s.end <= from || s.start >= to) { out.push(s); continue; }
    if (s.start < from) out.push({ ...s, end: from });
    if (s.end > to) out.push({ ...s, id: segId(), start: to, srcIn: s.srcIn !== undefined ? s.srcIn + (to - s.start) : undefined });
  }
  out.push({ id: segId(), start: from, end: to, cam, reason, ...(srcIn !== undefined ? { srcIn } : {}) });
  return out.sort((x, y) => x.start - y.start);
}

/** frame-snaps cuts, merges shots shorter than minShot into a neighbour and joins equal neighbours */
export function cleanup(segs: Segment[], minShot: number, fps: number, start: number, end: number): Segment[] {
  const snap = (t: number) => Math.round(t * fps) / fps;
  let s = segs.map((x) => {
    const ns = snap(x.start);
    return { ...x, start: ns, end: snap(x.end), ...(x.srcIn !== undefined ? { srcIn: Math.max(0, x.srcIn + (ns - x.start)) } : {}) };
  }).filter((x) => x.end - x.start > 0.5 / fps);
  if (!s.length) return [{ id: segId(), start, end, cam: segs[0]?.cam ?? '', reason: 'opening' }];
  s[0].start = snap(start); s[s.length - 1].end = snap(end);
  for (let i = 1; i < s.length; i++) s[i].start = s[i - 1].end;
  const sameShot = (p: Segment, x: Segment) => p.cam === x.cam && (p.srcIn === undefined || (x.srcIn !== undefined && Math.abs(p.srcIn + (p.end - p.start) - x.srcIn) < 2 / fps));
  const join = () => {
    const out: Segment[] = [];
    for (const x of s) {
      const p = out[out.length - 1];
      if (p && sameShot(p, x)) p.end = x.end; else out.push({ ...x });
    }
    s = out;
  };
  join();
  for (let guard = 0; guard < 100000 && s.length > 1; guard++) {
    let k = -1, shortest = Infinity;
    for (let i = 0; i < s.length; i++) { const d = s[i].end - s[i].start; if (d < minShot - 1e-6 && d < shortest) { shortest = d; k = i; } }
    if (k < 0) break;
    // a short shot is absorbed by the previous shot (the cut simply happens later), the first one by the next
    if (k > 0) s[k - 1].end = s[k].end;
    else { const d = s[1].start - s[0].start; s[1].start = s[0].start; if (s[1].srcIn !== undefined) s[1].srcIn = Math.max(0, s[1].srcIn - d); }
    s.splice(k, 1);
    join();
  }
  return s;
}

export function autoEdit(an: Analysis, st: EditSettings, rig: Rig): Segment[] {
  const R = an.rate;
  const N = an.speakers.length;
  const i0 = Math.max(0, Math.round((an.start - an.t0) * R)), i1 = Math.min(an.state.length, Math.round((an.end - an.t0) * R));
  const T = (i: number) => an.t0 + i / R;
  const camsOf = (k: number) => rig.speakerCams[an.speakers[k - 1]] ?? [];
  const speakerOfCam = new Map<string, number>();
  an.speakers.forEach((id, k) => (rig.speakerCams[id] ?? []).forEach((c) => speakerOfCam.set(c, k + 1)));
  const isSpeaker = (k: number) => k >= 1 && k <= N;
  let wideTurn = 0;
  const nextWide = () => (rig.wides.length ? rig.wides[wideTurn++ % rig.wides.length] : null);
  /** a split screen showing both people (the one with exactly these two first) */
  const splitFor = (p: number, q: number) => {
    if (!st.splitDialog || !p || !q || p === q) return null;
    const a = an.speakers[p - 1], b = an.speakers[q - 1];
    const fits = rig.splits.filter((x) => x.people.includes(a) && x.people.includes(b));
    return (fits.find((x) => x.people.length === 2) ?? fits[0])?.id ?? null;
  };

  // 1. runs of speech states
  const runs: { s: number; e: number; k: number }[] = [];
  for (let i = i0; i < i1;) { let j = i; while (j < i1 && an.state[j] === an.state[i]) j++; runs.push({ s: i, e: j, k: an.state[i] }); i = j; }

  // 2. turn-taking: who "has the floor" in each run
  const interjections: Interjection[] = [];
  const intents: { s: number; e: number; label: number }[] = [];
  let cur = 0;
  for (const r of runs) {
    const dur = (r.e - r.s) / R;
    let label = cur;
    if (r.k === SILENCE) label = dur >= st.wideOnSilence ? LONG_SILENCE : cur;
    else if (r.k === BOTH || !isSpeaker(r.k)) label = st.wideOnCrosstalk && dur >= 0.8 ? BOTH : cur || BOTH;
    else if (isSpeaker(cur) && cur !== r.k && dur < st.minTurn) { interjections.push({ t: T(r.s), e: T(r.e), who: r.k }); label = cur; }
    else label = r.k;
    if (label !== LONG_SILENCE) cur = label;
    const last = intents[intents.length - 1];
    if (last && last.label === label) last.e = r.e; else intents.push({ s: r.s, e: r.e, label });
  }

  // 3. cut points and cameras
  let segs: Segment[] = [];
  const turns: { k: number; start: number; end: number; prev: number }[] = [];
  const angleIdx = new Map<number, number>();
  let tPrev = an.start, lastSpeaker = 0, prevSpeaker = 0, lastCam = '';
  for (let n = 0; n < intents.length; n++) {
    const it = intents[n];
    const label = it.label || LONG_SILENCE;
    let cut = T(it.s);
    if (n === 0) cut = an.start;
    else if (label === LONG_SILENCE) cut = T(it.s) + Math.min(1, (it.e - it.s) / R / 3);
    else if (label === BOTH) cut = T(it.s) + 0.1;
    else if (st.cutTiming === 'late') cut = T(it.s) + 0.25;
    else if (st.cutTiming === 'pause') cut = quietest(an, T(it.s) - 0.45, T(it.s) + 0.04, T(it.s) - 0.15);
    cut = Math.max(cut, tPrev);
    let cam: string | null = null; let reason: SegmentReason = 'speaker';
    if (isSpeaker(label)) {
      const cams = camsOf(label);
      if (cams.length) {
        // a different angle on each new turn of the same person
        const a = angleIdx.has(label) && st.angles ? (angleIdx.get(label)! + 1) % cams.length : 0;
        angleIdx.set(label, a); cam = cams[a];
      } else cam = nextWide();
      turns.push({ k: label, start: cut, end: an.end, prev: lastSpeaker !== label ? lastSpeaker : turns[turns.length - 1]?.prev ?? 0 });
      if (turns.length > 1) turns[turns.length - 2].end = Math.min(turns[turns.length - 2].end, cut);
      if (lastSpeaker !== label) { prevSpeaker = lastSpeaker; lastSpeaker = label; }
    } else {
      // crosstalk between the last two speakers → their split screen when there is one, else a wide shot
      cam = (label === BOTH ? splitFor(lastSpeaker, prevSpeaker) : null) ?? nextWide(); reason = label === BOTH ? 'crosstalk' : 'pause';
      if (turns.length) turns[turns.length - 1].end = Math.min(turns[turns.length - 1].end, cut);
    }
    if (!cam) cam = lastCam || rig.wides[0] || Object.values(rig.speakerCams).flat()[0] || '';
    if (n > 0 && segs.length) segs[segs.length - 1].end = cut;
    segs.push({ id: segId(), start: cut, end: an.end, cam, reason: n === 0 && !it.label ? 'opening' : reason });
    tPrev = cut; lastCam = cam;
  }
  if (!segs.length) segs = [{ id: segId(), start: an.start, end: an.end, cam: rig.wides[0] ?? Object.values(rig.speakerCams).flat()[0] ?? '', reason: 'opening' }];

  // 3b. quick back-and-forth between two people (≥ 3 short turns in a row) → their split screen
  if (st.splitDialog && rig.splits.length) {
    const short = Math.max(st.minShot * 2, 4.5);
    const spk = (x: Segment) => speakerOfCam.get(x.cam) ?? 0;
    const paints: { from: number; to: number; cam: string }[] = [];
    for (let i = 0; i < segs.length;) {
      const p = spk(segs[i]);
      if (!p || segs[i].end - segs[i].start > short) { i++; continue; }
      let j = i + 1, q = 0;
      while (j < segs.length) {
        const k = spk(segs[j]);
        if (!k || segs[j].end - segs[j].start > short) break;
        if (k === spk(segs[j - 1])) break;
        if (k !== p) { if (q && k !== q) break; q = k; }
        j++;
      }
      const split = q ? splitFor(p, q) : null;
      if (split && j - i >= 3) { paints.push({ from: segs[i].start, to: segs[j - 1].end, cam: split }); i = j; } else i++;
    }
    for (const x of paints) segs = paint(segs, x.from, x.to, x.cam, 'split');
  }

  // 4. variety in long answers: another angle, a reaction shot or the wide shot
  const turnAt = (t: number) => turns.find((x) => t >= x.start && t < x.end);
  if (st.reactions || st.wideCutaways || st.angles) {
    let alt = 0;
    for (let pass = 0; pass < 4; pass++) {
      const extra: { from: number; to: number; cam: string; reason: SegmentReason }[] = [];
      for (const sg of segs) {
        const k = speakerOfCam.get(sg.cam); if (!k) continue;
        const dur = sg.end - sg.start;
        if (dur <= st.maxShot * (pass ? 1.2 : 1)) continue;
        const n = Math.max(1, Math.floor(dur / st.maxShot));
        const own = camsOf(k);
        const turn = turnAt(sg.start + 0.01);
        let lastEnd = sg.start;
        for (let j = 1; j <= n; j++) {
          const center = sg.start + (dur * j) / (n + 1);
          const kinds: ('angle' | 'reaction' | 'wide')[] = [];
          if (st.angles && own.length > 1) kinds.push('angle');
          if (st.reactions && an.speakers.some((_, q) => q + 1 !== k && camsOf(q + 1).length)) kinds.push('reaction');
          if (st.wideCutaways && rig.wides.length) kinds.push('wide');
          if (!kinds.length) break;
          const kind = kinds[alt++ % kinds.length];
          const earliest = Math.max(sg.start + st.minShot, lastEnd + Math.max(st.minShot * 1.5, st.maxShot / 3));
          if (kind === 'angle') {
            const from = Math.max(earliest, quietest(an, center - 0.8, center + 0.8, center));
            if (from > sg.end - st.minShot) continue;
            const other = own[(own.indexOf(sg.cam) + 1) % own.length];
            extra.push({ from, to: sg.end, cam: other, reason: 'angle' });
            lastEnd = from;
            continue;
          }
          const len = kind === 'reaction' ? Math.max(st.minShot, 2.2) : Math.max(st.minShot, 3);
          let listener = 0;
          let ij: Interjection | undefined;
          if (kind === 'reaction') {
            // prefer a real reaction (an interjection) close to the planned point, else the person being answered
            ij = interjections.find((x) => x.who !== k && camsOf(x.who).length && Math.abs(x.t - center) < st.maxShot / 3 && x.t - 0.4 >= earliest && x.e + 1 < sg.end - st.minShot);
            listener = ij?.who ?? (turn && turn.prev && camsOf(turn.prev).length ? turn.prev : an.speakers.findIndex((_, q) => q + 1 !== k && camsOf(q + 1).length) + 1);
          }
          let from = ij ? ij.t - 0.4 : quietest(an, center - 0.8, center + 0.8, center);
          let to = ij ? Math.max(from + len, ij.e + 0.8) : from + len;
          if (from < earliest) { to += earliest - from; from = earliest; }
          if (to > sg.end - st.minShot) continue;
          to = Math.max(from + st.minShot + 0.05, quietest(an, to - 0.3, to + 0.5, to));
          const cam = kind === 'reaction' ? camsOf(listener)[0] : nextWide()!;
          if (!cam) continue;
          extra.push({ from, to, cam, reason: kind === 'reaction' ? 'reaction' : 'variety' });
          lastEnd = to;
        }
      }
      if (!extra.length) break;
      for (const x of extra) segs = paint(segs, x.from, x.to, x.cam, x.reason);
    }
  }

  // 5. inserts (detail camera, B-roll) in the middle of long answers
  const every = INSERT_EVERY[st.inserts];
  const sources = [...rig.inserts.map((id) => ({ id, broll: false, dur: 0 })), ...rig.broll.filter((b) => b.duration >= 1.2).map((b) => ({ id: b.id, broll: true, dur: b.duration }))];
  if (every > 0 && sources.length) {
    const len = Math.max(st.minShot, st.insertLen);
    const establish = Math.max(st.minShot, 4);
    const pointer = new Map<string, number>();
    let next = 0, talk = every * 0.6;
    for (const tn of turns) {
      const tdur = tn.end - tn.start;
      let t = tn.start + establish;
      let lastHere = -Infinity;
      while (t + len + st.minShot + 0.5 <= tn.end) {
        const need = every - talk;
        if (need > 0) { const step = Math.min(need, tn.end - t); talk += step; t += step; continue; }
        const from = quietest(an, t - 0.6, t + 0.6, t);
        const to = from + len;
        // only over this speaker's own shots, with room around, never back to back with another cutaway
        const clash = segs.some((x) => x.end > from - st.minShot && x.start < to + st.minShot && speakerOfCam.get(x.cam) !== tn.k);
        if (clash || to + st.minShot > tn.end || from - lastHere < every / 2) { t += 2; talk += 2; continue; }
        const src = sources[next++ % sources.length];
        let srcIn: number | undefined;
        if (src.broll) {
          let p = pointer.get(src.id) ?? Math.min(1, src.dur * 0.05);
          const l = Math.min(len, src.dur - 0.2);
          if (p + l > src.dur - 0.1) p = Math.min(0.5, Math.max(0, src.dur - l - 0.1));
          srcIn = p; pointer.set(src.id, p + l + 0.5);
          segs = paint(segs, from, from + l, src.id, 'broll', srcIn);
        } else segs = paint(segs, from, to, src.id, 'insert');
        lastHere = to; talk = 0; t = to + st.minShot;
      }
      void tdur;
    }
  }

  // 6. establishing and closing wide shots
  const wide0 = rig.wides[0];
  if (wide0 && st.openingWide > 0) segs = paint(segs, an.start, Math.min(an.end, an.start + st.openingWide), wide0, 'opening');
  if (wide0 && st.closingWide > 0) segs = paint(segs, Math.max(an.start, an.end - st.closingWide), an.end, rig.wides[rig.wides.length > 1 ? 1 : 0], 'closing');

  return cleanup(segs, st.minShot, st.fps, an.start, an.end);
}

export function editStats(segs: Segment[], an: Analysis | null): EditStats {
  const duration = segs.length ? segs[segs.length - 1].end - segs[0].start : 0;
  const share: Record<string, number> = {};
  for (const s of segs) share[s.cam] = (share[s.cam] ?? 0) + s.end - s.start;
  for (const k of Object.keys(share)) share[k] = duration ? share[k] / duration : 0;
  const talk: Record<string, number> = { both: 0, silence: 0 };
  if (an) {
    for (const id of an.speakers) talk[id] = 0;
    const i0 = Math.round((an.start - an.t0) * an.rate), i1 = Math.round((an.end - an.t0) * an.rate);
    for (let i = i0; i < i1; i++) {
      const k = an.state[i];
      if (k === SILENCE) talk.silence++; else if (k === BOTH || k > an.speakers.length) talk.both++; else talk[an.speakers[k - 1]]++;
    }
    const n = Math.max(1, i1 - i0);
    for (const key of Object.keys(talk)) talk[key] /= n;
  }
  return { duration, shots: segs.length, cuts: Math.max(0, segs.length - 1), asl: segs.length ? duration / segs.length : 0, cutsPerMinute: duration ? (Math.max(0, segs.length - 1) / duration) * 60 : 0, share, talk };
}
