import type { AnchorSide, BoardObject, Point } from '@tinycanvas/shared';
import { shapePath, type PathSink } from '../render/shapes';

/**
 * 物件外框（未旋轉、以物件左上角為原點）攤平成折線，供任意連接點投影使用。
 * 非形狀物件與一般矩形一律為外接矩形；其他形狀取 shapePath 的實際輪廓。
 */

type Polyline = Point[];

const STEPS = 12;

/** 把 shapePath 的指令攤平成折線（曲線以固定段數取樣） */
class FlattenSink implements PathSink {
  lines: Polyline[] = [];
  private cur: Polyline | null = null;
  private last: Point = { x: 0, y: 0 };

  private push(p: Point) {
    if (!this.cur) {
      this.cur = [{ ...this.last }];
      this.lines.push(this.cur);
    }
    this.cur.push(p);
    this.last = p;
  }

  moveTo(x: number, y: number) {
    this.cur = [{ x, y }];
    this.lines.push(this.cur);
    this.last = { x, y };
  }
  lineTo(x: number, y: number) {
    this.push({ x, y });
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    const p0 = this.last;
    for (let i = 1; i <= STEPS; i++) {
      const t = i / STEPS;
      const u = 1 - t;
      this.push({
        x: u * u * u * p0.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
        y: u * u * u * p0.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
      });
    }
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    const p0 = this.last;
    for (let i = 1; i <= STEPS; i++) {
      const t = i / STEPS;
      const u = 1 - t;
      this.push({ x: u * u * p0.x + 2 * u * t * cx + t * t * x, y: u * u * p0.y + 2 * u * t * cy + t * t * y });
    }
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number) {
    const p0 = this.last;
    const a = norm(p0.x - x1, p0.y - y1);
    const b = norm(x2 - x1, y2 - y1);
    const cos = a.x * b.x + a.y * b.y;
    if (r <= 0 || !a.l || !b.l || Math.abs(cos) > 0.9999) {
      this.push({ x: x1, y: y1 });
      return;
    }
    const half = Math.acos(cos) / 2;
    const d = r / Math.tan(half);
    const t1 = { x: x1 + a.x * d, y: y1 + a.y * d };
    const t2 = { x: x1 + b.x * d, y: y1 + b.y * d };
    const bis = norm(a.x + b.x, a.y + b.y);
    const k = r / Math.sin(half);
    const c = { x: x1 + bis.x * k, y: y1 + bis.y * k };
    this.push(t1);
    const a1 = Math.atan2(t1.y - c.y, t1.x - c.x);
    let sweep = Math.atan2(t2.y - c.y, t2.x - c.x) - a1;
    if (sweep > Math.PI) sweep -= Math.PI * 2;
    if (sweep < -Math.PI) sweep += Math.PI * 2;
    for (let i = 1; i <= STEPS; i++) {
      const ang = a1 + (sweep * i) / STEPS;
      this.push({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r });
    }
  }
  ellipse(x: number, y: number, rx: number, ry: number, _rot: number, a0: number, a1: number, ccw = false) {
    let sweep = a1 - a0;
    if (Math.abs(sweep) >= Math.PI * 2) sweep = ccw ? -Math.PI * 2 : Math.PI * 2;
    else if (!ccw && sweep < 0) sweep += Math.PI * 2;
    else if (ccw && sweep > 0) sweep -= Math.PI * 2;
    const n = STEPS * 4;
    const at = (i: number) => {
      const ang = a0 + (sweep * i) / n;
      return { x: x + Math.cos(ang) * rx, y: y + Math.sin(ang) * ry };
    };
    // 與 canvas 相同：有目前的子路徑時，先連線到起點
    if (this.cur) this.push(at(0));
    else this.moveTo(at(0).x, at(0).y);
    for (let i = 1; i <= n; i++) this.push(at(i));
  }
  rect(x: number, y: number, w: number, h: number) {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  closePath() {
    if (!this.cur) return;
    const s = this.cur[0];
    this.push({ ...s });
    this.cur = null;
    this.last = s;
  }
}

function norm(x: number, y: number) {
  const l = Math.hypot(x, y);
  return l ? { x: x / l, y: y / l, l } : { x: 0, y: 0, l: 0 };
}

function rectOutline(w: number, h: number): Polyline[] {
  return [
    [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
      { x: 0, y: 0 },
    ],
  ];
}

const cache = new Map<string, Polyline[]>();
const CACHE_MAX = 512;

/** 物件外框折線（未旋轉，原點為物件左上角） */
export function localOutline(o: BoardObject): Polyline[] {
  const w = Math.max(o.w, 1);
  const h = Math.max(o.h, 1);
  // 一般矩形的 3 px 圓角對連接點沒有影響，直接用外接矩形
  if (o.type !== 'shape' || o.shapeKind === 'rectangle') return rectOutline(w, h);
  const key = `${o.shapeKind}|${w}|${h}`;
  let lines = cache.get(key);
  if (!lines) {
    const sink = new FlattenSink();
    shapePath(sink, o.shapeKind, 0, 0, w, h, true);
    lines = sink.lines.filter((l) => l.length >= 2);
    if (!lines.length) lines = rectOutline(w, h);
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, lines);
  }
  return lines;
}

/** 外框上離 p 最近的點（p 與回傳值皆為物件本地座標）與距離 */
export function nearestOnOutline(o: BoardObject, p: Point): { p: Point; d: number } {
  let best = { x: 0, y: 0 };
  let bd = Infinity;
  for (const line of localOutline(o)) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      const q = { x: a.x + dx * t, y: a.y + dy * t };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
  }
  return { p: best, d: bd };
}

/** p（物件本地座標）是否在外框內（even-odd） */
export function insideOutline(o: BoardObject, p: Point): boolean {
  let inside = false;
  for (const line of localOutline(o)) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

const SIDE_VEC: Record<AnchorSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/**
 * 四邊的連接點：從外接框中心朝該方向射出，取與外框最遠的交點。
 * 矩形、橢圓、菱形就是邊的中點；三角形的左右兩點會落在斜邊上，而不是懸空在外接框上。
 */
export function sideOnOutline(o: BoardObject, side: AnchorSide): Point {
  const w = Math.max(o.w, 1);
  const h = Math.max(o.h, 1);
  const c = { x: w / 2, y: h / 2 };
  const d = SIDE_VEC[side];
  const fallback = { x: c.x + (d.x * w) / 2, y: c.y + (d.y * h) / 2 };
  if (o.type !== 'shape' || o.shapeKind === 'rectangle') return fallback;
  let bestT = -1;
  for (const line of localOutline(o)) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      // 射線 c + t·d 與線段 a + s·(b - a) 的交點
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-9) continue;
      const ax = a.x - c.x;
      const ay = a.y - c.y;
      const t = (ax * ey - ay * ex) / den;
      const s = (ax * d.y - ay * d.x) / den;
      if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9 && t > bestT) bestT = t;
    }
  }
  return bestT < 0 ? fallback : { x: c.x + d.x * bestT, y: c.y + d.y * bestT };
}
