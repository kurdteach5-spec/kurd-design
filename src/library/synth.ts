// Shared building blocks of the library's sound engine (Web Audio, rendered offline): envelopes,
// oscillator voices, noise, plucked strings (Karplus–Strong), drums and a generated reverb.
export type Ctx = OfflineAudioContext;

export function rnd(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
export const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** attack / decay / sustain / release on a gain, starting silent at t */
export function adsr(g: AudioParam, t: number, dur: number, peak: number, a: number, d: number, s: number, r: number) {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + Math.max(0.002, a));
  g.setTargetAtTime(peak * s, t + a, Math.max(0.005, d / 3));
  const end = t + Math.max(a + 0.01, dur);
  g.setTargetAtTime(0, end, Math.max(0.005, r / 3));
}

const noiseCache = new WeakMap<Ctx, AudioBuffer>();
export function noiseBuf(ctx: Ctx): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate); const d = b.getChannelData(0);
    let s = 12345; for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x7fffffff) * 2 - 1; }
    noiseCache.set(ctx, b);
  }
  return b;
}
export function noise(ctx: Ctx, t: number, dur: number, r = Math.random): AudioBufferSourceNode {
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx); n.loop = true;
  n.start(t, r() * 2.5); n.stop(t + dur + 0.05); return n;
}
export function filt(ctx: Ctx, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
export function gainN(ctx: Ctx, v = 1): GainNode { const g = ctx.createGain(); g.gain.value = v; return g; }
export function panN(ctx: Ctx, p: number): StereoPannerNode { const s = ctx.createStereoPanner(); s.pan.value = Math.max(-1, Math.min(1, p)); return s; }

export interface VoiceOpts {
  type?: OscillatorType; detune?: number[]; gain?: number; a?: number; d?: number; s?: number; r?: number;
  lp?: number; lpEnd?: number; lpTime?: number; q?: number; hp?: number; pan?: number; vib?: number; vibRate?: number; glideFrom?: number; glideTime?: number;
}
/** a synth voice: oscillators (detuned) → filter → envelope → pan */
export function voice(ctx: Ctx, dest: AudioNode, t: number, f: number, dur: number, o: VoiceOpts = {}) {
  const env = gainN(ctx, 0); const a = o.a ?? 0.01, r = o.r ?? 0.2;
  adsr(env.gain, t, dur, o.gain ?? 0.2, a, o.d ?? 0.2, o.s ?? 0.7, r);
  let head: AudioNode = env;
  if (o.lp) {
    const lp = filt(ctx, 'lowpass', o.lp, o.q ?? 0.7);
    if (o.lpEnd !== undefined) { lp.frequency.setValueAtTime(o.lp, t); lp.frequency.exponentialRampToValueAtTime(Math.max(40, o.lpEnd), t + (o.lpTime ?? dur)); }
    lp.connect(env); head = lp;
  }
  if (o.hp) { const hp = filt(ctx, 'highpass', o.hp); hp.connect(head); head = hp; }
  const out = o.pan ? panN(ctx, o.pan) : null;
  if (out) { env.connect(out); out.connect(dest); } else env.connect(dest);
  const stop = t + dur + r * 2 + 0.05;
  let vib: OscillatorNode | null = null, vibG: GainNode | null = null;
  if (o.vib) { vib = ctx.createOscillator(); vib.frequency.value = o.vibRate ?? 5.5; vibG = gainN(ctx, o.vib); vib.connect(vibG); vib.start(t); vib.stop(stop); }
  for (const dt of o.detune ?? [0]) {
    const osc = ctx.createOscillator(); osc.type = o.type ?? 'sawtooth';
    if (o.glideFrom) { osc.frequency.setValueAtTime(o.glideFrom, t); osc.frequency.exponentialRampToValueAtTime(f, t + (o.glideTime ?? 0.08)); } else osc.frequency.value = f;
    osc.detune.value = dt; if (vibG) vibG.connect(osc.detune);
    osc.connect(head); osc.start(t); osc.stop(stop);
  }
  return env;
}

/** plucked string (Karplus–Strong), rendered into a buffer */
const ksCache = new WeakMap<Ctx, Map<string, AudioBuffer>>();
export function pluckBuf(ctx: Ctx, f: number, dur: number, bright = 0.5, decay = 0.996): AudioBuffer {
  let m = ksCache.get(ctx); if (!m) { m = new Map(); ksCache.set(ctx, m); }
  const key = `${f.toFixed(2)}|${dur.toFixed(2)}|${bright}|${decay}`;
  const hit = m.get(key); if (hit) return hit;
  const sr = ctx.sampleRate; const len = Math.max(1, Math.floor(sr * dur)); const b = ctx.createBuffer(1, len, sr); const y = b.getChannelData(0);
  const N = Math.max(2, Math.round(sr / f)); let s = Math.floor(f * 997) + 7;
  for (let i = 0; i < N && i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; y[i] = (s / 0x7fffffff) * 2 - 1; }
  // brighter strings average less
  const k = 0.5 - (bright - 0.5) * 0.35;
  for (let i = N; i < len; i++) y[i] = decay * (k * y[i - N] + (1 - k) * y[i - N + 1]);
  // soften the start click
  for (let i = 0; i < Math.min(len, 64); i++) y[i] *= i / 64;
  m.set(key, b); return b;
}
export function pluck(ctx: Ctx, dest: AudioNode, t: number, f: number, dur: number, gain = 0.3, bright = 0.5, pan = 0, decay = 0.996) {
  const src = ctx.createBufferSource(); src.buffer = pluckBuf(ctx, f, dur, bright, decay);
  const g = gainN(ctx, gain); src.connect(g);
  if (pan) { const p = panN(ctx, pan); g.connect(p); p.connect(dest); } else g.connect(dest);
  src.start(t); return g;
}

// ---------------- drums ----------------
export function kick(ctx: Ctx, dest: AudioNode, t: number, v = 1, punch = 1) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(150 * punch, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
  const g = gainN(ctx, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9 * v, t + 0.003); g.gain.setTargetAtTime(0, t + 0.04, 0.09);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.6);
}
export function snare(ctx: Ctx, dest: AudioNode, t: number, v = 1, tone = 180, len = 0.18) {
  const n = noise(ctx, t, len + 0.2); const bp = filt(ctx, 'bandpass', 1800, 0.8); const g = gainN(ctx, 0);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * v, t + 0.002); g.gain.setTargetAtTime(0, t + 0.01, len / 3);
  n.connect(bp); bp.connect(g); g.connect(dest);
  voice(ctx, dest, t, tone, 0.05, { type: 'triangle', gain: 0.35 * v, a: 0.001, d: 0.05, s: 0, r: 0.05 });
}
export function hat(ctx: Ctx, dest: AudioNode, t: number, v = 1, open = false, pan = 0.2) {
  const n = noise(ctx, t, open ? 0.5 : 0.08); const hp = filt(ctx, 'highpass', 7000); const g = gainN(ctx, 0);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18 * v, t + 0.001); g.gain.setTargetAtTime(0, t + 0.005, open ? 0.12 : 0.02);
  const p = panN(ctx, pan); n.connect(hp); hp.connect(g); g.connect(p); p.connect(dest);
}
export function clap(ctx: Ctx, dest: AudioNode, t: number, v = 1) {
  for (let i = 0; i < 3; i++) { const tt = t + i * 0.011; const n = noise(ctx, tt, 0.25); const bp = filt(ctx, 'bandpass', 1300, 1.2); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.45 * v, tt + 0.002); g.gain.setTargetAtTime(0, tt + 0.003, i === 2 ? 0.06 : 0.008); n.connect(bp); bp.connect(g); g.connect(dest); }
}
export function tom(ctx: Ctx, dest: AudioNode, t: number, f = 110, v = 1, len = 0.5) {
  const o = ctx.createOscillator(); o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
  const g = gainN(ctx, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.7 * v, t + 0.004); g.gain.setTargetAtTime(0, t + 0.03, len / 3);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + len * 2 + 0.1);
  const n = noise(ctx, t, 0.1); const lp = filt(ctx, 'lowpass', 900); const ng = gainN(ctx, 0); ng.gain.setValueAtTime(0.25 * v, t); ng.gain.setTargetAtTime(0, t + 0.01, 0.03); n.connect(lp); lp.connect(ng); ng.connect(dest);
}
export function boom(ctx: Ctx, dest: AudioNode, t: number, v = 1, len = 2.5) {
  const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.6);
  const g = gainN(ctx, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9 * v, t + 0.01); g.gain.setTargetAtTime(0, t + 0.1, len / 3);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + len * 2);
  const n = noise(ctx, t, len); const lp = filt(ctx, 'lowpass', 400); const ng = gainN(ctx, 0); ng.gain.setValueAtTime(0.5 * v, t); ng.gain.setTargetAtTime(0, t + 0.05, len / 4); n.connect(lp); lp.connect(ng); ng.connect(dest);
}
/** rising noise sweep that ends at `end` */
export function riser(ctx: Ctx, dest: AudioNode, start: number, end: number, v = 1, tone = false) {
  const d = Math.max(0.2, end - start);
  const n = noise(ctx, start, d); const bp = filt(ctx, 'bandpass', 200, 1.5); bp.frequency.setValueAtTime(200, start); bp.frequency.exponentialRampToValueAtTime(7000, end);
  const g = gainN(ctx, 0); g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(0.35 * v, end - 0.02); g.gain.linearRampToValueAtTime(0, end + 0.03);
  n.connect(bp); bp.connect(g); g.connect(dest);
  if (tone) voice(ctx, dest, start, 880, d, { type: 'sawtooth', detune: [-12, 12], gain: 0.07 * v, a: d * 0.9, s: 1, r: 0.05, glideFrom: 110, glideTime: d, lp: 3000 });
}

/** reverb impulse: decaying stereo noise */
export function impulse(ctx: Ctx, seconds: number, decay = 2.5): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds); const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let s = 777 + c * 991; for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = ((s / 0x7fffffff) * 2 - 1) * Math.pow(1 - i / len, decay); } }
  return b;
}

/** master: dry + reverb → compressor → fades; returns the bus to connect instruments to */
export function masterChain(ctx: Ctx, dur: number, reverb: number, fadeOut = 2.5, fadeIn = 0.02) {
  const bus = gainN(ctx, 1);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.25;
  const out = gainN(ctx, 0); out.gain.setValueAtTime(0, 0); out.gain.linearRampToValueAtTime(0.95, fadeIn);
  const fo = Math.min(fadeOut, dur * 0.3); out.gain.setValueAtTime(0.95, Math.max(fadeIn, dur - fo)); out.gain.linearRampToValueAtTime(0, dur);
  bus.connect(comp);
  if (reverb > 0) { const send = gainN(ctx, reverb * 0.6); const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, Math.min(2.4, 1.2 + reverb * 1.8), 2.4 + (1 - reverb) * 2); bus.connect(send); send.connect(conv); conv.connect(comp); }
  comp.connect(out); out.connect(ctx.destination);
  return bus;
}
