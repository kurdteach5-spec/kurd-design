// Minimal React type surface used ONLY for offline type-checking in environments
// where @types/react cannot be installed. With `npm install`, the real @types/react
// is used instead (tsconfig.json does not include this folder).
declare module 'react' {
  export type Key = string | number;
  export type ReactNode = ReactElement | string | number | bigint | boolean | null | undefined | Iterable<ReactNode>;
  export interface ReactElement<P = any> { type: any; props: P; key: string | null }
  export type JSXElementConstructor<P> = (props: P) => ReactNode;
  export type ComponentType<P = {}> = (props: P) => ReactNode;
  export type FC<P = {}> = (props: P) => ReactNode;
  export type PropsWithChildren<P = unknown> = P & { children?: ReactNode };
  export type CSSProperties = { [k: string]: string | number | undefined };
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export interface RefObject<T> { current: T }
  export interface MutableRefObject<T> { current: T }
  export type Ref<T> = RefObject<T | null> | ((instance: T | null) => void) | null;
  export type DependencyList = readonly unknown[];

  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useReducer<S>(reducer: (s: S) => S, init: S): [S, () => void];
  export function useReducer<S, A>(reducer: (s: S, a: A) => S, init: S): [S, Dispatch<A>];
  export function useRef<T>(initial: T): RefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T | null>;
  export function useRef<T = undefined>(): RefObject<T | undefined>;
  export function useEffect(effect: () => void | (() => void), deps?: DependencyList): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: DependencyList): void;
  export function useMemo<T>(factory: () => T, deps: DependencyList): T;
  export function useCallback<T extends (...args: any[]) => any>(cb: T, deps: DependencyList): T;
  export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T): T;
  export function useId(): string;
  export function useContext<T>(ctx: Context<T>): T;
  export interface Context<T> { Provider: ComponentType<{ value: T; children?: ReactNode }> }
  export function createContext<T>(value: T): Context<T>;
  export function memo<P>(c: (props: P) => ReactNode, eq?: (a: P, b: P) => boolean): (props: P) => ReactNode;
  export function forwardRef<T, P = {}>(render: (props: P, ref: Ref<T>) => ReactNode): (props: P & { ref?: Ref<T> }) => ReactNode;
  export const Fragment: (props: { children?: ReactNode; key?: Key }) => ReactNode;
  export const StrictMode: (props: { children?: ReactNode }) => ReactNode;
  export function startTransition(cb: () => void): void;

  export interface ErrorInfo { componentStack?: string | null }
  export class Component<P = {}, S = {}> {
    constructor(props: P);
    props: Readonly<P> & { children?: ReactNode };
    state: Readonly<S>;
    setState(s: Partial<S> | ((prev: S) => Partial<S>)): void;
    forceUpdate(): void;
    render(): ReactNode;
  }

  interface BaseSyntheticEvent<E = object, C = any, T = any> {
    nativeEvent: E; currentTarget: C; target: T;
    bubbles: boolean; cancelable: boolean; defaultPrevented: boolean;
    preventDefault(): void; stopPropagation(): void; isDefaultPrevented(): boolean; isPropagationStopped(): boolean;
    timeStamp: number; type: string;
  }
  export interface SyntheticEvent<T = Element, E = Event> extends BaseSyntheticEvent<E, EventTarget & T, EventTarget> {}
  export interface UIEvent<T = Element, E = globalThis.UIEvent> extends SyntheticEvent<T, E> {}
  export interface MouseEvent<T = Element, E = globalThis.MouseEvent> extends UIEvent<T, E> {
    altKey: boolean; button: number; buttons: number; clientX: number; clientY: number; ctrlKey: boolean; metaKey: boolean;
    shiftKey: boolean; pageX: number; pageY: number; screenX: number; screenY: number; movementX: number; movementY: number;
    relatedTarget: EventTarget | null; detail: number;
  }
  export interface PointerEvent<T = Element> extends MouseEvent<T, globalThis.PointerEvent> {
    pointerId: number; pressure: number; pointerType: string; width: number; height: number; isPrimary: boolean; tiltX: number; tiltY: number;
  }
  export interface DragEvent<T = Element> extends MouseEvent<T, globalThis.DragEvent> { dataTransfer: DataTransfer }
  export interface WheelEvent<T = Element> extends MouseEvent<T, globalThis.WheelEvent> { deltaX: number; deltaY: number; deltaMode: number }
  export interface KeyboardEvent<T = Element> extends UIEvent<T, globalThis.KeyboardEvent> {
    altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; key: string; code: string; repeat: boolean;
  }
  export interface FocusEvent<T = Element> extends UIEvent<T, globalThis.FocusEvent> { relatedTarget: (EventTarget & Element) | null; target: EventTarget & T }
  export interface FormEvent<T = Element> extends SyntheticEvent<T> {}
  export interface ChangeEvent<T = Element> extends SyntheticEvent<T> { target: EventTarget & T }
  export interface ClipboardEvent<T = Element> extends SyntheticEvent<T, globalThis.ClipboardEvent> { clipboardData: DataTransfer }

  export interface SVGAttributes<T> { [k: string]: any }
  export interface HTMLAttributes<T> { [k: string]: any }
  export interface InputHTMLAttributes<T> extends HTMLAttributes<T> {}
  export interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {}
  export interface DOMProps<T = any> {
    [k: string]: any;
    children?: ReactNode;
    ref?: any;
    onClick?: (e: MouseEvent<T>) => void; onDoubleClick?: (e: MouseEvent<T>) => void; onContextMenu?: (e: MouseEvent<T>) => void;
    onMouseEnter?: (e: MouseEvent<T>) => void; onMouseLeave?: (e: MouseEvent<T>) => void; onAuxClick?: (e: MouseEvent<T>) => void;
    onPointerDown?: (e: PointerEvent<T>) => void; onPointerMove?: (e: PointerEvent<T>) => void; onPointerUp?: (e: PointerEvent<T>) => void; onPointerLeave?: (e: PointerEvent<T>) => void;
    onKeyDown?: (e: KeyboardEvent<T>) => void; onKeyUp?: (e: KeyboardEvent<T>) => void;
    onChange?: (e: ChangeEvent<T>) => void; onInput?: (e: FormEvent<T>) => void;
    onFocus?: (e: FocusEvent<T>) => void; onBlur?: (e: FocusEvent<T>) => void;
    onDragStart?: (e: DragEvent<T>) => void; onDragOver?: (e: DragEvent<T>) => void; onDragLeave?: (e: DragEvent<T>) => void; onDrop?: (e: DragEvent<T>) => void;
    onWheel?: (e: WheelEvent<T>) => void;
  }
  export namespace JSX {
    type Element = ReactElement<any>;
    type ElementType = string | ((props: any) => ReactNode) | (new (props: any) => Component<any, any>);
    interface IntrinsicElements {
      input: DOMProps<HTMLInputElement>; textarea: DOMProps<HTMLTextAreaElement>; select: DOMProps<HTMLSelectElement>;
      button: DOMProps<HTMLButtonElement>; canvas: DOMProps<HTMLCanvasElement>; svg: DOMProps<SVGSVGElement>;
      [elemName: string]: DOMProps<any>;
    }
    interface IntrinsicAttributes { key?: Key }
    interface ElementChildrenAttribute { children: {} }
  }
  const React: {
    createElement: any; Fragment: typeof Fragment; Component: typeof Component;
  };
  export default React;
}

declare module 'react/jsx-runtime' {
  import type { JSX as RJSX } from 'react';
  export namespace JSX {
    type Element = RJSX.Element;
    interface IntrinsicElements extends RJSX.IntrinsicElements {}
    interface IntrinsicAttributes extends RJSX.IntrinsicAttributes {}
    type ElementType = RJSX.ElementType;
    interface ElementChildrenAttribute extends RJSX.ElementChildrenAttribute {}
  }
  export const jsx: any; export const jsxs: any; export const Fragment: any;
}

declare module 'react-dom/client' {
  import type { ReactNode } from 'react';
  export interface Root { render(node: ReactNode): void; unmount(): void }
  export function createRoot(el: Element | DocumentFragment): Root;
}

declare module 'react-dom' {
  import type { ReactNode } from 'react';
  export function createPortal(node: ReactNode, container: Element): any;
  export function flushSync<R>(fn: () => R): R;
}

declare namespace React {
    type ReactNode = import('react').ReactNode;
    type PointerEvent<T = Element> = import('react').PointerEvent<T>;
    type MouseEvent<T = Element> = import('react').MouseEvent<T>;
    type KeyboardEvent<T = Element> = import('react').KeyboardEvent<T>;
    type DragEvent<T = Element> = import('react').DragEvent<T>;
    type ChangeEvent<T = Element> = import('react').ChangeEvent<T>;
    type RefObject<T> = import('react').RefObject<T>;
    type CSSProperties = import('react').CSSProperties;
}
