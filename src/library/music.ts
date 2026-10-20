// Composes and renders an original piece for a music track from its category recipe:
// chords from the scale, a melody, bass, arpeggios, pads and the category's drum groove,
// arranged in sections (intro → build → main → outro).
import type { Layer, ScaleName, Track } from './catalog';
import {
  type Ctx, rnd, hz, voice, pluck, kick, snare, hat, clap, tom, boom, riser, noise, filt, gainN, panN, masterChain,
} from './synth';

const SCALES: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  hijaz: [0, 1, 4, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], harmonicMinor: [0, 2, 3, 5, 7, 8, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
/** layer → section level it enters at (0 = from the start) */
const ENTER: Record<Layer, number> = {
  pad: 0, drone: 0, strings: 1, piano: 0, pluck: 1, arp: 2, bass: 2, sub: 2, lead: 3, bells: 1, brass: 3, choir: 2, guitar: 1, oud: 1, ney: 2,
  synth: 2, risers: 1, booms: 1, vinyl: 0, clock: 1, organ: 1, santur: 0,
};

/** `limit`: render only the first seconds (a quick start for previews) */
export async function renderMusic(track: Track, sampleRate = 44100, limit = Infinity): Promise<AudioBuffer> {
  const m = track.music!; const rc = m.recipe; const r = rnd(track.seed);
  const dur = track.duration; const bpm = track.bpm ?? 100;
  const ctx = new OfflineAudioContext(2, Math.ceil(Math.min(dur, limit) * sampleRate), sampleRate) as Ctx;
  const short = dur < 16;
  const bus = masterChain(ctx, dur, rc.reverb, short ? Math.min(1.2, dur * 0.35) : 3);
  const beat = 60 / bpm, bar = beat * 4, s16 = beat / 4;
  const scale = SCALES[m.scale]; const root = m.root;
  const deg = (d: number, oct = 0) => { const n = scale.length; const o = Math.floor(d / n); const i = ((d % n) + n) % n; return root + scale[i] + 12 * (o + oct); };
  const chordOf = (d: number, oct = 0) => [deg(d, oct), deg(d + 2, oct), deg(d + 4, oct)];
  const has = (l: Layer) => rc.layers.includes(l);
  const L: Partial<Record<Layer, GainNode>> = {};
  const lane = (l: Layer, level: number, pan = 0) => { if (!L[l]) { const g = gainN(ctx, level); const p = panN(ctx, pan); g.connect(p); p.connect(bus); L[l] = g; } return L[l]!; };
  const drums = gainN(ctx, 0.8);
  if (rc.drums === 'lofi') { const lp = filt(ctx, 'lowpass', 3200); drums.connect(lp); lp.connect(bus); } else drums.connect(bus);
  const bright = rc.bright;

  // ---------- short pieces: intro, logo, transitions ----------
  if (short) {
    const hit = Math.min(dur * 0.55, Math.max(0.4, dur - 2.2));
    if (has('risers')) riser(ctx, lane('risers', 0.9), 0, hit, 1, dur > 3);
    if (has('booms')) boom(ctx, lane('booms', 1), hit, 1, Math.min(3, dur - hit + 0.5));
    const ch = chordOf(m.prog[0], 1);
    for (const n of ch) {
      if (has('bells')) voice(ctx, lane('bells', 0.6, 0.2), hit, hz(n + 12), dur - hit, { type: 'sine', gain: 0.12, a: 0.005, d: 1.2, s: 0.2, r: 1 });
      if (has('pad') || has('brass')) voice(ctx, lane('pad', 0.6), hit, hz(n), dur - hit, { type: 'sawtooth', detune: [-9, 9], gain: 0.06, a: 0.08, d: 1, s: 0.6, r: 0.8, lp: 2600 * bright + 600 });
      if (has('synth')) voice(ctx, lane('synth', 0.5), hit, hz(n), dur - hit, { type: 'sawtooth', detune: [-14, 0, 14], gain: 0.05, a: 0.01, d: 0.4, s: 0.4, r: 0.5, lp: 3500, lpEnd: 900, lpTime: 1 });
    }
    if (has('arp')) { const notes = [...ch, ch[0] + 12]; for (let i = 0; i * s16 < hit; i++) voice(ctx, lane('arp', 0.4, 0.3), i * s16, hz(notes[i % 4] + 12), s16 * 0.9, { type: 'square', gain: 0.05, a: 0.003, d: 0.08, s: 0, r: 0.05, lp: 2500 }); }
    if (rc.drums !== 'none' && dur > 6) { for (let b = 0; b * beat < hit; b++) kick(ctx, drums, b * beat, 0.7); }
    if (dur > 6 && has('bass')) voice(ctx, lane('bass', 0.6), hit, hz(ch[0] - 24), dur - hit, { type: 'sawtooth', gain: 0.18, a: 0.005, d: 0.3, s: 0.6, r: 0.4, lp: 400 });
    return ctx.startRendering();
  }

  // ---------- arrangement ----------
  const bars = Math.max(4, Math.floor(dur / bar));
  const introBars = Math.min(4, Math.max(2, Math.round(bars * 0.15)));
  const levelOf = (b: number) => (b < introBars ? (b < introBars / 2 ? 0 : 1) : b >= bars - 2 ? 1 : b < bars * 0.5 ? 2 : 3);
  const chordBars = bpm < 75 ? 2 : 1;
  const chordAt = (b: number) => m.prog[Math.floor(b / chordBars) % m.prog.length];
  // a two-bar melody motif, varied every repeat
  const motifRhythm: number[] = []; let pos = 0;
  while (pos < 32) { const len = [2, 2, 4, 1, 3, 6][Math.floor(r() * 6)]; motifRhythm.push(pos); pos += len; }
  const motifSteps = motifRhythm.map(() => Math.floor(r() * 5) - 2);

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar; if (t0 >= dur || t0 >= limit) break;
    const lv = levelOf(b); const on = (l: Layer) => has(l) && lv >= ENTER[l];
    const cd = chordAt(b); const ch = chordOf(cd); const newChord = b % chordBars === 0;
    const cl = chordBars * bar;
    // pads, drones, strings, organ, choir
    if (newChord && on('pad')) for (const n of ch) voice(ctx, lane('pad', 0.55, 0), t0, hz(n), cl, { type: 'sawtooth', detune: [-11, 0, 11], gain: 0.045, a: Math.min(1.5, cl * 0.4), d: 1, s: 0.85, r: 1.2, lp: 700 + 1400 * bright });
    if (b === 0 && on('drone')) for (const n of [root - 12, root - 5]) voice(ctx, lane('drone', 0.5), 0, hz(n), dur, { type: 'sawtooth', detune: [-6, 6], gain: 0.05, a: 3, d: 2, s: 1, r: 2, lp: 380, q: 2, vib: 4, vibRate: 0.2 });
    if (newChord && on('strings')) for (const [i, n] of ch.entries()) voice(ctx, lane('strings', 0.6, [-0.35, 0, 0.35][i]), t0, hz(n + 12), cl, { type: 'sawtooth', detune: [-8, 0, 8], gain: 0.035, a: 0.45, d: 1, s: 0.9, r: 0.9, lp: 1800 + 1200 * bright });
    if (newChord && on('organ')) for (const n of ch) voice(ctx, lane('organ', 0.4), t0, hz(n + 12), cl, { type: 'sine', detune: [0, 1200, 1902], gain: 0.04, a: 0.02, s: 1, r: 0.2 });
    if (newChord && on('choir')) for (const n of ch) {
      const g = gainN(ctx, 1); const f1 = filt(ctx, 'bandpass', 720, 5), f2 = filt(ctx, 'bandpass', 1180, 7); g.connect(f1); g.connect(f2); const mix = lane('choir', 0.9, 0); f1.connect(mix); f2.connect(mix);
      voice(ctx, g, t0, hz(n + 12), cl, { type: 'sawtooth', detune: [-14, 0, 14], gain: 0.09, a: 0.8, d: 1, s: 0.9, r: 1.2 });
    }
    // piano: broken chords
    if (on('piano')) {
      const pat = rc.drums === 'lofi' ? [0, 6, 10] : bpm < 80 ? [0, 4, 8, 12] : [0, 3, 6, 8, 11, 14];
      pat.forEach((st, i) => {
        const n = i === 0 ? ch[0] - 12 : ch[i % 3] + (i > 2 ? 12 : 0); const t = t0 + st * s16;
        const g = lane('piano', 0.7, 0.1);
        voice(ctx, g, t, hz(n), 1.6, { type: 'triangle', gain: 0.13, a: 0.004, d: 0.9, s: 0.15, r: 0.6, lp: 3200 * bright + 900 });
        voice(ctx, g, t, hz(n) * 2, 0.6, { type: 'sine', gain: 0.03, a: 0.003, d: 0.3, s: 0, r: 0.3 });
      });
    }
    // plucks / guitar / oud / santur
    if (on('pluck')) for (let st = 0; st < 16; st += 2) { if (r() < 0.25) continue; pluck(ctx, lane('pluck', 0.6, -0.25), t0 + st * s16, hz(ch[(st / 2) % 3] + 12), 0.9, 0.22, 0.4); }
    if (on('guitar')) { const strums = rc.drums === 'rock' ? [0, 6, 8, 14] : [0, 4, 6, 10, 12]; for (const st of strums) ch.concat(ch[0] + 12).forEach((n, k) => pluck(ctx, lane('guitar', 0.7, 0.3), t0 + st * s16 + k * 0.012, hz(n), 1.4, 0.16, rc.drums === 'rock' ? 0.85 : 0.55)); }
    if (on('santur')) for (let st = 0; st < 16; st += 1) { if (r() < 0.45) continue; const n = deg(cd + Math.floor(r() * 5), 1); pluck(ctx, lane('santur', 0.55, 0.35), t0 + st * s16, hz(n), 1.6, 0.13, 0.9, 0.997); if (r() < 0.4) pluck(ctx, lane('santur', 0.55, 0.35), t0 + st * s16 + 0.06, hz(n), 1, 0.08, 0.9); }
    // arpeggio
    if (on('arp')) { const notes = [ch[0], ch[1], ch[2], ch[0] + 12]; for (let st = 0; st < 16; st++) voice(ctx, lane('arp', 0.45, 0.25), t0 + st * s16, hz(notes[(st + b) % 4] + 12), s16 * 0.9, { type: 'sawtooth', gain: 0.05, a: 0.003, d: 0.12, s: 0, r: 0.08, lp: 2800 * bright + 700, lpEnd: 600, lpTime: 0.15 }); }
    if (on('synth')) for (const st of [0, 3, 6, 10, 12]) for (const n of ch) voice(ctx, lane('synth', 0.4, -0.2), t0 + st * s16, hz(n + 12), s16 * 1.6, { type: 'sawtooth', detune: [-12, 12], gain: 0.03, a: 0.004, d: 0.15, s: 0.3, r: 0.1, lp: 3000, lpEnd: 900, lpTime: 0.2 });
    // brass stabs
    if (on('brass')) for (const st of [0, 10]) for (const n of ch) voice(ctx, lane('brass', 0.5, 0), t0 + st * s16, hz(n), beat * 1.5, { type: 'sawtooth', detune: [-6, 6], gain: 0.05, a: 0.03, d: 0.3, s: 0.6, r: 0.3, lp: 600, lpEnd: 2400, lpTime: 0.15 });
    // bells (sparkle)
    if (on('bells')) for (let st = 0; st < 16; st += 4) { if (r() < 0.5) continue; voice(ctx, lane('bells', 0.45, 0.4), t0 + st * s16, hz(ch[Math.floor(r() * 3)] + 24), 1.5, { type: 'sine', gain: 0.07, a: 0.003, d: 1.2, s: 0, r: 1 }); }
    // bass
    if (on('bass')) {
      const pat = rc.drums === 'four' || rc.drums === 'dnb' ? [2, 6, 10, 14] : rc.drums === 'rock' ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 7, 10];
      for (const st of pat) voice(ctx, lane('bass', 0.7, 0), t0 + st * s16, hz(ch[0] - 24 + (st === 10 && r() < 0.3 ? 7 : 0)), s16 * 1.8, { type: 'sawtooth', gain: 0.16, a: 0.005, d: 0.2, s: 0.6, r: 0.08, lp: 420 + 300 * bright });
    }
    if (on('sub')) for (const st of rc.drums === 'trap' ? [0, 10] : [0]) voice(ctx, lane('sub', 0.8, 0), t0 + st * s16, hz(ch[0] - 24), beat * 1.8, { type: 'sine', gain: 0.32, a: 0.005, d: 0.8, s: 0.4, r: 0.3, glideFrom: rc.drums === 'trap' ? hz(ch[0] - 12) : undefined, glideTime: 0.06 });
    // melody: lead, oud, ney
    const melodyLayer: Layer | null = on('oud') ? 'oud' : on('lead') ? 'lead' : on('ney') && b % 2 === 1 ? 'ney' : null;
    if (melodyLayer && lv >= 2) {
      let d = cd + 7; const half = (b % 2) * 16;
      motifRhythm.forEach((st, i) => {
        if (st < half || st >= half + 16) return;
        d += motifSteps[i] + (b % 4 === 3 && i === motifRhythm.length - 1 ? -1 : 0);
        const t = t0 + (st - half) * s16; const len = ((motifRhythm[i + 1] ?? 32) - st) * s16;
        const n = deg(d, 0) + 12;
        if (melodyLayer === 'oud') { pluck(ctx, lane('oud', 0.8, -0.15), t, hz(n), Math.max(0.6, len * 1.4), 0.26, 0.7, 0.995); if (len > beat) pluck(ctx, lane('oud', 0.8, -0.15), t + len / 2, hz(n), 0.6, 0.12, 0.7); }
        else if (melodyLayer === 'lead') voice(ctx, lane('lead', 0.5, -0.1), t, hz(n), len * 0.95, { type: 'square', detune: [-5, 5], gain: 0.05, a: 0.01, d: 0.2, s: 0.7, r: 0.12, lp: 2600, vib: 14, vibRate: 5.5 });
        else {
          voice(ctx, lane('ney', 0.6, 0.15), t, hz(n), len * 0.95, { type: 'sine', gain: 0.12, a: 0.08, d: 0.3, s: 0.8, r: 0.2, vib: 18, vibRate: 5 });
          const br = noise(ctx, t, len); const bp = filt(ctx, 'bandpass', hz(n) * 2, 6); const g = gainN(ctx, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.1); g.gain.setTargetAtTime(0, t + len * 0.9, 0.05); br.connect(bp); bp.connect(g); g.connect(lane('ney', 0.6, 0.15));
        }
      });
    }
    // risers into the next section, booms on section starts
    if (has('risers') && levelOf(b + 1) > lv && b + 1 < bars) riser(ctx, lane('risers', 0.7), t0 + bar * 0.25, t0 + bar, 0.8, false);
    if (has('booms') && (b === introBars || levelOf(b - 1) < lv)) boom(ctx, lane('booms', 0.9), t0, 0.9, 3);
    if (on('clock')) for (let q = 0; q < 4; q++) { const t = t0 + q * beat; const n = noise(ctx, t, 0.05); const hp = filt(ctx, 'highpass', 3500); const g = gainN(ctx, 0); g.gain.setValueAtTime(q % 2 ? 0.08 : 0.12, t); g.gain.setTargetAtTime(0, t + 0.004, 0.01); n.connect(hp); hp.connect(g); g.connect(lane('clock', 0.8, 0.3)); }
    if (b === 0 && on('vinyl')) {
      const n = noise(ctx, 0, dur); const lp = filt(ctx, 'lowpass', 5000); const g = gainN(ctx, 0.008); n.connect(lp); lp.connect(g); g.connect(lane('vinyl', 1));
      for (let i = 0; i < dur * 7; i++) { const t = r() * dur; const c = noise(ctx, t, 0.01); const hp = filt(ctx, 'highpass', 2000); const cg = gainN(ctx, 0); cg.gain.setValueAtTime(0.05 + r() * 0.08, t); cg.gain.setTargetAtTime(0, t + 0.001, 0.002); c.connect(hp); hp.connect(cg); cg.connect(lane('vinyl', 1)); }
    }

    // ---------- drums ----------
    const dl = rc.drums; if (dl === 'none') continue;
    const minLevel = dl === 'soft' || dl === 'darbuka' ? 1 : 2;
    if (lv < minLevel) { if (dl === 'cinema' && lv >= 1) tom(ctx, drums, t0, 70, 0.6, 1); continue; }
    const swing = dl === 'lofi' || dl === 'hiphop' ? s16 * 0.18 : 0;
    const at = (st: number) => t0 + st * s16 + (st % 2 ? swing : 0);
    switch (dl) {
      case 'four': for (const st of [0, 4, 8, 12]) kick(ctx, drums, at(st)); for (const st of [4, 12]) clap(ctx, drums, at(st), 0.7); for (let st = 2; st < 16; st += 4) hat(ctx, drums, at(st), 1, st % 8 === 2); for (let st = 1; st < 16; st += 2) hat(ctx, drums, at(st), 0.35); break;
      case 'rock': for (const st of [0, 7, 8, 10]) kick(ctx, drums, at(st), st === 7 ? 0.6 : 1); for (const st of [4, 12]) snare(ctx, drums, at(st)); for (let st = 0; st < 16; st += 2) hat(ctx, drums, at(st), 0.7); if (b % 4 === 0) hat(ctx, drums, at(0), 1.6, true, -0.3); break;
      case 'hiphop': case 'lofi': for (const st of [0, 7, 10]) kick(ctx, drums, at(st), 0.9, 0.9); for (const st of [4, 12]) snare(ctx, drums, at(st), 0.8, 200, 0.14); for (let st = 0; st < 16; st += 2) hat(ctx, drums, at(st), 0.6); break;
      case 'trap': kick(ctx, drums, at(0)); kick(ctx, drums, at(10), 0.8); clap(ctx, drums, at(8)); for (let st = 0; st < 16; st++) { hat(ctx, drums, at(st), st % 2 ? 0.4 : 0.7, false, 0.15); if (r() < 0.12) { hat(ctx, drums, at(st) + s16 / 3, 0.35); hat(ctx, drums, at(st) + (2 * s16) / 3, 0.35); } } break;
      case 'cinema': for (const st of [0, 3, 6, 10, 12]) tom(ctx, drums, at(st), st === 0 ? 65 : 95 + (st % 3) * 20, st === 0 ? 1 : 0.7, 0.6); if (b % 2 === 1) for (let st = 12; st < 16; st++) snare(ctx, drums, at(st), 0.35 + (st - 12) * 0.12, 200, 0.08); break;
      case 'darbuka': {
        for (const st of [0, 8]) tom(ctx, drums, at(st), 90, 0.9, 0.35);
        for (const st of [2, 6, 12]) { voice(ctx, drums, at(st), 620, 0.04, { type: 'triangle', gain: 0.25, a: 0.001, d: 0.04, s: 0, r: 0.03 }); hat(ctx, drums, at(st), 0.8, false, 0); }
        for (const st of [3, 7, 10, 14, 15]) if (r() < 0.6) hat(ctx, drums, at(st), 0.4, false, -0.2);
        // daf: low hit with jingles on the beat
        for (const st of [0, 4, 8, 12]) { tom(ctx, drums, at(st) + 0.01, 60, 0.35, 0.3); hat(ctx, drums, at(st), 0.5, true, 0.3); }
        break;
      }
      case 'broadcast': kick(ctx, drums, at(0)); kick(ctx, drums, at(8)); for (let st = 0; st < 16; st += 2) tom(ctx, drums, at(st), 140 + (st % 4) * 10, 0.35, 0.2); for (let st = 0; st < 16; st++) hat(ctx, drums, at(st), st % 4 === 0 ? 0.7 : 0.35); snare(ctx, drums, at(4), 0.7); snare(ctx, drums, at(12), 0.7); break;
      case 'soft': kick(ctx, drums, at(0), 0.7, 0.8); kick(ctx, drums, at(8), 0.6, 0.8); for (const st of [4, 12]) clap(ctx, drums, at(st), 0.35); for (let st = 0; st < 16; st++) hat(ctx, drums, at(st), st % 2 ? 0.2 : 0.35, false, 0.3); break;
      case 'dnb': kick(ctx, drums, at(0)); kick(ctx, drums, at(10)); snare(ctx, drums, at(4)); snare(ctx, drums, at(12)); for (let st = 0; st < 16; st++) hat(ctx, drums, at(st), 0.4); break;
      case 'march': for (let st = 0; st < 16; st++) if (st % 4 === 0 || r() < 0.3) snare(ctx, drums, at(st), st % 4 === 0 ? 0.8 : 0.4, 220, 0.09); kick(ctx, drums, at(0)); kick(ctx, drums, at(8)); break;
    }
  }
  return ctx.startRendering();
}
