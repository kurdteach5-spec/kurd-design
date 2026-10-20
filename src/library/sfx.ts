// Synthesises the library's sound effects (whooshes, impacts, weather, nature, city, UI, sci-fi, crowd…).
import type { Track } from './catalog';
import { type Ctx, rnd, voice, noise, filt, gainN, panN, kick, snare, tom, boom, riser, hat, clap, pluck, masterChain, hz } from './synth';

type Gen = (ctx: Ctx, out: AudioNode, d: number, p: Record<string, number>, r: () => number) => void;

/** a noise burst through a filter with an envelope */
function burst(ctx: Ctx, out: AudioNode, t: number, len: number, type: BiquadFilterType, f: number, q: number, v: number, a = 0.002, pan = 0) {
  const n = noise(ctx, t, len + 0.1); const fl = filt(ctx, type, f, q); const g = gainN(ctx, 0);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.setTargetAtTime(0, t + a, Math.max(0.003, len / 3));
  n.connect(fl); fl.connect(g); if (pan) { const p = panN(ctx, pan); g.connect(p); p.connect(out); } else g.connect(out);
  return fl;
}
/** steady noise bed with optional slow wobble */
function bed(ctx: Ctx, out: AudioNode, d: number, type: BiquadFilterType, f: number, q: number, v: number, wobble = 0, rate = 0.2) {
  const n = noise(ctx, 0, d); const fl = filt(ctx, type, f, q); const g = gainN(ctx, v);
  if (wobble) { const l = ctx.createOscillator(); l.frequency.value = rate; const lg = gainN(ctx, f * wobble); l.connect(lg); lg.connect(fl.frequency); l.start(0); l.stop(d); const l2 = ctx.createOscillator(); l2.frequency.value = rate * 0.7; const l2g = gainN(ctx, v * 0.5); l2.connect(l2g); l2g.connect(g.gain); l2.start(0); l2.stop(d); }
  n.connect(fl); fl.connect(g); g.connect(out); return g;
}
const tone = (ctx: Ctx, out: AudioNode, t: number, f: number, len: number, type: OscillatorType = 'sine', v = 0.2, extra: Parameters<typeof voice>[5] = {}) => voice(ctx, out, t, f, len, { type, gain: v, a: 0.003, d: len * 0.6, s: 0.3, r: len * 0.4, ...extra });

const G: Record<string, Gen> = {
  whoosh(ctx, out, d, p) {
    const len = p.len ?? 1; const t0 = Math.max(0, (d - len) / 2 - 0.1);
    const n = noise(ctx, t0, len + 0.3); const bp = filt(ctx, 'bandpass', p.low ? 250 : 400, 1.3);
    bp.frequency.setValueAtTime(p.low ? 150 : 300, t0); bp.frequency.exponentialRampToValueAtTime(p.low ? 1200 : 4200, t0 + len * 0.6); bp.frequency.exponentialRampToValueAtTime(p.low ? 200 : 500, t0 + len);
    const g = gainN(ctx, 0); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.7, t0 + len * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len + 0.2);
    const pn = panN(ctx, 0); pn.pan.setValueAtTime(-0.8, t0); pn.pan.linearRampToValueAtTime(0.8, t0 + len);
    n.connect(bp); bp.connect(g); g.connect(pn); pn.connect(out);
    if (p.low) boom(ctx, out, t0 + len * 0.6, 0.3, 1);
  },
  swish(ctx, out, _d, p) {
    const one = (t: number, dir: number) => { const n = noise(ctx, t, 0.4); const bp = filt(ctx, 'bandpass', 1200, 0.9); bp.frequency.setValueAtTime(800, t); bp.frequency.exponentialRampToValueAtTime(6000, t + 0.18); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.6, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); const pn = panN(ctx, 0); pn.pan.setValueAtTime(-dir, t); pn.pan.linearRampToValueAtTime(dir, t + 0.3); n.connect(bp); bp.connect(g); g.connect(pn); pn.connect(out); };
    one(0.1, p.dir ?? 1); if (p.twice) one(0.55, -1);
  },
  impact(ctx, out, _d, p) {
    boom(ctx, out, 0.05, 1, 3); burst(ctx, out, 0.05, 0.5, 'lowpass', 2500, 0.7, 0.6);
    if (p.metal) for (const f of [523, 1187, 1873, 2711]) tone(ctx, out, 0.05, f, 2.5, 'sine', 0.05, { d: 2, s: 0, r: 1.5 });
    if (p.braam) for (const n of [33, 40, 45]) voice(ctx, out, 0.05, hz(n), 3.5, { type: 'sawtooth', detune: [-10, 10], gain: 0.12, a: 0.05, d: 2, s: 0.5, r: 1, lp: 900, lpEnd: 300, lpTime: 3 });
  },
  boom(ctx, out, _d, p) { boom(ctx, out, 0.05, 1, 4); if (p.drop) { const o = ctx.createOscillator(); o.frequency.setValueAtTime(120, 0.05); o.frequency.exponentialRampToValueAtTime(25, 2.5); const g = gainN(ctx, 0); g.gain.setValueAtTime(0.6, 0.05); g.gain.exponentialRampToValueAtTime(0.001, 3); o.connect(g); g.connect(out); o.start(0.05); o.stop(3.2); } },
  riser(ctx, out, _d, p) {
    const len = p.len ?? 4;
    if (p.rev) { const n = noise(ctx, 0, len); const lp = filt(ctx, 'lowpass', 300); lp.frequency.exponentialRampToValueAtTime(8000, len); const g = gainN(ctx, 0); g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.6, len - 0.02); g.gain.linearRampToValueAtTime(0, len + 0.02); n.connect(lp); lp.connect(g); g.connect(out); for (const f of [220, 330, 440]) voice(ctx, out, 0, f, len, { type: 'sawtooth', gain: 0.03, a: len * 0.95, s: 1, r: 0.02, lp: 2000 }); return; }
    riser(ctx, out, 0, len, 1, !!p.tone); if (p.tone) boom(ctx, out, len, 0.5, 1);
  },
  drop(ctx, out) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(1600, 0); o.frequency.exponentialRampToValueAtTime(40, 1.6); const lp = filt(ctx, 'lowpass', 3000); lp.frequency.exponentialRampToValueAtTime(200, 1.6); const g = gainN(ctx, 0.2); g.gain.setTargetAtTime(0, 1.4, 0.2); o.connect(lp); lp.connect(g); g.connect(out); o.start(0); o.stop(2.2); boom(ctx, out, 0.02, 0.6, 2); },
  explosion(ctx, out, d, p) {
    const far = !!p.far;
    const n = noise(ctx, 0.05, d); const lp = filt(ctx, 'lowpass', far ? 500 : 2000); lp.frequency.setValueAtTime(far ? 600 : 3000, 0.05); lp.frequency.exponentialRampToValueAtTime(far ? 120 : 200, d); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, 0.05); g.gain.linearRampToValueAtTime(far ? 0.5 : 1, 0.07); g.gain.setTargetAtTime(0, 0.1, d / 4); n.connect(lp); lp.connect(g); g.connect(out);
    boom(ctx, out, 0.05, far ? 0.6 : 1, 3);
    if (!far) { const r = rnd(9); for (let i = 0; i < 40; i++) burst(ctx, out, 0.3 + r() * (d - 1.5), 0.03, 'highpass', 2500, 0.7, 0.15 * r(), 0.001, r() * 2 - 1); }
  },
  crash(ctx, out, d, p) {
    const r = rnd(4);
    if (p.glass) { burst(ctx, out, 0.05, 0.4, 'highpass', 3000, 0.7, 0.6); for (let i = 0; i < 26; i++) tone(ctx, out, 0.05 + r() * 1.2, 2500 + r() * 5000, 0.4, 'sine', 0.03 + r() * 0.04, { d: 0.3, s: 0 }); return; }
    burst(ctx, out, 0.05, 1.2, 'bandpass', 1500, 0.6, 0.8); tom(ctx, out, 0.05, 70, 1, 0.8);
    const parts = p.debris ? 60 : 25; for (let i = 0; i < parts; i++) { const t = 0.15 + r() * (d - 0.8); burst(ctx, out, t, 0.08, 'bandpass', 600 + r() * 3000, 1.5, 0.25 * (1 - t / d), 0.002, r() * 1.6 - 0.8); }
  },
  fire(ctx, out, d, _p, r) { bed(ctx, out, d, 'lowpass', 600, 0.7, 0.12, 0.3, 0.3); for (let i = 0; i < d * 18; i++) burst(ctx, out, r() * d, 0.015 + r() * 0.03, 'highpass', 1500 + r() * 3000, 0.7, 0.12 + r() * 0.25, 0.001, r() * 1.4 - 0.7); },
  wind(ctx, out, d, p) { const v = p.soft ? 0.25 : 0.5; bed(ctx, out, d, 'bandpass', p.ghost ? 900 : 500, p.ghost ? 6 : 1.2, v, 0.6, 0.13); bed(ctx, out, d, 'lowpass', 300, 0.7, v * 0.5, 0.4, 0.07); if (p.ghost) bed(ctx, out, d, 'bandpass', 1400, 9, 0.15, 0.3, 0.31); },
  rain(ctx, out, d, _p, r) { bed(ctx, out, d, 'highpass', 1200, 0.5, 0.18); bed(ctx, out, d, 'lowpass', 800, 0.7, 0.12); for (let i = 0; i < d * 60; i++) burst(ctx, out, r() * d, 0.008, 'bandpass', 2500 + r() * 4000, 2, 0.04 + r() * 0.08, 0.001, r() * 2 - 1); },
  thunder(ctx, out, d, _p, r) { burst(ctx, out, 0.1, 0.25, 'highpass', 800, 0.7, 0.6); const n = noise(ctx, 0.15, d); const lp = filt(ctx, 'lowpass', 300); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, 0.15); g.gain.linearRampToValueAtTime(0.9, 0.4); for (let t = 0.6; t < d - 0.5; t += 0.3 + r() * 0.5) g.gain.linearRampToValueAtTime(0.3 + r() * 0.6, t); g.gain.linearRampToValueAtTime(0, d); n.connect(lp); lp.connect(g); g.connect(out); boom(ctx, out, 0.2, 0.7, d / 2); },
  birds(ctx, out, d, p, r) {
    if (!p.one) bed(ctx, out, d, 'lowpass', 1500, 0.6, 0.04);
    const calls = p.one ? 3 : Math.floor(d * 2.2);
    for (let i = 0; i < calls; i++) {
      const t = p.one ? 0.2 + i * 0.35 : r() * (d - 0.6); const f = 2500 + r() * 2500; const notes = 2 + Math.floor(r() * 4); const pan = r() * 1.6 - 0.8;
      for (let k = 0; k < notes; k++) { const tt = t + k * 0.09; const o = ctx.createOscillator(); o.frequency.setValueAtTime(f * (1 + r() * 0.2), tt); o.frequency.exponentialRampToValueAtTime(f * (0.7 + r() * 0.6), tt + 0.06); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.12, tt + 0.01); g.gain.linearRampToValueAtTime(0, tt + 0.07); const pn = panN(ctx, pan); o.connect(g); g.connect(pn); pn.connect(out); o.start(tt); o.stop(tt + 0.08); }
    }
  },
  crickets(ctx, out, d, _p, r) { for (const [f, pan] of [[4300, -0.6], [4700, 0.5], [5100, 0.1]]) { const o = ctx.createOscillator(); o.frequency.value = f; const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 28 + r() * 6; const amg = gainN(ctx, 0.5); const g = gainN(ctx, 0.5); am.connect(amg); amg.connect(g.gain); const gate = gainN(ctx, 0); for (let t = r(); t < d; t += 0.6 + r() * 0.5) { gate.gain.setValueAtTime(0, t); gate.gain.linearRampToValueAtTime(0.05, t + 0.02); gate.gain.setValueAtTime(0.05, t + 0.25); gate.gain.linearRampToValueAtTime(0, t + 0.28); } const pn = panN(ctx, pan); o.connect(g); g.connect(gate); gate.connect(pn); pn.connect(out); o.start(0); am.start(0); o.stop(d); am.stop(d); } bed(ctx, out, d, 'lowpass', 400, 0.7, 0.04); },
  stream(ctx, out, d, _p, r) { bed(ctx, out, d, 'bandpass', 1800, 0.6, 0.25, 0.3, 0.6); bed(ctx, out, d, 'lowpass', 500, 0.7, 0.12); for (let i = 0; i < d * 25; i++) { const t = r() * d; const f = 600 + r() * 1800; const o = ctx.createOscillator(); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.8, t + 0.04); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.005); g.gain.linearRampToValueAtTime(0, t + 0.05); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.06); } },
  frog(ctx, out, d, _p, r) { G.crickets(ctx, out, d, {}, r); for (let t = 0.3; t < d - 0.5; t += 0.8 + r() * 1.2) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 180 + r() * 60; const am = ctx.createOscillator(); am.frequency.value = 30; const amg = gainN(ctx, 0.5); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.03); g.gain.linearRampToValueAtTime(0, t + 0.3); am.connect(amg); amg.connect(g.gain); const lp = filt(ctx, 'lowpass', 900); o.connect(lp); lp.connect(g); g.connect(out); o.start(t); am.start(t); o.stop(t + 0.35); am.stop(t + 0.35); } },
  traffic(ctx, out, d, p, r) {
    const far = !!p.far; bed(ctx, out, d, 'lowpass', far ? 250 : 500, 0.7, far ? 0.2 : 0.3, 0.3, 0.05);
    if (!far) for (let t = r() * 2; t < d - 2; t += 2 + r() * 3) { const n = noise(ctx, t, 3); const lp = filt(ctx, 'lowpass', 900); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 1.2); g.gain.linearRampToValueAtTime(0, t + 2.6); const pn = panN(ctx, -0.9); pn.pan.linearRampToValueAtTime(0.9, t + 2.6); n.connect(lp); lp.connect(g); g.connect(pn); pn.connect(out); }
    if (!far) for (let i = 0; i < 2; i++) G.horn(ctx, out, d, { at: 1 + r() * (d - 3), v: 0.25 }, r);
  },
  horn(ctx, out, _d, p) { const at = p.at ?? 0.1; const v = p.v ?? 0.6; const hit = (t: number, len: number) => { for (const f of [392, 494]) voice(ctx, out, t, f, len, { type: 'sawtooth', gain: v * 0.12, a: 0.01, s: 1, r: 0.05, lp: 2200 }); }; hit(at, 0.45); if (p.two) { hit(at + 0.6, 0.25); hit(at + 1, 0.6); } },
  siren(ctx, out, d) { const o = ctx.createOscillator(); o.type = 'sawtooth'; const l = ctx.createOscillator(); l.frequency.value = 0.6; const lg = gainN(ctx, 250); l.connect(lg); lg.connect(o.frequency); o.frequency.value = 900; const lp = filt(ctx, 'lowpass', 2500); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.18, d * 0.45); g.gain.linearRampToValueAtTime(0, d); const pn = panN(ctx, -0.8); pn.pan.linearRampToValueAtTime(0.8, d); o.connect(lp); lp.connect(g); g.connect(pn); pn.connect(out); o.start(0); l.start(0); o.stop(d); l.stop(d); },
  steps(ctx, out, d, p, r) {
    const gap = p.run ? 0.28 : 0.55;
    for (let t = 0.2, i = 0; t < d - 0.3; t += gap * (0.92 + r() * 0.16), i++) {
      const pan = i % 2 ? 0.15 : -0.15;
      if (p.heels) { burst(ctx, out, t, 0.04, 'bandpass', 2500, 2, 0.5, 0.001, pan); tone(ctx, out, t, 1800, 0.06, 'triangle', 0.08); }
      else if (p.gravel) { for (let k = 0; k < 8; k++) burst(ctx, out, t + r() * 0.08, 0.03, 'bandpass', 1500 + r() * 3000, 1.5, 0.2, 0.001, pan); }
      else { tom(ctx, out, t, p.wood ? 110 : 80, 0.4, 0.12); burst(ctx, out, t, 0.06, 'bandpass', 900, 1, 0.25, 0.001, pan); }
    }
  },
  cloth(ctx, out, d, _p, r) { for (let t = 0.1; t < d - 0.3; t += 0.3 + r() * 0.5) burst(ctx, out, t, 0.25, 'bandpass', 2500, 0.7, 0.25, 0.08, r() - 0.5); },
  click(ctx, out) { burst(ctx, out, 0.02, 0.01, 'bandpass', 4000, 1, 0.5); tone(ctx, out, 0.02, 2000, 0.03, 'sine', 0.15); },
  pop(ctx, out) { const o = ctx.createOscillator(); o.frequency.setValueAtTime(300, 0.02); o.frequency.exponentialRampToValueAtTime(900, 0.08); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, 0.02); g.gain.linearRampToValueAtTime(0.4, 0.025); g.gain.exponentialRampToValueAtTime(0.001, 0.15); o.connect(g); g.connect(out); o.start(0.02); o.stop(0.2); },
  notify(ctx, out) { [[76, 0], [83, 0.12]].forEach(([m, t]) => voice(ctx, out, 0.02 + t, hz(m), 0.6, { type: 'sine', gain: 0.25, a: 0.003, d: 0.5, s: 0, r: 0.4 })); },
  error(ctx, out) { [0, 0.22].forEach((t) => voice(ctx, out, 0.02 + t, 220, 0.16, { type: 'square', gain: 0.09, a: 0.003, s: 1, r: 0.03, lp: 1500 })); },
  success(ctx, out) { [72, 76, 79, 84].forEach((m, i) => voice(ctx, out, 0.02 + i * 0.09, hz(m), 0.8, { type: 'sine', gain: 0.18, a: 0.003, d: 0.6, s: 0, r: 0.5 })); },
  typing(ctx, out, d, _p, r) { for (let t = 0.1; t < d - 0.2; t += 0.07 + r() * 0.15) { burst(ctx, out, t, 0.015, 'bandpass', 3000 + r() * 2000, 2, 0.3, 0.001, r() * 0.6 - 0.3); if (r() < 0.08) { burst(ctx, out, t + 0.05, 0.03, 'bandpass', 1500, 1, 0.35); t += 0.25; } } },
  laser(ctx, out, _d, p) { const o = ctx.createOscillator(); o.type = p.zap ? 'square' : 'sawtooth'; o.frequency.setValueAtTime(p.zap ? 3000 : 1800, 0.02); o.frequency.exponentialRampToValueAtTime(p.zap ? 200 : 120, 0.3); const g = gainN(ctx, 0); g.gain.setValueAtTime(0.25, 0.02); g.gain.exponentialRampToValueAtTime(0.001, 0.4); const lp = filt(ctx, 'lowpass', 4000); o.connect(lp); lp.connect(g); g.connect(out); o.start(0.02); o.stop(0.5); },
  warp(ctx, out, d) { for (const k of [1, 1.5]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(80 * k, 0); o.frequency.exponentialRampToValueAtTime(2400 * k, d * 0.7); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.1, d * 0.6); g.gain.linearRampToValueAtTime(0, d * 0.75); const lp = filt(ctx, 'lowpass', 3000); o.connect(lp); lp.connect(g); g.connect(out); o.start(0); o.stop(d); } boom(ctx, out, d * 0.72, 0.6, 1.5); },
  scan(ctx, out, d, p) { const o = ctx.createOscillator(); o.type = p.robot ? 'square' : 'sine'; o.frequency.value = p.robot ? 140 : 1200; const l = ctx.createOscillator(); l.frequency.value = p.robot ? 9 : 3; const lg = gainN(ctx, p.robot ? 60 : 500); l.connect(lg); lg.connect(o.frequency); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.12, 0.1); g.gain.setValueAtTime(0.12, d - 0.3); g.gain.linearRampToValueAtTime(0, d); const lp = filt(ctx, 'lowpass', 2500); o.connect(lp); lp.connect(g); g.connect(out); o.start(0); l.start(0); o.stop(d); l.stop(d); if (p.robot) G.steps(ctx, out, d, { run: 1, heels: 1 }, rnd(3)); },
  powerup(ctx, out) { [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => voice(ctx, out, 0.02 + i * 0.07, hz(m), 0.25, { type: 'square', gain: 0.07, a: 0.003, d: 0.2, s: 0.2, r: 0.1, lp: 3000 })); riser(ctx, out, 0, 0.6, 0.5); },
  heartbeat(ctx, out, d) { for (let t = 0.2; t < d - 0.5; t += 0.85) { kick(ctx, out, t, 0.8, 0.55); kick(ctx, out, t + 0.22, 0.55, 0.5); } },
  creak(ctx, out, d) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, 0.1); o.frequency.linearRampToValueAtTime(140, d * 0.5); o.frequency.linearRampToValueAtTime(90, d - 0.3); const bp = filt(ctx, 'bandpass', 900, 8); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, 0.1); g.gain.linearRampToValueAtTime(0.5, 0.4); g.gain.setValueAtTime(0.5, d - 0.6); g.gain.linearRampToValueAtTime(0, d - 0.2); const am = ctx.createOscillator(); am.frequency.value = 22; const amg = gainN(ctx, 0.4); am.connect(amg); amg.connect(g.gain); o.connect(bp); bp.connect(g); g.connect(out); o.start(0.1); am.start(0.1); o.stop(d); am.stop(d); },
  drone(ctx, out, d) { for (const [m, pan] of [[33, -0.4], [34, 0.4], [40, 0], [46, 0.2]]) voice(ctx, out, 0, hz(m), d, { type: 'sawtooth', detune: [-7, 7], gain: 0.05, a: 2, d: 2, s: 1, r: 2, lp: 500, q: 3, vib: 10, vibRate: 0.15, pan }); },
  stab(ctx, out) { for (const m of [60, 61, 66, 67, 72]) voice(ctx, out, 0.03, hz(m), 0.6, { type: 'sawtooth', detune: [-15, 15], gain: 0.05, a: 0.005, d: 0.4, s: 0.3, r: 1.2, lp: 4000 }); boom(ctx, out, 0.03, 0.8, 2); burst(ctx, out, 0.03, 0.4, 'highpass', 3000, 0.7, 0.4); },
  crowd(ctx, out, d) { for (let k = 0; k < 4; k++) bed(ctx, out, d, 'bandpass', 400 + k * 250, 4, 0.12, 0.25, 0.4 + k * 0.17); bed(ctx, out, d, 'lowpass', 300, 0.7, 0.1); },
  applause(ctx, out, d, p, r) {
    const n = p.big ? 600 : p.short ? 120 : 280; const end = d - (p.short ? 0.6 : 1.5);
    for (let i = 0; i < n; i++) { const t = r() * end; burst(ctx, out, t, 0.02, 'bandpass', 900 + r() * 1800, 1.2, 0.08 + r() * 0.1, 0.001, r() * 1.8 - 0.9); }
    bed(ctx, out, d, 'bandpass', 1500, 0.5, p.big ? 0.12 : 0.06);
    if (p.big) G.cheer(ctx, out, d, { quiet: 1 }, r);
  },
  cheer(ctx, out, d, p) { const v = p.quiet ? 0.5 : 1; for (let k = 0; k < 5; k++) { const g = bed(ctx, out, d, 'bandpass', 600 + k * 300, 5, 0.1 * v, 0.3, 0.6 + k * 0.2); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.12 * v, 0.6); g.gain.setValueAtTime(0.12 * v, d - 1.5); g.gain.linearRampToValueAtTime(0, d); } if (!p.quiet) G.applause(ctx, out, d, { short: 0 }, rnd(5)); },
  whistle(ctx, out, _d, p) { const len = p.long ? 1.8 : 0.5; const blast = (t: number, l: number) => { voice(ctx, out, t, 2900, l, { type: 'sine', gain: 0.18, a: 0.01, s: 1, r: 0.05, vib: 60, vibRate: 32 }); burst(ctx, out, t, l, 'bandpass', 2900, 4, 0.08, 0.01); }; blast(0.05, len); if (!p.long) blast(0.65, 0.35); },
  bounce(ctx, out, d) { let t = 0.1, gap = 0.55, v = 1; while (t < d - 0.2 && v > 0.05) { tom(ctx, out, t, 160, v * 0.7, 0.15); burst(ctx, out, t, 0.05, 'bandpass', 1200, 1, 0.3 * v); t += gap; gap *= 0.75; v *= 0.8; } },
  buzzer(ctx, out, d) { voice(ctx, out, 0.05, 110, d - 0.3, { type: 'square', detune: [0, 12], gain: 0.12, a: 0.01, s: 1, r: 0.05, lp: 2500 }); },
  kick(ctx, out) { tom(ctx, out, 0.03, 90, 0.9, 0.2); burst(ctx, out, 0.03, 0.08, 'bandpass', 900, 1, 0.5); },
  newsStinger(ctx, out, d, p) {
    if (p.ticks) { for (let i = 0; i < 4; i++) { burst(ctx, out, 0.1 + i, 0.03, 'highpass', 3000, 0.7, 0.4); tone(ctx, out, 0.1 + i, 1500, 0.05, 'sine', 0.15); } boom(ctx, out, 4.1, 0.8, 1); return; }
    const t = 0.05; for (const m of [55, 62, 67, 70]) voice(ctx, out, t, hz(m), p.short ? 0.8 : 1.4, { type: 'sawtooth', detune: [-8, 8], gain: 0.05, a: 0.01, d: 0.5, s: 0.5, r: 0.8, lp: 3000 });
    tom(ctx, out, t, 70, 1, 1); boom(ctx, out, t, 0.6, 2); if (!p.short) riser(ctx, out, t + 1.6, d - 0.4, 0.4, true);
  },
  newsSweep(ctx, out, d) { G.whoosh(ctx, out, d, { len: 1 }, rnd(2)); for (const m of [67, 74, 79]) voice(ctx, out, 1.1, hz(m), 0.6, { type: 'sine', gain: 0.12, a: 0.003, d: 0.6, s: 0, r: 0.5 }); },
  timpani(ctx, out, d) { for (let i = 0; i < 26; i++) tom(ctx, out, 0.05 + i * 0.07, 70, 0.15 + i * 0.025, 0.3); tom(ctx, out, 1.95, 65, 1, 1.5); boom(ctx, out, 1.95, 0.6, d - 2); },
  shutter(ctx, out, d, p) {
    const shot = (t: number) => { burst(ctx, out, t, 0.02, 'bandpass', 3500, 2, 0.6); burst(ctx, out, t + 0.06, 0.03, 'bandpass', 2200, 2, 0.45); };
    if (p.projector) { for (let t = 0.1; t < d - 0.2; t += 1 / 24) burst(ctx, out, t, 0.012, 'bandpass', 2600, 2, 0.12); bed(ctx, out, d, 'lowpass', 200, 0.7, 0.1); return; }
    if (p.burst) for (let i = 0; i < 6; i++) shot(0.05 + i * 0.2); else shot(0.05);
  },
  flash(ctx, out, d) { const o = ctx.createOscillator(); o.frequency.setValueAtTime(600, 0); o.frequency.exponentialRampToValueAtTime(9000, d - 0.4); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.06, 0.2); g.gain.linearRampToValueAtTime(0, d - 0.35); o.connect(g); g.connect(out); o.start(0); o.stop(d); burst(ctx, out, d - 0.35, 0.05, 'bandpass', 3000, 2, 0.6); },
  tally(ctx, out) { voice(ctx, out, 0.05, 1000, 0.5, { type: 'sine', gain: 0.2, a: 0.003, s: 1, r: 0.02 }); },
  glitch(ctx, out, d, p, r) { for (let t = 0.02; t < d - 0.1; t += p.stutter ? 0.09 : 0.03 + r() * 0.12) { if (p.stutter && r() < 0.2) continue; const kind = r(); if (kind < 0.4) voice(ctx, out, t, 200 + r() * 3000, 0.04, { type: 'square', gain: 0.08, a: 0.001, s: 1, r: 0.005 }); else burst(ctx, out, t, 0.03, kind < 0.7 ? 'highpass' : 'bandpass', 500 + r() * 6000, 1, 0.3, 0.001, r() * 2 - 1); } },
  bitcrush(ctx, out, d, _p, r) { for (let t = 0.02; t < d - 0.1; t += 0.05) voice(ctx, out, t, [110, 220, 55, 330][Math.floor(r() * 4)], 0.045, { type: 'square', gain: 0.12, a: 0.001, s: 1, r: 0.004 }); bed(ctx, out, d, 'highpass', 4000, 0.7, 0.05); },
  static(ctx, out, d) { bed(ctx, out, d, 'highpass', 300, 0.5, 0.18); bed(ctx, out, d, 'bandpass', 3000, 2, 0.08, 0.5, 6); },
  knock(ctx, out) { for (const t of [0.1, 0.35, 0.6]) { tom(ctx, out, t, 180, 0.7, 0.08); burst(ctx, out, t, 0.04, 'bandpass', 800, 1.2, 0.4); } },
  door(ctx, out) { G.creak(ctx, out, 1.2, {}, rnd(1)); tom(ctx, out, 1.3, 75, 1, 0.4); burst(ctx, out, 1.3, 0.15, 'lowpass', 1500, 0.7, 0.6); },
  paper(ctx, out, d, _p, r) { for (let t = 0.05; t < d - 0.2; t += 0.04 + r() * 0.12) burst(ctx, out, t, 0.06 + r() * 0.1, 'highpass', 2500 + r() * 3000, 0.7, 0.15 + r() * 0.2, 0.005, r() - 0.5); },
  drip(ctx, out, d, _p, r) { for (let t = 0.2; t < d - 0.3; t += 0.7 + r() * 0.6) { const o = ctx.createOscillator(); const f = 900 + r() * 500; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.05); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.15); } },
  glass(ctx, out) { for (const [t, f] of [[0.1, 2637], [0.45, 2349]]) { for (const k of [1, 2.76, 5.4]) tone(ctx, out, t, f * k / 2.76 * 1.5, 1.2, 'sine', 0.08 / k, { d: 1, s: 0 }); } },
  keys(ctx, out, d, _p, r) { for (let t = 0.05; t < d - 0.3; t += 0.05 + r() * 0.12) tone(ctx, out, t, 3000 + r() * 4000, 0.2, 'sine', 0.05 + r() * 0.05, { d: 0.15, s: 0, pan: r() - 0.5 }); bed(ctx, out, 0.8, 'highpass', 5000, 0.7, 0.04); },
  pour(ctx, out, d, _p, r) { bed(ctx, out, d - 0.3, 'bandpass', 700, 1.2, 0.3, 0.5, 2); for (let i = 0; i < d * 18; i++) G.drip(ctx, out, 0.5, {}, r); },
};
// cymbal-ish hats and claps are used by some generators through the drum helpers
void hat; void clap; void snare; void pluck;

export async function renderSfx(track: Track, sampleRate = 44100): Promise<AudioBuffer> {
  const it = track.sfx!; const d = it.dur;
  const ctx = new OfflineAudioContext(2, Math.ceil(d * sampleRate), sampleRate) as Ctx;
  const out = masterChain(ctx, d, 0.18, Math.min(0.6, d * 0.2), 0.005);
  (G[it.gen] ?? G.click)(ctx, out, d, it.p ?? {}, rnd(track.seed));
  return ctx.startRendering();
}
