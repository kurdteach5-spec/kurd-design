export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
/** 2D affine matrix: [a c e; b d f; 0 0 1] (same layout as canvas setTransform). */
export interface Matrix { a: number; b: number; c: number; d: number; e: number; f: number }

export const IDENTITY: Matrix = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const round = (v: number, p = 2) => { const k = 10 ** p; return Math.round(v * k) / k; };
export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  // m1 * m2 (apply m2 first, then m1)
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function invert(m: Matrix): Matrix {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return { ...IDENTITY };
  const id = 1 / det;
  return {
    a: m.d * id, b: -m.b * id, c: -m.c * id, d: m.a * id,
    e: (m.c * m.f - m.d * m.e) * id,
    f: (m.b * m.e - m.a * m.f) * id,
  };
}

export const apply = (m: Matrix, p: Point): Point => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
export const applyVec = (m: Matrix, p: Point): Point => ({ x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y });
export const translate = (tx: number, ty: number): Matrix => ({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
export const scaleM = (sx: number, sy: number): Matrix => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
export function rotateM(rad: number): Matrix { const c = Math.cos(rad), s = Math.sin(rad); return { a: c, b: s, c: -s, d: c, e: 0, f: 0 }; }
export function rotateAround(rad: number, p: Point): Matrix { return multiply(translate(p.x, p.y), multiply(rotateM(rad), translate(-p.x, -p.y))); }
export function scaleAround(sx: number, sy: number, p: Point): Matrix { return multiply(translate(p.x, p.y), multiply(scaleM(sx, sy), translate(-p.x, -p.y))); }
export const isIdentity = (m: Matrix) => m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
export const isTranslationOnly = (m: Matrix) => m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;
export const isIntegerTranslation = (m: Matrix) => isTranslationOnly(m) && Number.isInteger(m.e) && Number.isInteger(m.f);

/** Matrix mapping the unit square onto a parallelogram given by 3 corners. */
export function frameFromCorners(p00: Point, p10: Point, p01: Point): Matrix {
  return { a: p10.x - p00.x, b: p10.y - p00.y, c: p01.x - p00.x, d: p01.y - p00.y, e: p00.x, f: p00.y };
}

export function rectCorners(r: Rect): Point[] {
  return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
}
export function boundsOfPoints(pts: Point[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
  if (!isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function transformRect(m: Matrix, r: Rect): Rect { return boundsOfPoints(rectCorners(r).map((p) => apply(m, p))); }
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b; if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}
export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y; const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0; t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
/** Decompose an affine matrix into translation/rotation/scale/skew for numeric UI. */
export function decompose(m: Matrix) {
  const sx = Math.hypot(m.a, m.b);
  const rot = Math.atan2(m.b, m.a);
  const det = m.a * m.d - m.b * m.c;
  const sy = sx ? det / sx : 0;
  const skew = sx ? Math.atan2(m.a * m.c + m.b * m.d, det) : 0;
  return { x: m.e, y: m.f, scaleX: sx, scaleY: sy, rotation: rad2deg(rot), skew: rad2deg(skew) };
}
/** Solve projective mapping from unit square to quad (for perspective/distort). */
export function squareToQuad(q: Point[]): number[] {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h];
}
export function projectUnit(h: number[], u: number, v: number): Point {
  const w = h[6] * u + h[7] * v + 1;
  return { x: (h[0] * u + h[1] * v + h[2]) / w, y: (h[3] * u + h[4] * v + h[5]) / w };
}
