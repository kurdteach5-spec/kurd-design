import type { Point } from '../utils/math';
import type { Engine } from '../canvas/engine';
import type { ToolId } from '../state/toolStore';

export interface ToolPointerEvent {
  doc: Point;
  screen: Point;
  button: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean; // ctrl or cmd
  pressure: number;
  pointerType: string;
  native: PointerEvent;
}

export interface Tool {
  id: ToolId;
  /** CSS cursor for the viewport. */
  cursor(engine: Engine, e?: ToolPointerEvent | null): string;
  onDown?(e: ToolPointerEvent, engine: Engine): void;
  onMove?(e: ToolPointerEvent, engine: Engine, dragging: boolean): void;
  onUp?(e: ToolPointerEvent, engine: Engine): void;
  onDoubleClick?(e: ToolPointerEvent, engine: Engine): void;
  onKeyDown?(e: KeyboardEvent, engine: Engine): boolean;
  onKeyUp?(e: KeyboardEvent, engine: Engine): boolean;
  /** Draw in screen space (ctx already scaled for devicePixelRatio). */
  drawOverlay?(ctx: CanvasRenderingContext2D, engine: Engine): void;
  activate?(engine: Engine): void;
  deactivate?(engine: Engine): void;
  /** Enter / commit button in the options bar. */
  commit?(engine: Engine): void;
  /** Escape / cancel button in the options bar. */
  cancel?(engine: Engine): void;
  /** Whether the tool currently has an uncommitted session (shows commit/cancel). */
  hasSession?(): boolean;
  /** Draws while hovering, so the viewport should redraw overlay on move. */
  hoverOverlay?: boolean;
}
