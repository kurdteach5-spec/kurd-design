let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

const objIds = new WeakMap<object, number>();
let nextObj = 1;
/** Stable numeric identity for an immutable object (used to build cache keys). */
export function objId(o: object): number {
  let id = objIds.get(o);
  if (!id) { id = nextObj++; objIds.set(o, id); }
  return id;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => { if (t) clearTimeout(t); t = setTimeout(() => { t = undefined; fn(...a); }, ms); };
  d.cancel = () => { if (t) clearTimeout(t); t = undefined; };
  return d;
}

export function throttleRaf<A extends unknown[]>(fn: (...a: A) => void) {
  let pending: A | null = null;
  return (...a: A) => {
    const first = pending === null;
    pending = a;
    if (first) requestAnimationFrame(() => { const p = pending!; pending = null; fn(...p); });
  };
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
export function timeAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}
