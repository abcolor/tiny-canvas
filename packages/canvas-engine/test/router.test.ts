import { describe, expect, it } from 'vitest';
import type { Point } from '@tinycanvas/shared';
import { elbowPath, orthogonalPath, computeRoute, narrowGaps } from '../src/connectors/route';
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

  // 自由文字不算障礙物（DECISIONS.md 2026-10-14）
  it('自由文字不算障礙物：擋在中間或貼近線段時，路線不變', () => {
    const conn = { type: 'connector' as const, id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal' as const, from: { objectId: 'a', anchor: 'right' as const }, to: { objectId: 'b', anchor: 'left' as const } };
    const plain = makeModel([rect('a', 0, 0), rect('b', 400, 0), conn]).model;
    const expected = plain.routes.get(plain.store.get('c') as any).points;
    expect(expected).toEqual([{ x: 100, y: 30 }, { x: 400, y: 30 }]);
    for (const t of [
      { x: 180, y: -40, w: 60, h: 140 }, // 擋在中間
      { x: 150, y: 38, w: 120, h: 40 }, // 在線段下方 8 px
    ]) {
      const { model } = makeModel([rect('a', 0, 0), rect('b', 400, 0), { type: 'text', id: 't', ...t, text: '說明' } as any, conn]);
      expect(model.routes.get(model.store.get('c') as any).points).toEqual(expected);
    }
  });

  it('形狀仍是障礙物；端點接在文字上時，線從文字邊上離開、不穿過文字', () => {
    const { model } = makeModel([
      { type: 'text', id: 't', x: 0, y: 0, w: 100, h: 40, text: '起點' } as any,
      rect('wall', 180, -40, { w: 60, h: 140 }),
      rect('b', 400, 0),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: 't', anchor: 'right' }, to: { objectId: 'b', anchor: 'left' } },
    ]);
    const pts = model.routes.get(model.store.get('c') as any).points;
    expect(crossesInterior(pts, { x: 180, y: -40, w: 60, h: 140 })).toBe(false);
    expect(crossesInterior(pts, { x: 0, y: 0, w: 100, h: 40 })).toBe(false);
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

describe('窄間隙（參考 Whimsical）', () => {
  const conn = (from: string, fa: string, to: string, ta: string) =>
    ({ type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: from, anchor: fa }, to: { objectId: to, anchor: ta } }) as any;

  it('上下靠很近的兩個形狀，右邊接到下方左邊：線從下方繞，不穿過間隙，也不穿過形狀', () => {
    for (const gap of [8, 26, 40, 60]) {
      const top = { x: 0, y: 0, w: 160, h: 80 };
      const bottom = { x: 0, y: 80 + gap, w: 160, h: 80 };
      const { model } = makeModel([rect('a', 0, 0, { w: 160, h: 80 }), rect('b', 0, 80 + gap, { w: 160, h: 80 }), conn('a', 'right', 'b', 'left')]);
      const pts = model.routes.get(model.store.get('c') as any).points;
      expect(isOrthogonal(pts)).toBe(true);
      expect(crossesInterior(pts, top)).toBe(false);
      expect(crossesInterior(pts, bottom)).toBe(false);
      // 沒有任何一段落在間隙裡
      for (const p of pts) expect(p.y > 80 && p.y < 80 + gap).toBe(false);
      // 從下方繞，且緊貼形狀轉彎，不繞到很遠
      expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(bottom.y + bottom.h);
      expect(Math.min(...pts.map((p) => p.x))).toBeGreaterThanOrEqual(-48);
    }
  });

  it('端點離開方向朝向間隙時不封住（樹狀排版的父節點往下接子節點）', () => {
    const { model } = makeModel([
      rect('p', 100, 0, { w: 160, h: 80 }),
      rect('c1', 0, 128, { w: 160, h: 80 }),
      rect('c2', 200, 128, { w: 160, h: 80 }),
      conn('p', 'bottom', 'c1', 'top'),
    ]);
    const pts = model.routes.get(model.store.get('c') as any).points;
    expect(pts.length).toBe(4);
    expect(Math.max(...pts.map((p) => p.y))).toBeLessThanOrEqual(128);
  });

  it('narrowGaps：只封住端點物件旁、小於 NARROW_GAP 的間隙', () => {
    const a = { id: 'a', type: 'shape', x: 0, y: 0, w: 100, h: 50, rotation: 0 } as any;
    const near = { x: 0, y: 70, w: 100, h: 50 };
    const far = { x: 0, y: -200, w: 100, h: 50 };
    const end = { p: { x: 100, y: 25 }, dir: { x: 1, y: 0 }, obj: a } as any;
    expect(narrowGaps([{ x: 0, y: 0, w: 100, h: 50 }, near, far], [end])).toEqual([{ x: 0, y: 50, w: 100, h: 20 }]);
    // 離開方向朝下（朝向間隙）時不封住
    expect(narrowGaps([near], [{ ...end, dir: { x: 0, y: 1 } }])).toEqual([]);
  });
});
