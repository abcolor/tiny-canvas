import { describe, expect, it } from 'vitest';
import type { Point } from '@tinycanvas/shared';
import { elbowPath, orthogonalPath, computeRoute } from '../src/connectors/route';
import type { Rect } from '../src/geometry';
import { makeModel, rect } from './helpers';

function crossesInterior(pts: Point[], r: Rect): boolean {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    // 取樣檢查
    for (let t = 0; t <= 1; t += 0.02) {
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      if (x > r.x + 0.5 && x < r.x + r.w - 0.5 && y > r.y + 0.5 && y < r.y + r.h - 0.5) return true;
    }
  }
  return false;
}

function isOrthogonal(pts: Point[]) {
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i].x - pts[i - 1].x) > 0.01 && Math.abs(pts[i].y - pts[i - 1].y) > 0.01) return false;
  }
  return true;
}

describe('正交路由', () => {
  it('兩點之間有障礙物時繞過它', () => {
    const obstacle = { x: 150, y: -50, w: 100, h: 200 };
    const region = { x: -200, y: -300, w: 800, h: 700 };
    const pts = orthogonalPath({ x: 100, y: 50 }, { x: 1, y: 0 }, { x: 400, y: 50 }, { x: -1, y: 0 }, [obstacle], region)!;
    expect(pts).not.toBeNull();
    expect(isOrthogonal(pts)).toBe(true);
    expect(crossesInterior(pts, obstacle)).toBe(false);
    expect(pts[0]).toEqual({ x: 100, y: 50 });
    expect(pts[pts.length - 1]).toEqual({ x: 400, y: 50 });
  });

  it('沒有障礙物時是直線；起點方向向下、終點在右方時只有一個轉折', () => {
    const region = { x: -500, y: -500, w: 1500, h: 1500 };
    const straight = orthogonalPath({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 300, y: 0 }, { x: -1, y: 0 }, [], region)!;
    expect(straight).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
    ]);
    const l = orthogonalPath({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 300, y: 300 }, { x: -1, y: 0 }, [], region)!;
    expect(l.length).toBe(3);
    expect(l[1]).toEqual({ x: 0, y: 300 });
  });

  it('經過模型：形狀之間的障礙物被避開，起點不穿過來源形狀', () => {
    const { model } = makeModel([
      rect('a', 0, 0),
      rect('wall', 180, -40, { w: 60, h: 140 }),
      rect('b', 400, 0),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: 'a', anchor: 'right' }, to: { objectId: 'b', anchor: 'left' } },
    ]);
    const route = model.routes.get(model.store.get('c') as any);
    expect(isOrthogonal(route.points)).toBe(true);
    expect(crossesInterior(route.points, { x: 180, y: -40, w: 60, h: 140 })).toBe(false);
    expect(crossesInterior(route.points, { x: 0, y: 0, w: 100, h: 60 })).toBe(false);
    expect(crossesInterior(route.points, { x: 400, y: 0, w: 100, h: 60 })).toBe(false);
    // 路由落在空間索引的範圍內
    const b = model.store.boundsOf('c')!;
    for (const p of route.points) {
      expect(p.x).toBeGreaterThanOrEqual(b.x);
      expect(p.x).toBeLessThanOrEqual(b.x + b.w);
    }
  });

  it('障礙物移動後路由快取失效並重新計算', () => {
    const { model } = makeModel([
      rect('a', 0, 0),
      rect('b', 400, 0),
      rect('wall', 1000, 1000, { w: 60, h: 140 }),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'a', anchor: 'right' }, to: { objectId: 'b', anchor: 'left' } },
    ]);
    const r1 = model.routes.get(model.store.get('c') as any);
    expect(r1.points.length).toBe(2);
    model.moveUnits(['wall'], 180 - 1000, -40 - 1000);
    const r2 = model.routes.get(model.store.get('c') as any);
    expect(r2).not.toBe(r1);
    expect(crossesInterior(r2.points, { x: 180, y: -40, w: 60, h: 140 })).toBe(false);
  });

  it('曲線與直線', () => {
    const { model } = makeModel([
      rect('a', 0, 0),
      rect('b', 400, 200),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'curved', from: { objectId: 'a', anchor: 'right' }, to: { objectId: 'b', anchor: 'left' } },
      { type: 'connector', id: 's', x: 0, y: 0, w: 1, h: 1, routing: 'straight', from: { objectId: 'a', anchor: null }, to: { objectId: 'b', anchor: null } },
    ]);
    const c = computeRoute(model.store.get('c') as any, { get: model.store.getter, obstaclesIn: () => [] });
    expect(c.curved).toBe(true);
    expect(c.points.length).toBe(4);
    expect(c.points[0]).toEqual({ x: 100, y: 30 });
    expect(c.points[3]).toEqual({ x: 400, y: 230 });
    // 自動錨點：選擇面向對方的邊
    const s = computeRoute(model.store.get('s') as any, { get: model.store.getter, obstaclesIn: () => [] });
    expect(s.points).toEqual([
      { x: 100, y: 30 },
      { x: 400, y: 230 },
    ]);
  });

  it('找不到路徑時退回 Z 形路由', () => {
    const pts = elbowPath({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 200, y: 100 }, { x: -1, y: 0 });
    expect(isOrthogonal(pts)).toBe(true);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 100 });
  });
});
