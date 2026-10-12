import { describe, expect, it } from 'vitest';
import type { BoardObject, ConnectorObject, Point } from '@tinycanvas/shared';
import { anchorPoint } from '../src/connectors/ends';
import { insideOutline, nearestOnOutline, sideOnOutline } from '../src/connectors/outline';
import { makeModel, rect } from './helpers';

const shape = (shapeKind: string, extra: Partial<BoardObject> = {}) =>
  ({ id: 's', type: 'shape', x: 100, y: 50, w: 200, h: 100, rotation: 0, shapeKind, ...extra }) as unknown as BoardObject;

const close = (p: Point, q: Point, eps = 0.5) => {
  expect(Math.abs(p.x - q.x)).toBeLessThan(eps);
  expect(Math.abs(p.y - q.y)).toBeLessThan(eps);
};

describe('外框任意連接點（{ u, v }）', () => {
  it('矩形：任意點保持在邊上，離開方向為所在的邊', () => {
    const o = shape('rectangle');
    const a = anchorPoint(o, { u: 0.8, v: 0 });
    close(a.p, { x: 260, y: 50 });
    expect(a.side).toBe('top');
    expect(a.dir).toEqual({ x: 0, y: -1 });
    const b = anchorPoint(o, { u: 1, v: 0.25 });
    close(b.p, { x: 300, y: 75 });
    expect(b.side).toBe('right');
  });

  it('橢圓：連接點投影到實際輪廓上，而不是外接框', () => {
    const o = shape('ellipse');
    // 外接框右上角附近的點會投影到橢圓上
    const a = anchorPoint(o, { u: 0.95, v: 0.05 });
    const cx = 200;
    const cy = 100;
    const nx = (a.p.x - cx) / 100;
    const ny = (a.p.y - cy) / 50;
    expect(nx * nx + ny * ny).toBeCloseTo(1, 1);
    expect(a.p.x).toBeLessThan(300);
    expect(a.p.y).toBeGreaterThan(50);
  });

  it('菱形：斜邊上的點落在邊上，依位置決定離開方向', () => {
    const o = shape('diamond');
    // 右上斜邊：(200,50) → (300,100)，取中間偏右的點
    const a = anchorPoint(o, { u: 0.8, v: 0.2 });
    // 投影後滿足斜邊方程式 y - 50 = (x - 200) / 2
    expect(a.p.y - 50).toBeCloseTo((a.p.x - 200) / 2, 0);
    expect(a.side).toBe('right');
  });

  it('物件縮放後，任意連接點跟著等比移動', () => {
    const o = shape('rectangle');
    const before = anchorPoint(o, { u: 0.25, v: 1 });
    close(before.p, { x: 150, y: 150 });
    const after = anchorPoint({ ...o, w: 400 } as BoardObject, { u: 0.25, v: 1 });
    close(after.p, { x: 200, y: 150 });
  });

  it('旋轉的物件：連接點與方向一起旋轉', () => {
    const o = shape('rectangle', { rotation: 90 });
    const a = anchorPoint(o, { u: 1, v: 0.5 });
    // 繞中心 (200,100) 順時針轉 90 度：右邊中點 (300,100) → (200,200)
    close(a.p, { x: 200, y: 200 });
    expect(a.dir.x).toBeCloseTo(0);
    expect(a.dir.y).toBeCloseTo(1);
  });
});

describe('四邊連接點貼齊實際外框', () => {
  it('矩形、橢圓、菱形為外接框各邊中點', () => {
    for (const k of ['rectangle', 'ellipse', 'diamond']) {
      const o = shape(k);
      close(anchorPoint(o, 'top').p, { x: 200, y: 50 });
      close(anchorPoint(o, 'right').p, { x: 300, y: 100 });
      close(anchorPoint(o, 'bottom').p, { x: 200, y: 150 });
      close(anchorPoint(o, 'left').p, { x: 100, y: 100 });
    }
  });

  it('三角形的左右連接點落在斜邊上，不懸空', () => {
    const o = shape('triangle');
    // 頂點 (200,50)、底邊 y=150：中線 y=100 與左斜邊交於 x=150
    close(anchorPoint(o, 'left').p, { x: 150, y: 100 });
    close(anchorPoint(o, 'right').p, { x: 250, y: 100 });
    close(anchorPoint(o, 'top').p, { x: 200, y: 50 });
  });

  it('sideOnOutline 與 nearestOnOutline 使用物件本地座標', () => {
    const o = shape('triangle');
    close(sideOnOutline(o, 'left'), { x: 50, y: 50 });
    const n = nearestOnOutline(o, { x: 100, y: 120 });
    expect(n.p.y).toBeCloseTo(100);
    expect(n.d).toBeCloseTo(20);
  });

  it('insideOutline 依實際輪廓判斷', () => {
    const o = shape('diamond');
    expect(insideOutline(o, { x: 100, y: 50 })).toBe(true);
    // 外接框角落不在菱形內
    expect(insideOutline(o, { x: 5, y: 5 })).toBe(false);
  });
});

describe('任意連接點的路由', () => {
  it('正交路由從橢圓上的點先沿離開方向走出外接框，不穿過來源形狀', () => {
    const { model } = makeModel([
      rect('a', 0, 0, { shapeKind: 'ellipse', w: 200, h: 100 }),
      rect('b', 500, 300),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: 'a', anchor: { u: 0.9, v: 0.2 } }, to: { objectId: 'b', anchor: 'top' } },
    ]);
    const c = model.store.get('c') as ConnectorObject;
    const pts = model.routes.get(c).points;
    const start = anchorPoint(model.store.get('a')!, { u: 0.9, v: 0.2 });
    close(pts[0], start.p);
    expect(start.side).toBe('right');
    // 第一段水平向右，延伸到外接框之外
    expect(pts[1].y).toBeCloseTo(pts[0].y);
    expect(pts[1].x).toBeGreaterThan(200);
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i].x - pts[i - 1].x) < 0.01 || Math.abs(pts[i].y - pts[i - 1].y) < 0.01).toBe(true);
    }
  });

  it('快速選單建立的形狀：連線起點保留拖出時的任意連接點', () => {
    const { model } = makeModel([rect('a', 0, 0)]);
    const id = model.createConnectedShape('a', 'right', 'rectangle', { x: 300, y: 10 }, { u: 1, v: 0.2 })!;
    const conn = [...model.store.objects.values()].find((o) => o.type === 'connector') as ConnectorObject;
    expect(conn.from).toMatchObject({ objectId: 'a', anchor: { u: 1, v: 0.2 } });
    expect(conn.to).toMatchObject({ objectId: id, anchor: 'left' });
  });
});
