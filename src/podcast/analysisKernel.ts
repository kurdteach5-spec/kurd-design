// Audio analysis for the multicam editor, running in a Web Worker:
// 1. loudness envelopes of every recording (100 Hz and 1 kHz),
// 2. synchronisation: FFT cross-correlation of the envelopes (coarse, 10 ms) refined at 1 ms,
// 3. who is speaking: voice activity + level difference between the two speakers' signals,
//    split into two clusters (2-means), so microphone bleed between the two signals is tolerated.
// Everything inside podKernel() must stay self-contained (it is stringified into the worker).

function podKernel() {
  type Env = { e100: Float32Array; e1k: Float32Array };
  const tracks = new Map<string, Env>();

  /** high-passed (~100 Hz) RMS envelopes: 1 kHz linear and 100 Hz in dB */
  function envelopes(x: Float32Array, sr: number): Env {
    const hop = Math.max(1, Math.round(sr / 1000));
    const a = Math.exp((-2 * Math.PI * 100) / sr);
    let py = 0, px = 0, acc = 0, cnt = 0, k = 0;
    const e1k = new Float32Array(Math.floor(x.length / hop));
    for (let i = 0; i < x.length && k < e1k.length; i++) {
      const y = a * (py + x[i] - px); px = x[i]; py = y;
      acc += y * y;
      if (++cnt === hop) { e1k[k++] = Math.sqrt(acc / hop); acc = 0; cnt = 0; }
    }
    const n100 = Math.floor(e1k.length / 10);
    const e100 = new Float32Array(n100);
    for (let i = 0; i < n100; i++) {
      let s = 0;
      for (let j = 0; j < 10; j++) { const v = e1k[i * 10 + j]; s += v * v; }
      e100[i] = 10 * Math.log10(s / 10 + 1e-10);
    }
    return { e100, e1k };
  }

  function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = ((inverse ? 2 : -2) * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < half; j++) {
          const a = i + j, b = a + half;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  function standardize(v: Float32Array, lo = -3, hi = 3): Float64Array {
    let m = 0; for (let i = 0; i < v.length; i++) m += v[i]; m /= v.length || 1;
    let s = 0; for (let i = 0; i < v.length; i++) s += (v[i] - m) ** 2; s = Math.sqrt(s / (v.length || 1)) || 1;
    const out = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = Math.max(lo, Math.min(hi, (v[i] - m) / s));
    return out;
  }

  /** offset (s) such that track(t + offset) matches ref(t), plus a confidence score */
  function sync(refId: string, id: string): { offset: number; confidence: number } {
    const R = tracks.get(refId)!, X = tracks.get(id)!;
    const r = standardize(R.e100), x = standardize(X.e100);
    let n = 1; while (n < r.length + x.length) n <<= 1;
    const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
    ar.set(r); br.set(x);
    fft(ar, ai, false); fft(br, bi, false);
    for (let i = 0; i < n; i++) { const pr = ar[i] * br[i] + ai[i] * bi[i]; const pi = ar[i] * bi[i] - ai[i] * br[i]; ar[i] = pr; ai[i] = pi; }
    fft(ar, ai, true);
    // lag d: x[t + d] ~ r[t]; overlap must be at least 20 s (or 40% of the shorter recording)
    const minOv = Math.min(2000, Math.floor(0.4 * Math.min(r.length, x.length)));
    let best = -Infinity, bestD = 0; const vals: number[] = [];
    for (let d = -(r.length - minOv); d <= x.length - minOv; d++) {
      const ov = Math.min(r.length, x.length - d) - Math.max(0, -d);
      if (ov < minOv) continue;
      const c = ar[(d + n) % n] / ov;
      vals.push(c);
      if (c > best) { best = c; bestD = d; }
    }
    let m = 0; for (const v of vals) m += v; m /= vals.length || 1;
    let s = 0; for (const v of vals) s += (v - m) ** 2; s = Math.sqrt(s / (vals.length || 1)) || 1;
    const confidence = (best - m) / s;
    // refine at 1 ms on the 1 kHz envelopes (log level), ±15 ms around the coarse lag, over up to 3 minutes
    const lr = R.e1k, lx = X.e1k;
    const log = (v: number) => Math.log(v + 1e-5);
    const D0 = bestD * 10;
    const tStart = Math.max(0, -D0 + 15), tEnd = Math.min(lr.length, lx.length - D0 - 15);
    let fine = D0;
    if (tEnd - tStart > 2000) {
      const mid = (tStart + tEnd) >> 1, half = Math.min(90000, (tEnd - tStart) >> 1);
      const a0 = mid - half, a1 = mid + half;
      let mr = 0; for (let t = a0; t < a1; t++) mr += log(lr[t]); mr /= a1 - a0;
      let mx = 0; for (let t = a0; t < a1; t++) mx += log(lx[t + D0]); mx /= a1 - a0;
      let bestF = -Infinity;
      for (let d = D0 - 15; d <= D0 + 15; d++) {
        let c = 0;
        for (let t = a0; t < a1; t++) c += (log(lr[t]) - mr) * (log(lx[t + d]) - mx);
        if (c > bestF) { bestF = c; fine = d; }
      }
    }
    return { offset: fine / 1000, confidence };
  }

  function pct(v: Float32Array | number[], p: number): number {
    const a = Array.from(v).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
    if (!a.length) return 0;
    return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
  }

  /** speech state per 10 ms frame of the timeline, from the two speakers' signals */
  function speech(aId: string, bId: string, offA: number, offB: number, t0: number, frames: number) {
    const A = tracks.get(aId)!.e100, B = tracks.get(bId)!.e100;
    const dbA = new Float32Array(frames), dbB = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const T = t0 + i / 100;
      const ia = Math.round((T + offA) * 100), ib = Math.round((T + offB) * 100);
      dbA[i] = ia >= 0 && ia < A.length ? A[ia] : -100;
      dbB[i] = ib >= 0 && ib < B.length ? B[ib] : -100;
    }
    const norm = (db: Float32Array) => {
      const valid = Array.from(db).filter((v) => v > -99);
      const nf = pct(valid, 0.1), pk = pct(valid, 0.97);
      const out = new Float32Array(db.length);
      for (let i = 0; i < db.length; i++) out[i] = Math.max(0, Math.min(1, (db[i] - nf) / Math.max(3, pk - nf)));
      return out;
    };
    const nA = norm(dbA), nB = norm(dbB);
    // voice activity with hysteresis and 250 ms hangover
    const voiced = new Uint8Array(frames);
    let on = false, hang = 0;
    for (let i = 0; i < frames; i++) {
      const lv = Math.max(nA[i], nB[i]);
      if (!on && lv > 0.42) on = true; else if (on && lv < 0.3) { if (++hang > 25) { on = false; hang = 0; } } else hang = 0;
      voiced[i] = on ? 1 : 0;
    }
    // level difference, smoothed over 150 ms
    const d = new Float32Array(frames);
    for (let i = 0; i < frames; i++) d[i] = dbA[i] - dbB[i];
    const ds = new Float32Array(frames);
    let acc = 0; const W = 15;
    for (let i = 0; i < frames; i++) { acc += d[i]; if (i >= W) acc -= d[i - W]; ds[i] = acc / Math.min(i + 1, W); }
    // 2-means on voiced frames
    const vd: number[] = []; for (let i = 0; i < frames; i++) if (voiced[i]) vd.push(ds[i]);
    let c1 = pct(vd, 0.25), c2 = pct(vd, 0.75);
    for (let it = 0; it < 25; it++) {
      let s1 = 0, n1 = 0, s2 = 0, n2 = 0; const mid = (c1 + c2) / 2;
      for (const v of vd) { if (v < mid) { s1 += v; n1++; } else { s2 += v; n2++; } }
      const a1 = n1 ? s1 / n1 : c1, a2 = n2 ? s2 / n2 : c2;
      if (Math.abs(a1 - c1) < 1e-3 && Math.abs(a2 - c2) < 1e-3) break;
      c1 = a1; c2 = a2;
    }
    const separation = c2 - c1;
    const mid = (c1 + c2) / 2, half = Math.max(0.75, separation / 2);
    const state = new Uint8Array(frames);
    for (let i = 0; i < frames; i++) {
      if (!voiced[i]) { state[i] = 0; continue; }
      const s = (ds[i] - mid) / half;
      state[i] = s > 0.35 ? 1 : s < -0.35 ? 2 : 3;
    }
    // crosstalk: both voices alternate rapidly (≥ 3 speaker changes within 1 s, each voice ≥ 15 %),
    // or the level difference sits between the two speakers for ≥ 400 ms with both voices up
    const cross = new Uint8Array(frames);
    {
      const pa = new Int32Array(frames + 1), pb = new Int32Array(frames + 1), ps = new Int32Array(frames + 1);
      let last = 0;
      for (let i = 0; i < frames; i++) {
        const k = state[i];
        pa[i + 1] = pa[i] + (k === 1 ? 1 : 0); pb[i + 1] = pb[i] + (k === 2 ? 1 : 0);
        const sw = (k === 1 || k === 2) && last && k !== last ? 1 : 0;
        if (k === 1 || k === 2) last = k;
        ps[i + 1] = ps[i] + sw;
      }
      for (let i = 0; i < frames; i++) {
        const a0 = Math.max(0, i - 50), a1 = Math.min(frames, i + 50);
        if (ps[a1] - ps[a0] >= 3 && pa[a1] - pa[a0] >= 15 && pb[a1] - pb[a0] >= 15 && voiced[i]) cross[i] = 1;
      }
    }
    {
      // level difference "in between" the two speakers for at least half of the voiced time in a 1 s window
      const pm = new Int32Array(frames + 1), pv = new Int32Array(frames + 1);
      for (let i = 0; i < frames; i++) { pm[i + 1] = pm[i] + (state[i] === 3 ? 1 : 0); pv[i + 1] = pv[i] + voiced[i]; }
      for (let i = 0; i < frames; i++) {
        const a0 = Math.max(0, i - 50), a1 = Math.min(frames, i + 50);
        const v = pv[a1] - pv[a0];
        if (voiced[i] && v >= 40 && pm[a1] - pm[a0] >= 0.5 * v) cross[i] = 1;
      }
      for (let i = 0; i < frames; i++) if (state[i] === 3) state[i] = ds[i] >= mid ? 1 : 2;
    }
    for (let i = 0; i < frames;) {
      if (!cross[i]) { i++; continue; }
      let j = i; while (j < frames && cross[j]) j++;
      if (j - i >= 60) for (let k = i; k < j; k++) if (voiced[k]) state[k] = 3;
      i = j;
    }
    // remove runs shorter than 200 ms
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < frames;) {
        let j = i; while (j < frames && state[j] === state[i]) j++;
        if (j - i < 20 && i > 0) for (let k = i; k < j; k++) state[k] = state[i - 1];
        i = j;
      }
    }
    const loud = new Float32Array(frames);
    for (let i = 0; i < frames; i++) loud[i] = Math.max(nA[i], nB[i]);
    for (let i = 0; i < frames; i++) if (state[i] === 3) state[i] = 255;
    return { state, levels: [nA, nB], loud, separation };
  }

  function aligned(id: string, off: number, t0: number, frames: number) {
    const E = tracks.get(id)!.e100; const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) { const k = Math.round((t0 + i / 100 + off) * 100); out[i] = k >= 0 && k < E.length ? E[k] : -100; }
    return out;
  }
  function normLevel(db: Float32Array) {
    const valid = Array.from(db).filter((v) => v > -99);
    const nf = pct(valid, 0.1), pk = pct(valid, 0.97);
    const out = new Float32Array(db.length);
    for (let i = 0; i < db.length; i++) out[i] = Math.max(0, Math.min(1, (db[i] - nf) / Math.max(3, pk - nf)));
    return out;
  }
  function median(v: number[]) { if (!v.length) return NaN; const a = v.slice().sort((x, y) => x - y); return a[a.length >> 1]; }

  /**
   * Three or more speakers, one signal each (own microphone, or the sound of the person's camera).
   * Each signal is calibrated by its level when "its" speaker talks vs. when others talk (iterated),
   * so microphone bleed and different gains are tolerated. Several voices at once → 255.
   */
  function speechN(ids: string[], offs: number[], t0: number, frames: number) {
    const N = ids.length;
    const db = ids.map((id, k) => aligned(id, offs[k], t0, frames));
    const lv = db.map(normLevel);
    const voiced = new Uint8Array(frames);
    let on = false, hang = 0;
    for (let i = 0; i < frames; i++) {
      let m = 0; for (let k = 0; k < N; k++) if (lv[k][i] > m) m = lv[k][i];
      if (!on && m > 0.42) on = true; else if (on && m < 0.3) { if (++hang > 25) { on = false; hang = 0; } } else hang = 0;
      voiced[i] = on ? 1 : 0;
    }
    // frames with real sound (not just the hangover between syllables)
    const active = new Uint8Array(frames);
    for (let i = 0; i < frames; i++) { let m = 0; for (let k = 0; k < N; k++) if (lv[k][i] > m) m = lv[k][i]; active[i] = voiced[i] && m > 0.35 ? 1 : 0; }
    const W = 15;
    // 150 ms smoothing in the power domain (quiet gaps between syllables don't drag the level down)
    const sm = db.map((d) => { const o = new Float32Array(frames); let acc = 0; const p = (v: number) => Math.pow(10, v / 10); for (let i = 0; i < frames; i++) { acc += p(d[i]); if (i >= W) acc -= p(d[i - W]); o[i] = 10 * Math.log10(Math.max(1e-10, acc / Math.min(i + 1, W))); } return o; });
    const lab = new Int16Array(frames).fill(-1);
    const score = new Float32Array(frames * N);
    // first guess: level above the signal's own median
    const base = sm.map((d) => { const v: number[] = []; for (let i = 0; i < frames; i += 3) if (active[i]) v.push(d[i]); return median(v); });
    for (let i = 0; i < frames; i++) {
      if (!active[i]) continue;
      let best = -1, bv = -Infinity; for (let k = 0; k < N; k++) { const v = sm[k][i] - base[k]; if (v > bv) { bv = v; best = k; } }
      lab[i] = best;
    }
    const own = new Float64Array(N), other = new Float64Array(N);
    for (let it = 0; it < 5; it++) {
      for (let k = 0; k < N; k++) {
        const a: number[] = [], b: number[] = [];
        for (let i = 0; i < frames; i += 2) { if (lab[i] === k) a.push(sm[k][i]); else if (lab[i] >= 0) b.push(sm[k][i]); }
        own[k] = a.length > 20 ? median(a) : base[k] + 6; other[k] = b.length > 20 ? median(b) : base[k] - 6;
      }
      for (let i = 0; i < frames; i++) {
        if (!active[i]) { lab[i] = -1; continue; }
        let b1 = -1, v1 = -Infinity, v2 = -Infinity;
        for (let k = 0; k < N; k++) {
          const v = (sm[k][i] - other[k]) / Math.max(1.5, own[k] - other[k]);
          score[i * N + k] = v;
          if (v > v1) { v2 = v1; v1 = v; b1 = k; } else if (v > v2) v2 = v;
        }
        lab[i] = v1 >= 0.5 && v1 - v2 >= 0.2 ? b1 : -2;
      }
    }
    let separation = Infinity; for (let k = 0; k < N; k++) separation = Math.min(separation, own[k] - other[k]);
    const nearest = (i: number) => { let b = 0, v = -Infinity; for (let k = 0; k < N; k++) if (score[i * N + k] > v) { v = score[i * N + k]; b = k; } return b; };
    // crosstalk windows: ambiguous most of the time, or rapid changes between several people
    const pv = new Int32Array(frames + 1), pa = new Int32Array(frames + 1), ps = new Int32Array(frames + 1);
    const cnt = Array.from({ length: N }, () => new Int32Array(frames + 1));
    let last = -1;
    for (let i = 0; i < frames; i++) {
      pv[i + 1] = pv[i] + active[i]; pa[i + 1] = pa[i] + (lab[i] === -2 ? 1 : 0);
      for (let k = 0; k < N; k++) cnt[k][i + 1] = cnt[k][i] + (lab[i] === k ? 1 : 0);
      const sw = lab[i] >= 0 && last >= 0 && lab[i] !== last ? 1 : 0; if (lab[i] >= 0) last = lab[i];
      ps[i + 1] = ps[i] + sw;
    }
    const cross = new Uint8Array(frames);
    for (let i = 0; i < frames; i++) {
      if (!voiced[i]) continue;
      const a0 = Math.max(0, i - 50), a1 = Math.min(frames, i + 50), v = pv[a1] - pv[a0];
      let many = 0; for (let k = 0; k < N; k++) if (cnt[k][a1] - cnt[k][a0] >= 15) many++;
      if ((v >= 40 && pa[a1] - pa[a0] >= 0.5 * v) || (ps[a1] - ps[a0] >= 3 && many >= 2)) cross[i] = 1;
    }
    const state = new Uint8Array(frames);
    // pauses inside speech (voiced but quiet) keep the previous speaker
    let prevK = 0;
    for (let i = 0; i < frames; i++) {
      if (!voiced[i]) { state[i] = 0; continue; }
      if (!active[i]) { state[i] = prevK || nearest(i) + 1; continue; }
      state[i] = lab[i] >= 0 ? lab[i] + 1 : nearest(i) + 1; prevK = state[i];
    }
    for (let i = 0; i < frames;) {
      if (!cross[i]) { i++; continue; }
      let j = i; while (j < frames && cross[j]) j++;
      if (j - i >= 60) for (let k = i; k < j; k++) if (voiced[k]) state[k] = 255;
      i = j;
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < frames;) {
        let j = i; while (j < frames && state[j] === state[i]) j++;
        if (j - i < 20 && i > 0) for (let k = i; k < j; k++) state[k] = state[i - 1];
        i = j;
      }
    }
    const loud = new Float32Array(frames);
    for (let i = 0; i < frames; i++) { let m = 0; for (let k = 0; k < N; k++) if (lv[k][i] > m) m = lv[k][i]; loud[i] = m; }
    return { state, levels: lv, loud, separation: Number.isFinite(separation) ? separation : 0 };
  }

  return {
    speechN,
    add(id: string, samples: Float32Array, sr: number) { const e = envelopes(samples, sr); tracks.set(id, e); return e.e100.length / 100; },
    sync,
    speech,
    clear() { tracks.clear(); },
  };
}

type Req =
  | { op: 'add'; id: string; samples: Float32Array; sr: number }
  | { op: 'sync'; ref: string; id: string }
  | { op: 'speech'; ids: string[]; offs: number[]; t0: number; frames: number };

/** Main-thread handle to the analysis worker. */
export class PodAnalyzer {
  private worker: Worker;
  private seq = 0;
  private waiting = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  constructor() {
    const src = `const K=(${podKernel.toString()})();self.onmessage=(e)=>{const {id,req}=e.data;try{let out;
      if(req.op==='add')out=K.add(req.id,req.samples,req.sr);
      else if(req.op==='sync')out=K.sync(req.ref,req.id);
      else if(req.op==='speech'){const r=req.ids.length===2?K.speech(req.ids[0],req.ids[1],req.offs[0],req.offs[1],req.t0,req.frames):K.speechN(req.ids,req.offs,req.t0,req.frames);self.postMessage({id,out:r},[r.state.buffer,r.loud.buffer,...r.levels.map(l=>l.buffer)]);return;}
      self.postMessage({id,out});}catch(err){self.postMessage({id,error:String(err&&err.message||err)});}};`;
    this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    this.worker.onmessage = (e: MessageEvent<{ id: number; out?: unknown; error?: string }>) => {
      const w = this.waiting.get(e.data.id); if (!w) return;
      this.waiting.delete(e.data.id);
      if (e.data.error) w.rej(new Error(e.data.error)); else w.res(e.data.out);
    };
  }
  private call<T>(req: Req, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((res, rej) => { this.waiting.set(id, { res: res as (v: unknown) => void, rej }); this.worker.postMessage({ id, req }, transfer); });
  }
  /** returns the recording length in seconds */
  add(id: string, samples: Float32Array, sr: number) { return this.call<number>({ op: 'add', id, samples, sr }, [samples.buffer]); }
  sync(ref: string, id: string) { return this.call<{ offset: number; confidence: number }>({ op: 'sync', ref, id }); }
  /** speech state from one signal per speaker (2 speakers: level-difference clustering; 3+: per-signal calibration) */
  speech(ids: string[], offs: number[], t0: number, frames: number) {
    return this.call<{ state: Uint8Array; levels: Float32Array[]; loud: Float32Array; separation: number }>({ op: 'speech', ids, offs, t0, frames });
  }
  dispose() { this.worker.terminate(); this.waiting.forEach((w) => w.rej(new Error('cancelled'))); this.waiting.clear(); }
}

/** exported for tests (node) */
export const __podKernel = podKernel;
