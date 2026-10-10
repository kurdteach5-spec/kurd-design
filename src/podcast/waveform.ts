// Sound waveforms for the timeline: peak level of each source, 50 values per second, computed once in the
// background and cached.
import { create } from '../state/createStore';
import { usePod } from './store';
import { decodeLowRate, ANALYSIS_RATE } from './media';

export const PEAK_RATE = 50;
const peaks = new Map<string, Float32Array>();
const pending = new Set<string>();
/** bumps when a waveform is ready, so the timeline redraws */
export const useWaves = create<{ n: number }>(() => ({ n: 0 }));

export function peaksOf(id: string): Float32Array | null {
  const p = peaks.get(id); if (p) return p;
  if (pending.has(id)) return null;
  const src = usePod.getState().sources[id]; if (!src) return null;
  pending.add(id);
  void (async () => {
    try {
      const pcm = await decodeLowRate(src.file);
      const step = Math.round(ANALYSIS_RATE / PEAK_RATE); const n = Math.ceil(pcm.length / step); const out = new Float32Array(n);
      let max = 1e-6;
      for (let i = 0; i < n; i++) { let m = 0; for (let k = i * step; k < Math.min(pcm.length, (i + 1) * step); k++) { const v = Math.abs(pcm[k]); if (v > m) m = v; } out[i] = m; if (m > max) max = m; }
      for (let i = 0; i < n; i++) out[i] = Math.sqrt(out[i] / max); // gentle curve: quiet speech still visible
      peaks.set(id, out);
    } catch { peaks.set(id, new Float32Array(0)); }
    pending.delete(id);
    useWaves.setState((s) => ({ n: s.n + 1 }));
  })();
  return null;
}
