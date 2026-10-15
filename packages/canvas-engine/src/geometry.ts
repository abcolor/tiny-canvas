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

/**
 * 縮圖尺寸：等比縮小到 maxW × maxH 以內，不放大（內容很少時維持 1:1）。至少 1 px
 */
export function thumbnailSize(content: Rect, maxW: number, maxH: number): { scale: number; width: number; height: number } {
  const scale = Math.min(maxW / Math.max(content.w, 1), maxH / Math.max(content.h, 1), 1);
  return {
    scale,
    width: Math.min(maxW, Math.max(1, Math.round(content.w * scale))),
    height: Math.min(maxH, Math.max(1, Math.round(content.h * scale))),
  };
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

/** 物件框在某軸上可對齊的三條線：起邊、中心、終邊 */
function rectLines(r: Rect, axis: 'x' | 'y'): number[] {
  return axis === 'x' ? [r.x, r.x + r.w / 2, r.x + r.w] : [r.y, r.y + r.h / 2, r.y + r.h];
}

/** 縮放時把移動中的邊吸到附近物件的邊或中心：回傳 tol 以內最近的線，沒有則回傳 null */
export function nearestAlignLine(v: number, refs: Rect[], axis: 'x' | 'y', tol: number): number | null {
  let best: number | null = null;
  for (const r of refs) {
    for (const line of rectLines(r, axis)) {
      if (Math.abs(line - v) <= tol && (best === null || Math.abs(line - v) < Math.abs(best - v))) best = line;
    }
  }
  return best;
}

export interface AlignGuide {
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
  /** 等距提示：畫在兩個物件之間的間距上，兩端加短橫槓 */
  gap?: boolean;
}

/**
 * 縮放後的參考線：r 上指定的線（xs 為垂直線的 x、ys 為水平線的 y）與參考物件的邊或中心重合時，
 * 畫一條從 r 延伸到所有重合物件的線
 */
export function alignGuides(r: Rect, lines: { xs: number[]; ys: number[] }, refs: Rect[]): AlignGuide[] {
  const out: AlignGuide[] = [];
  const eps = 1e-6;
  for (const axis of ['x', 'y'] as const) {
    for (const pos of axis === 'x' ? lines.xs : lines.ys) {
      const hits = refs.filter((ref) => rectLines(ref, axis).some((l) => Math.abs(l - pos) < eps));
      if (!hits.length) continue;
      const cross = (q: Rect) => (axis === 'x' ? [q.y, q.y + q.h] : [q.x, q.x + q.w]);
      const ends = [r, ...hits].flatMap(cross);
      out.push({ axis, pos, from: Math.min(...ends), to: Math.max(...ends) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 等距（移動時的間距提示）

const lo = (r: Rect, axis: 'x' | 'y') => (axis === 'x' ? r.x : r.y);
const hi = (r: Rect, axis: 'x' | 'y') => (axis === 'x' ? r.x + r.w : r.y + r.h);
/** 兩個物件在另一軸上的範圍有重疊（才算同一排 / 同一列的鄰居） */
const crossOverlap = (a: Rect, b: Rect, axis: 'x' | 'y') => {
  const c = axis === 'x' ? 'y' : 'x';
  return lo(a, c) < hi(b, c) && lo(b, c) < hi(a, c);
};

/** axis 方向上，r 前面（before）或後面（after）最近、且另一軸範圍重疊的物件 */
function neighbor(r: Rect, refs: Rect[], axis: 'x' | 'y', side: 'before' | 'after'): Rect | null {
  let best: Rect | null = null;
  for (const q of refs) {
    if (q === r || !crossOverlap(r, q, axis)) continue;
    if (side === 'before' ? hi(q, axis) <= lo(r, axis) + 0.5 && (!best || hi(q, axis) > hi(best, axis)) : lo(q, axis) >= hi(r, axis) - 0.5 && (!best || lo(q, axis) < lo(best, axis))) best = q;
  }
  return best;
}

/**
 * 移動時的等距吸附（axis 方向）：
 * - 與前一個鄰居的間距，等於前一個鄰居與再前一個物件的間距（連續等距，後面同理）
 * - 位在前後兩個鄰居的正中間
 * 回傳 tol 以內最近的位移量，沒有則回傳 null
 */
export function equalSpacingSnap(r: Rect, refs: Rect[], axis: 'x' | 'y', tol: number): number | null {
  const size = hi(r, axis) - lo(r, axis);
  const cands: number[] = [];
  const a = neighbor(r, refs, axis, 'before');
  const c = neighbor(r, refs, axis, 'after');
  if (a) {
    const b = neighbor(a, refs, axis, 'before');
    const g = b ? lo(a, axis) - hi(b, axis) : 0;
    if (b && g > 0) cands.push(hi(a, axis) + g - lo(r, axis));
  }
  if (c) {
    const d = neighbor(c, refs, axis, 'after');
    const g = d ? lo(d, axis) - hi(c, axis) : 0;
    if (d && g > 0) cands.push(lo(c, axis) - g - hi(r, axis));
  }
  if (a && c && lo(c, axis) - hi(a, axis) >= size) cands.push((hi(a, axis) + lo(c, axis) - size) / 2 - lo(r, axis));
  let best: number | null = null;
  for (const d of cands) if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  return best;
}

/**
 * 等距提示線：r 與前（後）鄰居的間距，和鄰居與再前（後）一個物件的間距相等時，標出這一串相等的間距；
 * r 位在前後鄰居正中間時，標出兩邊的間距。每個間距畫在兩個物件另一軸重疊範圍的中央
 */
export function spacingGuides(r: Rect, refs: Rect[]): AlignGuide[] {
  const out: AlignGuide[] = [];
  const eps = 1e-6;
  const seen = new Set<string>();
  for (const axis of ['x', 'y'] as const) {
    const c = axis === 'x' ? 'y' : 'x';
    const mark = (p: Rect, q: Rect) => {
      const key = `${axis}:${hi(p, axis)}:${lo(q, axis)}:${lo(p, c)}:${lo(q, c)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const pos = (Math.max(lo(p, c), lo(q, c)) + Math.min(hi(p, c), hi(q, c))) / 2;
      // 沿 axis 方向的間距 → 畫成與 axis 平行的線；AlignGuide.axis 是「線的位置所在的軸」
      out.push({ axis: c, pos, from: hi(p, axis), to: lo(q, axis), gap: true });
    };
    const before = neighbor(r, refs, axis, 'before');
    const after = neighbor(r, refs, axis, 'after');
    const gapBefore = before ? lo(r, axis) - hi(before, axis) : -1;
    const gapAfter = after ? lo(after, axis) - hi(r, axis) : -1;
    // 連續等距：往前（往後）沿著鄰居一路找相同的間距
    const chain = (start: Rect, g: number, side: 'before' | 'after') => {
      const pairs: [Rect, Rect][] = [];
      let p = start;
      for (let i = 0; i < 32; i++) {
        const q = neighbor(p, refs, axis, side);
        if (!q) break;
        const gq = side === 'before' ? lo(p, axis) - hi(q, axis) : lo(q, axis) - hi(p, axis);
        if (Math.abs(gq - g) > eps) break;
        pairs.push(side === 'before' ? [q, p] : [p, q]);
        p = q;
      }
      return pairs;
    };
    if (before && gapBefore > eps) {
      const pairs = chain(before, gapBefore, 'before');
      if (pairs.length) {
        mark(before, r);
        for (const [p, q] of pairs) mark(p, q);
      }
    }
    if (after && gapAfter > eps) {
      const pairs = chain(after, gapAfter, 'after');
      if (pairs.length) {
        mark(r, after);
        for (const [p, q] of pairs) mark(p, q);
      }
    }
    if (before && after && gapBefore > eps && Math.abs(gapBefore - gapAfter) < eps) {
      mark(before, r);
      mark(r, after);
    }
  }
  return out;
}

/**
 * 等距提示線與同方向的對齊線（例如中心對齊線）重疊時會被擋住：把它移開 offset
 * （直的線往右、橫的線往下）。offset 為畫布座標，呼叫端依縮放換算
 */
export function avoidAlignOverlap(guides: AlignGuide[], offset: number): AlignGuide[] {
  const lines = guides.filter((g) => !g.gap);
  return guides.map((g) => {
    if (!g.gap) return g;
    const lo = Math.min(g.from, g.to);
    const hi = Math.max(g.from, g.to);
    const blocked = lines.some((l) => l.axis === g.axis && Math.abs(l.pos - g.pos) < offset / 2 && Math.min(l.from, l.to) < hi && Math.max(l.from, l.to) > lo);
    return blocked ? { ...g, pos: g.pos + offset } : g;
  });
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
