// "Sound follows the speaker" (automix): each person's own sound (microphone, else their camera's sound)
// is open only while that person speaks; the others are turned down. Like a broadcast automixer:
//  • opens 0.15 s before the first word (look-ahead, the recording is known) and stays open 0.5 s after the last;
//  • several people at once → all of them open;
//  • during silences the last speaker's sound stays open (room tone, no "dead air");
//  • 60 ms fades, so switching is never heard as a click.
import { BOTH, type Analysis, type EditSettings } from './types';
import type { PodState } from './store';

export interface AutomixTrack { source: string; gains: Float32Array }

/** the sound source of each person (in analysis order): own microphone, else first own camera */
export function personSources(an: Analysis, s: Pick<PodState, 'speakers' | 'cameras' | 'sources'>): (string | null)[] {
  return an.speakers.map((id) => {
    const sp = s.speakers.find((x) => x.id === id);
    if (sp?.mic && s.sources[sp.mic]) return sp.mic;
    return s.cameras.find((c) => c.role === 'speaker' && c.speaker === id && s.sources[c.id])?.id ?? null;
  });
}

export function automix(an: Analysis, st: Pick<EditSettings, 'duckDb'>, s: Pick<PodState, 'speakers' | 'cameras' | 'sources'>): AutomixTrack[] {
  const n = an.state.length, R = an.rate, V = an.speakers.length;
  const pre = Math.round(0.15 * R), hang = Math.round(0.5 * R), ramp = Math.max(1, Math.round(0.06 * R));
  const low = st.duckDb <= -60 ? 0 : Math.pow(10, st.duckDb / 20);
  // 1. who is open in each frame
  const open: Uint8Array[] = Array.from({ length: V }, () => new Uint8Array(n));
  for (let i = 0; i < n; i++) {
    const k = an.state[i];
    if (k === BOTH) { for (let v = 0; v < V; v++) if (an.levels[v][i] > 0.3) open[v][i] = 1; }
    else if (k >= 1 && k <= V) open[k - 1][i] = 1;
  }
  // hangover and look-ahead
  for (let v = 0; v < V; v++) {
    const o = open[v], ext = new Uint8Array(n);
    let last = -Infinity;
    for (let i = 0; i < n; i++) { if (o[i]) last = i; if (i - last <= hang) ext[i] = 1; }
    let nextOn = Infinity;
    for (let i = n - 1; i >= 0; i--) { if (o[i]) nextOn = i; if (nextOn - i <= pre) ext[i] = 1; }
    open[v] = ext;
  }
  // silences: the last person who spoke stays open
  let lastV = -1;
  for (let i = 0; i < n; i++) {
    let any = false; for (let v = 0; v < V; v++) if (open[v][i]) { any = true; }
    if (any) { for (let v = 0; v < V; v++) if (open[v][i] && an.state[i] === v + 1) lastV = v; if (lastV < 0) for (let v = 0; v < V; v++) if (open[v][i]) lastV = v; }
    else if (lastV >= 0) open[lastV][i] = 1;
  }
  // 2. gains with short fades, merged per sound source
  const srcs = personSources(an, s);
  const out = new Map<string, Float32Array>();
  for (let v = 0; v < V; v++) {
    const src = srcs[v]; if (!src) continue;
    const g = new Float32Array(n);
    let cur = open[v][0] ? 1 : low;
    for (let i = 0; i < n; i++) {
      const target = open[v][i] ? 1 : low;
      cur += Math.max(-(1 - low) / ramp, Math.min((1 - low) / ramp, target - cur));
      g[i] = cur;
    }
    const prev = out.get(src);
    if (prev) for (let i = 0; i < n; i++) prev[i] = Math.max(prev[i], g[i]); else out.set(src, g);
  }
  return [...out].map(([source, gains]) => ({ source, gains }));
}

/** gain of a track at timeline time T */
export function gainAt(tr: AutomixTrack, an: Analysis, T: number): number {
  const i = Math.round((T - an.t0) * an.rate);
  return tr.gains[Math.max(0, Math.min(tr.gains.length - 1, i))] ?? 1;
}

/** open regions (gain > 0.5) of a track, merged when closer than `join` seconds — for editors' audio tracks */
export function openRegions(tr: AutomixTrack, an: Analysis, from: number, to: number, join = 0.4): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const i0 = Math.max(0, Math.round((from - an.t0) * an.rate)), i1 = Math.min(tr.gains.length, Math.round((to - an.t0) * an.rate));
  for (let i = i0; i < i1;) {
    if (tr.gains[i] <= 0.5) { i++; continue; }
    let j = i; while (j < i1 && tr.gains[j] > 0.5) j++;
    const a = an.t0 + i / an.rate, b = an.t0 + j / an.rate;
    const p = out[out.length - 1];
    if (p && a - p.end < join) p.end = b; else out.push({ start: a, end: b });
    i = j;
  }
  return out;
}
