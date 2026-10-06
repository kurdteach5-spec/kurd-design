import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * Tiny Zustand-compatible store: `create((set, get) => state)` returns a hook with
 * `getState`, `setState` and `subscribe`. Components subscribe with selectors so
 * only the parts that read changed state re-render.
 */
export type SetState<T> = (partial: Partial<T> | ((s: T) => Partial<T>), replace?: boolean) => void;
export type GetState<T> = () => T;
export type Listener<T> = (state: T, prev: T) => void;

export interface StoreApi<T> {
  getState: GetState<T>;
  setState: SetState<T>;
  subscribe: (listener: Listener<T>) => () => void;
}

export type UseStore<T> = {
  (): T;
  <U>(selector: (s: T) => U, equality?: (a: U, b: U) => boolean): U;
} & StoreApi<T>;

export function create<T extends object>(init: (set: SetState<T>, get: GetState<T>) => T): UseStore<T> {
  let state: T;
  const listeners = new Set<Listener<T>>();
  const getState: GetState<T> = () => state;
  const setState: SetState<T> = (partial, replace) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    if (Object.is(next, state)) return;
    const prev = state;
    state = replace ? (next as T) : Object.assign({}, state, next);
    listeners.forEach((l) => l(state, prev));
  };
  const subscribe = (l: Listener<T>) => { listeners.add(l); return () => { listeners.delete(l); }; };
  state = init(setState, getState);

  function useStore<U>(selector?: (s: T) => U, equality: (a: U, b: U) => boolean = Object.is): U {
    const sel = (selector ?? ((s: T) => s as unknown as U));
    const cache = useRef<{ state: T; sel: unknown; value: U } | null>(null);
    const getSnapshot = useCallback(() => {
      const s = state;
      const c = cache.current;
      if (c && c.state === s && c.sel === sel) return c.value;
      const value = sel(s);
      if (c && equality(c.value, value)) { c.state = s; c.sel = sel; return c.value; }
      cache.current = { state: s, sel, value };
      return value;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sel, equality]);
    const sub = useCallback((cb: () => void) => subscribe(() => cb()), []);
    return useSyncExternalStore(sub, getSnapshot, getSnapshot);
  }
  const hook = useStore as UseStore<T>;
  hook.getState = getState;
  hook.setState = setState;
  hook.subscribe = subscribe;
  return hook;
}

export function shallow<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}
