import type { BoardObject, Point } from '@tinycanvas/shared';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rectRight = (r: Rect) => r.x + r.w;
export const rectBottom = (r: Rect) => r.y + r.h;
export const rectCenter = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function unionRects(rects: Iterable<Rect>): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function inflate(r: Rect, d: number, dy = d): Rect {
  return { x: r.x - d, y: r.y - dy, w: r.w + 2 * d, h: r.h + 2 * dy };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (!deg) return { x: p.x, y: p.y };
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** 物件（可能旋轉）的四個角，依序為左上、右上、右下、左下 */
export function objectCorners(o: Rect & { rotation?: number }): Point[] {
  const c = rectCenter(o);
  const pts = [
    { x: o.x, y: o.y },
    { x: o.x + o.w, y: o.y },
    { x: o.x + o.w, y: o.y + o.h },
    { x: o.x, y: o.y + o.h },
  ];
  return o.rotation ? pts.map((p) => rotatePoint(p, c, o.rotation!)) : pts;
}

/** 物件旋轉後的軸對齊外接框 */
export function rotatedAabb(o: Rect & { rotation?: number }): Rect {
  if (!o.rotation) return { x: o.x, y: o.y, w: o.w, h: o.h };
  return unionRects(objectCorners(o).map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!;
}

/** 世界座標點轉成物件未旋轉時的座標（相對於物件中心旋轉回去） */
export function toLocal(o: Rect & { rotation?: number }, p: Point): Point {
  return o.rotation ? rotatePoint(p, rectCenter(o), -o.rotation) : p;
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

/** 把 p 投影到從 origin 出發、角度為 step 度倍數中最接近的射線上（Shift 限制連線角度用） */
export function snapAngle(origin: Point, p: Point, step = 45): Point {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  if (!dx && !dy) return { ...p };
  const rad = (Math.round((Math.atan2(dy, dx) * 180) / Math.PI / step) * step * Math.PI) / 180;
  const ux = Math.round(Math.cos(rad) * 1e12) / 1e12;
  const uy = Math.round(Math.sin(rad) * 1e12) / 1e12;
  const len = dx * ux + dy * uy;
  return { x: origin.x + ux * len, y: origin.y + uy * len };
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function rectsEqual(a: Rect, b: Rect, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.w - b.w) < eps && Math.abs(a.h - b.h) < eps;
}

export function objectRect(o: BoardObject): Rect {
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
