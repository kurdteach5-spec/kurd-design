import { filterKernel } from './kernel';
import { nextFrame } from '../utils/id';

type Params = Record<string, number | string | boolean>;
interface Job { resolve: (d: Uint8ClampedArray) => void; reject: (e: Error) => void; progress?: (p: number) => void }
/** Previews run on their own worker so they can be cancelled without touching an Apply in progress. */
export type FilterChannel = 'preview' | 'apply';

const workers = new Map<FilterChannel, Worker>();
const jobs = new Map<FilterChannel, Map<number, Job>>([['preview', new Map()], ['apply', new Map()]]);
let workerFailed = false;
let seq = 0;
let mainKernel: ReturnType<typeof filterKernel> | null = null;

const WORKER_SRC = () => `const K=(${filterKernel.toString()})();
self.onmessage=(e)=>{const m=e.data;try{const d=new Uint8ClampedArray(m.buffer);
K.run(m.name,d,m.w,m.h,m.params,(p)=>self.postMessage({id:m.id,progress:p}));
self.postMessage({id:m.id,done:true,buffer:d.buffer},[d.buffer]);}catch(err){self.postMessage({id:m.id,error:String(err&&err.message||err)});}};`;

function getWorker(ch: FilterChannel): Worker | null {
  if (workerFailed) return null;
  const existing = workers.get(ch); if (existing) return existing;
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SRC()], { type: 'text/javascript' }));
    const w = new Worker(url);
    const list = jobs.get(ch)!;
    w.onmessage = (e: MessageEvent) => {
      const m = e.data; const job = list.get(m.id); if (!job) return;
      if (m.progress !== undefined) { job.progress?.(m.progress); return; }
      list.delete(m.id);
      if (m.error) job.reject(new Error(m.error)); else job.resolve(new Uint8ClampedArray(m.buffer));
    };
    w.onerror = (ev) => {
      // e.g. workers blocked by a Content Security Policy: fall back to the main thread
      ev.preventDefault?.();
      workerFailed = true; w.terminate(); workers.delete(ch);
      const pending = [...list.values()]; list.clear();
      pending.forEach((j) => j.reject(new Error('__worker_failed__')));
    };
    workers.set(ch, w);
    return w;
  } catch { workerFailed = true; return null; }
}

/** Cancels running jobs on a channel (used when a preview becomes stale). */
export function cancelFilters(ch: FilterChannel = 'preview') {
  const list = jobs.get(ch)!; const w = workers.get(ch);
  if (w && list.size) {
    w.terminate(); workers.delete(ch);
    const p = [...list.values()]; list.clear();
    p.forEach((j) => j.reject(new Error('cancelled')));
  }
}

async function runMain(name: string, data: Uint8ClampedArray, w: number, h: number, params: Params, progress?: (p: number) => void) {
  if (!mainKernel) mainKernel = filterKernel();
  await nextFrame(); // let the progress indicator paint first
  mainKernel.run(name, data, w, h, params, (p) => progress?.(p));
  return data;
}

/** Runs a filter off the main thread when possible. */
export function runFilter(name: string, data: Uint8ClampedArray, w: number, h: number, params: Params, progress?: (p: number) => void, ch: FilterChannel = 'apply'): Promise<Uint8ClampedArray> {
  const wk = getWorker(ch);
  if (!wk) return runMain(name, data, w, h, params, progress);
  const copy = new Uint8ClampedArray(data); // keep `data` for a possible fallback
  const list = jobs.get(ch)!;
  return new Promise<Uint8ClampedArray>((resolve, reject) => {
    const id = ++seq;
    list.set(id, { resolve, reject, progress });
    wk.postMessage({ id, name, w, h, params, buffer: copy.buffer }, [copy.buffer]);
  }).catch((e: Error) => {
    if (e.message === '__worker_failed__') return runMain(name, data, w, h, params, progress);
    throw e;
  });
}
