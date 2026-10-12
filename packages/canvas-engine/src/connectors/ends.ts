import type { Anchor, AnchorSide, BoardObject, ConnectorEnd, ConnectorObject, Point } from '@tinycanvas/shared';
import { rectCenter, rotatePoint, rotatedAabb, type Rect } from '../geometry';
import { nearestOnOutline, sideOnOutline } from './outline';

export interface ResolvedEnd {
  p: Point;
  /** 離開物件的方向（單位向量）；懸空端點為 null */
  dir: Point | null;
  obj: BoardObject | null;
  side: AnchorSide | null;
}

export const SIDE_DIR: Record<AnchorSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export const OPPOSITE: Record<AnchorSide, AnchorSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** 物件可以被連線連接嗎？群組與連線本身不行 */
export function isConnectable(o: BoardObject | null | undefined): o is BoardObject {
  return !!o && o.type !== 'connector' && o.type !== 'group';
}

/** 外框上的點屬於哪一邊：以外接框中心為準、依長寬正規化後比較 */
function sideOfUV(u: number, v: number): AnchorSide {
  const dx = u - 0.5;
  const dy = v - 0.5;
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function rotateDir(d: Point, deg: number): Point {
  if (!deg) return d;
  return rotatePoint(d, { x: 0, y: 0 }, deg);
}

/**
 * 物件上的連接點（含旋轉）。四邊（top / right / bottom / left）取外框在該方向上的點；
 * `{ u, v }` 投影到實際外框上最近的點（建立時已在外框上，縮放後仍會貼齊）。
 */
export function anchorPoint(o: BoardObject, anchor: Anchor): { p: Point; dir: Point; side: AnchorSide } {
  let local: Point;
  let side: AnchorSide;
  if (typeof anchor === 'string') {
    local = sideOnOutline(o, anchor);
    side = anchor;
  } else {
    local = nearestOnOutline(o, { x: anchor.u * o.w, y: anchor.v * o.h }).p;
    side = sideOfUV(local.x / Math.max(o.w, 1), local.y / Math.max(o.h, 1));
  }
  const c = rectCenter(o);
  return { p: rotatePoint({ x: o.x + local.x, y: o.y + local.y }, c, o.rotation), dir: rotateDir(SIDE_DIR[side], o.rotation), side };
}

/** 把畫布座標轉成物件本地（未旋轉、原點為左上角）座標 */
export function toObjectLocal(o: BoardObject, world: Point): Point {
  const p = o.rotation ? rotatePoint(world, rectCenter(o), -o.rotation) : world;
  return { x: p.x - o.x, y: p.y - o.y };
}

/** anchor 為 null（自動）時，依兩端相對位置選擇面對另一端的邊 */
export function autoSide(o: BoardObject, toward: Point): AnchorSide {
  const c = rectCenter(o);
  // 轉到物件的未旋轉座標再判斷
  const t = o.rotation ? rotatePoint(toward, c, -o.rotation) : toward;
  const dx = (t.x - c.x) / Math.max(o.w, 1);
  const dy = (t.y - c.y) / Math.max(o.h, 1);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function endTargetPoint(end: ConnectorEnd, get: (id: string) => BoardObject | undefined): Point {
  const o = end.objectId ? get(end.objectId) : undefined;
  if (isConnectable(o)) {
    if (end.anchor) return anchorPoint(o, end.anchor).p;
    return rectCenter(o);
  }
  return { x: end.x ?? 0, y: end.y ?? 0 };
}

/** 連線有手動路線（正交且至少兩個轉折點，見 DECISIONS.md） */
export function hasManualRoute(c: ConnectorObject): boolean {
  return c.routing === 'orthogonal' && (c.waypoints?.length ?? 0) >= 2;
}

/** toward：自動選邊時要面對的點；省略時面對另一端 */
export function resolveEnd(end: ConnectorEnd, other: ConnectorEnd, get: (id: string) => BoardObject | undefined, toward?: Point): ResolvedEnd {
  const o = end.objectId ? get(end.objectId) : undefined;
  if (isConnectable(o)) {
    if (end.anchor) {
      const a = anchorPoint(o, end.anchor);
      return { p: a.p, dir: a.dir, obj: o, side: a.side };
    }
    toward ??= endTargetPoint(other, get);
    const side = autoSide(o, toward);
    const a = anchorPoint(o, side);
    return { p: a.p, dir: a.dir, obj: o, side };
  }
  return { p: { x: end.x ?? 0, y: end.y ?? 0 }, dir: null, obj: null, side: null };
}

export function resolveEnds(c: ConnectorObject, get: (id: string) => BoardObject | undefined): [ResolvedEnd, ResolvedEnd] {
  // 手動路線：自動選邊時面對最近的轉折點
  const w = hasManualRoute(c) ? c.waypoints : null;
  return [resolveEnd(c.from, c.to, get, w?.[0]), resolveEnd(c.to, c.from, get, w?.[w.length - 1])];
}

/** 正交路由可能繞行的最大距離；路由結果保證落在 connectorRegion() 內 */
export const ROUTE_DETOUR = 160;

/**
 * 連線可能佔用的範圍：兩端點、兩端物件與繞行空間。只依賴端點，因此可以在路由計算之前放進空間索引，
 * 路由（含曲線控制點與標籤）一律限制在這個範圍內。
 */
export function connectorRegion(c: ConnectorObject, get: (id: string) => BoardObject | undefined): Rect {
  const [a, b] = resolveEnds(c, get);
  let minX = Math.min(a.p.x, b.p.x);
  let minY = Math.min(a.p.y, b.p.y);
  let maxX = Math.max(a.p.x, b.p.x);
  let maxY = Math.max(a.p.y, b.p.y);
  if (hasManualRoute(c)) {
    for (const w of c.waypoints) {
      minX = Math.min(minX, w.x);
      minY = Math.min(minY, w.y);
      maxX = Math.max(maxX, w.x);
      maxY = Math.max(maxY, w.y);
    }
  }
  for (const e of [a, b]) {
    if (e.obj) {
      const r = rotatedAabb(e.obj);
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
  }
  let pad = c.routing === 'straight' ? 24 : ROUTE_DETOUR;
  if (c.label) pad = Math.max(pad, estimateLabelWidth(c.label) / 2 + 16);
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

/** 標籤寬度的保守估計（不需量測）：CJK 以全形計，其餘以 0.62em 計，取最長的一行 */
export function estimateLabelWidth(label: string, fontSize = 13): number {
  let best = 0;
  for (const line of label.split('\n')) {
    let w = 0;
    for (const ch of line) w += ch.charCodeAt(0) > 0x2e7f ? fontSize : fontSize * 0.62;
    best = Math.max(best, w);
  }
  return Math.min(best, 240) + 12;
}
