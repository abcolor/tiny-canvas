import type { BoardObject, ConnectorObject, Point } from '@tinycanvas/shared';
import { inflate, intersects, rotatedAabb, type Rect } from '../geometry';
import { connectorRegion, hasManualRoute, resolveEnds, type ResolvedEnd } from './ends';

export interface Route {
  /** 折線點（直線、正交）；曲線時為 [p0, c1, c2, p3] 的三次貝茲曲線 */
  points: Point[];
  curved: boolean;
  /** 起點處朝外的切線方向（畫箭頭用，指向線段外側） */
  startTangent: Point;
  endTangent: Point;
  /** 標籤位置（路徑長度中點） */
  mid: Point;
  bounds: Rect;
}

export const ROUTE_MARGIN = 16;
const BEND_PENALTY = 24;
const MAX_OBSTACLES = 40;

export interface RouteContext {
  get: (id: string) => BoardObject | undefined;
  /** 回傳範圍內可能的障礙物（呼叫端可以用空間索引） */
  obstaclesIn: (r: Rect) => BoardObject[];
}

function norm(p: Point): Point {
  const l = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / l, y: p.y / l };
}

/** 把方向吸附到最近的軸 */
function axisDir(d: Point): Point {
  return Math.abs(d.x) >= Math.abs(d.y) ? { x: Math.sign(d.x) || 1, y: 0 } : { x: 0, y: Math.sign(d.y) || 1 };
}

function boundsOf(points: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function polylineMid(points: Point[]): Point {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  let half = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l >= half && l > 0) return { x: a.x + ((b.x - a.x) * half) / l, y: a.y + ((b.y - a.y) * half) / l };
    half -= l;
  }
  return points[points.length - 1] ?? { x: 0, y: 0 };
}

export function bezierPoint(p: Point[], t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
    y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y,
  };
}

/** 移除重複點與共線的中間點 */
export function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < 0.01 && dot >= 0) out.splice(i, 1);
  }
  return out;
}

/**
 * 拖曳折線第 index 段（points[index] → points[index + 1]）時的對齊吸附：
 * 位置接近前後兩段平行線段（points[index - 1]、points[index + 2]）時對齊它們，
 * 夾在中間的垂直短段長度變成 0，放開後 simplify 會把共線的線段合併（例如四段變兩段）。
 * 不對齊兩端點，避免頭尾段被壓扁。tol 為畫布距離；沒有可對齊的位置時回傳 null。
 */
export function alignSegment(points: Point[], index: number, horizontal: boolean, v: number, tol: number): number | null {
  let best: number | null = null;
  let bd = tol;
  for (const i of [index - 1, index + 2]) {
    if (i <= 0 || i >= points.length - 1) continue;
    const c = horizontal ? points[i].y : points[i].x;
    const d = Math.abs(c - v);
    if (d <= bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------- orthogonal A*

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
function dirIndex(d: Point): number {
  if (d.x > 0) return 0;
  if (d.x < 0) return 1;
  if (d.y > 0) return 2;
  return 3;
}

function uniqSorted(vals: number[], lo: number, hi: number): number[] {
  const s = vals
    .map((v) => Math.min(hi, Math.max(lo, v)))
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > 0.5) out.push(v);
  return out;
}

/**
 * 在稀疏正交可見性格網上做 A*。格線取自障礙物（已外擴 margin）的邊、兩端點的延伸點與中線，
 * 成本 = 長度 + 轉彎懲罰。路徑一律落在 region 內。找不到路徑時回傳 null。
 */
export function orthogonalPath(
  s: Point,
  sDir: Point | null,
  e: Point,
  eDir: Point | null,
  obstacles: Rect[],
  region: Rect,
  margin = ROUTE_MARGIN,
): Point[] | null {
  const sd = sDir ? axisDir(sDir) : null;
  const ed = eDir ? axisDir(eDir) : null;
  const s1 = sd ? { x: s.x + sd.x * margin, y: s.y + sd.y * margin } : s;
  const e1 = ed ? { x: e.x + ed.x * margin, y: e.y + ed.y * margin } : e;
  const obs = obstacles.map((o) => inflate(o, margin));
  const insideAny = (x: number, y: number) => {
    for (const o of obs) if (x > o.x + 0.01 && x < o.x + o.w - 0.01 && y > o.y + 0.01 && y < o.y + o.h - 0.01) return true;
    return false;
  };
  const lo = { x: region.x, y: region.y };
  const hi = { x: region.x + region.w, y: region.y + region.h };
  const xsRaw = [s1.x, e1.x, (s1.x + e1.x) / 2, lo.x + 1, hi.x - 1];
  const ysRaw = [s1.y, e1.y, (s1.y + e1.y) / 2, lo.y + 1, hi.y - 1];
  for (const o of obs) {
    xsRaw.push(o.x, o.x + o.w);
    ysRaw.push(o.y, o.y + o.h);
  }
  const xs = uniqSorted(xsRaw, lo.x, hi.x);
  const ys = uniqSorted(ysRaw, lo.y, hi.y);
  const nx = xs.length;
  const ny = ys.length;
  const idx = (i: number, j: number) => j * nx + i;
  const find = (arr: number[], v: number) => {
    let best = 0;
    for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - v) < Math.abs(arr[best] - v)) best = i;
    return best;
  };
  const si = find(xs, s1.x);
  const sj = find(ys, s1.y);
  const ei = find(xs, e1.x);
  const ej = find(ys, e1.y);
  const blocked = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (insideAny(xs[i], ys[j])) blocked[idx(i, j)] = 1;
  blocked[idx(si, sj)] = 0;
  blocked[idx(ei, ej)] = 0;
  // 線段是否穿過障礙物內部（相鄰格點之間）
  const segBlocked = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return insideAny(mx, my);
  };
  const N = nx * ny;
  const INF = 1e18;
  const cost = new Float64Array(N * 4).fill(INF);
  const prev = new Int32Array(N * 4).fill(-1);
  const heap = new MinHeap();
  const target = idx(ei, ej);
  const h = (i: number, j: number) => Math.abs(xs[i] - xs[ei]) + Math.abs(ys[j] - ys[ej]);
  const startState = idx(si, sj) * 4 + (sd ? dirIndex(sd) : 0);
  if (sd) {
    cost[startState] = 0;
    heap.push(h(si, sj), startState);
  } else {
    for (let d = 0; d < 4; d++) {
      const st = idx(si, sj) * 4 + d;
      cost[st] = 0;
      heap.push(h(si, sj), st);
    }
  }
  const wantArrive = ed ? dirIndex({ x: -ed.x, y: -ed.y }) : -1;
  let found = -1;
  let iter = 0;
  while (heap.size && iter++ < 200000) {
    const st = heap.pop();
    const node = st >> 2;
    const d = st & 3;
    const c = cost[st];
    if (node === target) {
      if (wantArrive < 0 || d === wantArrive) {
        found = st;
        break;
      }
    }
    const i = node % nx;
    const j = (node - i) / nx;
    for (let nd = 0; nd < 4; nd++) {
      // 不允許 180 度迴轉
      if (nd === (d ^ 1)) continue;
      const ni = i + DIRS[nd].x;
      const nj = j + DIRS[nd].y;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const nn = idx(ni, nj);
      if (blocked[nn]) continue;
      if (segBlocked(xs[i], ys[j], xs[ni], ys[nj])) continue;
      const len = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
      let nc = c + len + (nd !== d ? BEND_PENALTY : 0);
      if (nn === target && wantArrive >= 0 && nd !== wantArrive) nc += BEND_PENALTY * 2;
      const ns = nn * 4 + nd;
      if (nc < cost[ns]) {
        cost[ns] = nc;
        prev[ns] = st;
        heap.push(nc + h(ni, nj), ns);
      }
    }
  }
  if (found < 0) {
    // 允許以任何方向抵達終點
    let best = -1;
    for (let d = 0; d < 4; d++) {
      const st = target * 4 + d;
      if (cost[st] < INF && (best < 0 || cost[st] < cost[best])) best = st;
    }
    if (best < 0) return null;
    found = best;
  }
  const path: Point[] = [];
  for (let st = found; st >= 0; st = prev[st]) {
    const node = st >> 2;
    const i = node % nx;
    const j = (node - i) / nx;
    path.push({ x: xs[i], y: ys[j] });
  }
  path.reverse();
  return simplify(fixOrtho([s, ...path, e]));
}

/** 確保相鄰兩點之間是水平或垂直（必要時補一個轉折點） */
function fixOrtho(pts: Point[]): Point[] {
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    if (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01) {
      // 依前一段的方向決定轉折
      const prev = out.length >= 2 ? out[out.length - 2] : null;
      const horizontalFirst = prev ? Math.abs(prev.y - a.y) < 0.01 : true;
      out.push(horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
    }
    out.push(b);
  }
  return out;
}

/** 找不到路徑時的簡單 Z 形路由 */
export function elbowPath(s: Point, sDir: Point | null, e: Point, eDir: Point | null, margin = ROUTE_MARGIN): Point[] {
  const sd = sDir ? axisDir(sDir) : null;
  const ed = eDir ? axisDir(eDir) : null;
  const s1 = sd ? { x: s.x + sd.x * margin, y: s.y + sd.y * margin } : s;
  const e1 = ed ? { x: e.x + ed.x * margin, y: e.y + ed.y * margin } : e;
  const horizontal = sd ? sd.x !== 0 : Math.abs(e.x - s.x) >= Math.abs(e.y - s.y);
  const mid = horizontal
    ? [{ x: (s1.x + e1.x) / 2, y: s1.y }, { x: (s1.x + e1.x) / 2, y: e1.y }]
    : [{ x: s1.x, y: (s1.y + e1.y) / 2 }, { x: e1.x, y: (s1.y + e1.y) / 2 }];
  return simplify(fixOrtho([s, s1, ...mid, e1, e]));
}

/**
 * 手動路線：waypoints 是使用者拖曳中間線段後記下的轉折點。中間各段保持不動，
 * 頭尾兩段跟著端點調整（第一個轉折點對齊起點、最後一個對齊終點）；
 * 端點離開的方向與頭尾段垂直時補一小段沿離開方向的短線。
 */
export function manualPath(a: ResolvedEnd, b: ResolvedEnd, waypoints: Point[], margin = ROUTE_MARGIN): Point[] {
  const w = waypoints.map((p) => ({ x: p.x, y: p.y }));
  const n = w.length;
  // 第二段水平 → 第一段垂直；尾端同理
  const firstVertical = Math.abs(w[0].y - w[1].y) < 0.01;
  const lastVertical = Math.abs(w[n - 1].y - w[n - 2].y) < 0.01;
  // 端點離開物件的方向與頭（尾）段垂直時，先沿離開方向走一小段再轉彎
  const lead = (e: ResolvedEnd, vertical: boolean): Point => {
    if (!e.dir) return e.p;
    const d = axisDir(e.dir);
    if ((d.y !== 0) === vertical) return e.p;
    return { x: e.p.x + d.x * margin, y: e.p.y + d.y * margin };
  };
  const s = lead(a, firstVertical);
  const e = lead(b, lastVertical);
  if (firstVertical) w[0].x = s.x;
  else w[0].y = s.y;
  if (lastVertical) w[n - 1].x = e.x;
  else w[n - 1].y = e.y;
  const pts: Point[] = [a.p];
  if (s !== a.p) pts.push(s);
  pts.push(...w);
  if (e !== b.p) pts.push(e);
  pts.push(b.p);
  return simplify(fixOrtho(pts));
}

// ---------------------------------------------------------------- 公開入口

function collectObstacles(c: ConnectorObject, a: ResolvedEnd, b: ResolvedEnd, region: Rect, ctx: RouteContext): Rect[] {
  const exclude = new Set<string>();
  // 端點物件的祖先（容器）不是障礙物
  for (const e of [a, b]) {
    if (!e.obj) continue;
    let p = e.obj.parentId;
    let guard = 0;
    while (p && guard++ < 32) {
      exclude.add(p);
      p = ctx.get(p)?.parentId ?? null;
    }
  }
  const out: { r: Rect; d: number }[] = [];
  const cx = (a.p.x + b.p.x) / 2;
  const cy = (a.p.y + b.p.y) / 2;
  for (const o of ctx.obstaclesIn(region)) {
    if (o.id === c.id || exclude.has(o.id)) continue;
    if (o.type === 'connector' || o.type === 'group' || o.type === 'section') continue;
    const r = rotatedAabb(o);
    if (!intersects(r, region)) continue;
    out.push({ r, d: Math.abs(r.x + r.w / 2 - cx) + Math.abs(r.y + r.h / 2 - cy) });
  }
  for (const e of [a, b]) if (e.obj && !out.some((x) => x.r === e.obj)) out.push({ r: rotatedAabb(e.obj), d: -1 });
  out.sort((p, q) => p.d - q.d);
  // 端點物件一定是障礙物（d = -1 排在最前）
  const seen = new Set<string>();
  const rects: Rect[] = [];
  for (const x of out) {
    const k = `${x.r.x},${x.r.y},${x.r.w},${x.r.h}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rects.push(x.r);
    if (rects.length >= MAX_OBSTACLES) break;
  }
  return rects;
}

/** 沿端點離開方向（吸附到軸）走到物件外接框邊上的點；懸空端點不變 */
function exitPoint(e: ResolvedEnd): Point {
  if (!e.obj || !e.dir) return e.p;
  const r = rotatedAabb(e.obj);
  const d = axisDir(e.dir);
  if (d.x > 0) return { x: Math.max(e.p.x, r.x + r.w), y: e.p.y };
  if (d.x < 0) return { x: Math.min(e.p.x, r.x), y: e.p.y };
  if (d.y > 0) return { x: e.p.x, y: Math.max(e.p.y, r.y + r.h) };
  return { x: e.p.x, y: Math.min(e.p.y, r.y) };
}

export function computeRoute(c: ConnectorObject, ctx: RouteContext): Route {
  const [a, b] = resolveEnds(c, ctx.get);
  const region = connectorRegion(c, ctx.get);
  if (c.routing === 'curved') {
    const d = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y);
    const off = Math.min(120, Math.max(24, d * 0.4));
    const da = a.dir ?? norm({ x: b.p.x - a.p.x, y: b.p.y - a.p.y });
    const db = b.dir ?? norm({ x: a.p.x - b.p.x, y: a.p.y - b.p.y });
    const c1 = { x: a.p.x + da.x * off, y: a.p.y + da.y * off };
    const c2 = { x: b.p.x + db.x * off, y: b.p.y + db.y * off };
    const pts = [a.p, c1, c2, b.p];
    return {
      points: pts,
      curved: true,
      startTangent: norm({ x: a.p.x - c1.x, y: a.p.y - c1.y }),
      endTangent: norm({ x: b.p.x - c2.x, y: b.p.y - c2.y }),
      mid: bezierPoint(pts, 0.5),
      bounds: boundsOf(pts),
    };
  }
  let pts: Point[];
  if (c.routing === 'straight') {
    pts = [a.p, b.p];
  } else if (hasManualRoute(c)) {
    pts = manualPath(a, b, c.waypoints);
  } else {
    const obstacles = collectObstacles(c, a, b, region, ctx);
    // 端點可能在外接框內（橢圓、斜邊上的任意連接點）：先沿離開方向走到外接框邊上再路由
    const sa = exitPoint(a);
    const sb = exitPoint(b);
    const mid = orthogonalPath(sa, a.dir, sb, b.dir, obstacles, region) ?? elbowPath(sa, a.dir, sb, b.dir);
    pts = simplify([a.p, ...mid, b.p]);
  }
  if (pts.length < 2) pts = [a.p, b.p];
  const n = pts.length;
  return {
    points: pts,
    curved: false,
    startTangent: norm({ x: pts[0].x - pts[1].x, y: pts[0].y - pts[1].y }),
    endTangent: norm({ x: pts[n - 1].x - pts[n - 2].x, y: pts[n - 1].y - pts[n - 2].y }),
    mid: polylineMid(pts),
    bounds: boundsOf(pts),
  };
}

/** 路由快取：連線或其端點、附近障礙物變動時由呼叫端 invalidate */
export class RouteCache {
  private cache = new Map<string, Route>();
  constructor(private ctx: RouteContext) {}
  get(c: ConnectorObject): Route {
    let r = this.cache.get(c.id);
    if (!r) {
      r = computeRoute(c, this.ctx);
      this.cache.set(c.id, r);
    }
    return r;
  }
  peek(id: string): Route | undefined {
    return this.cache.get(id);
  }
  invalidate(id: string) {
    this.cache.delete(id);
  }
  clear() {
    this.cache.clear();
  }
}
