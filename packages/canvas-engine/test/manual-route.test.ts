import { describe, expect, it } from 'vitest';
import { localOrigin } from '@tinycanvas/shared';
import { connectorRegion } from '../src/connectors/ends';
import { alignSegment } from '../src/connectors/route';
import { countTransactions, makeModel, raw, rect } from './helpers';

// 折線中間線段拖曳後的手動路線（DECISIONS.md 2026-10-12）
const conn = (extra: Record<string, unknown> = {}) => ({
  type: 'connector' as const,
  id: 'c',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  routing: 'orthogonal' as const,
  from: { objectId: 'a', anchor: 'top' as const },
  to: { objectId: 'b', anchor: 'top' as const },
  ...extra,
});
// a 的上緣中點 (50, 300)，b 的上緣中點 (350, 300)
const setup = (extra: Record<string, unknown> = {}) => makeModel([rect('a', 0, 300), rect('b', 300, 300, { z: 'a1' }), conn(extra)]);
const points = (model: ReturnType<typeof setup>['model']) => model.routes.get(model.store.get('c') as any).points;

describe('手動路線', () => {
  it('setRoutePoints 記下中間轉折點，路線照著走', () => {
    const { model, doc } = setup();
    model.setRoutePoints('c', [{ x: 50, y: 300 }, { x: 50, y: 100 }, { x: 350, y: 100 }, { x: 350, y: 300 }]);
    expect((raw(doc, 'c') as any).waypoints).toEqual([{ x: 50, y: 100 }, { x: 350, y: 100 }]);
    expect(points(model)).toEqual([{ x: 50, y: 300 }, { x: 50, y: 100 }, { x: 350, y: 100 }, { x: 350, y: 300 }]);
  });

  it('移除重複與共線的點；沒有中間線段時改回自動路由', () => {
    const { model, doc } = setup();
    model.setRoutePoints('c', [{ x: 50, y: 300 }, { x: 50, y: 200 }, { x: 50, y: 100 }, { x: 350, y: 100 }, { x: 350, y: 100 }, { x: 350, y: 300 }]);
    expect((raw(doc, 'c') as any).waypoints).toEqual([{ x: 50, y: 100 }, { x: 350, y: 100 }]);
    model.setRoutePoints('c', [{ x: 50, y: 300 }, { x: 50, y: 100 }, { x: 350, y: 100 }]);
    expect((raw(doc, 'c') as any).waypoints).toEqual([]);
  });

  it('只移動一端的形狀：中間線段不動，頭尾段跟著端點', () => {
    const { model } = setup({ waypoints: [{ x: 50, y: 100 }, { x: 350, y: 100 }] });
    model.moveUnits(['a'], 40, 0);
    expect(points(model)).toEqual([{ x: 90, y: 300 }, { x: 90, y: 100 }, { x: 350, y: 100 }, { x: 350, y: 300 }]);
  });

  it('兩端一起移動：轉折點一起平移，同一個 transaction', () => {
    const { model, doc } = setup({ waypoints: [{ x: 50, y: 100 }, { x: 350, y: 100 }] });
    const tx = countTransactions(doc);
    model.moveUnits(['a', 'b'], 20, 200);
    tx.stop();
    expect(tx.list).toEqual([localOrigin]);
    expect((raw(doc, 'c') as any).waypoints).toEqual([{ x: 70, y: 300 }, { x: 370, y: 300 }]);
  });

  it('端點離開的方向與頭段不符時補一段短線', () => {
    // 起點改接 a 的右邊 (100, 330)，但第一段是垂直的
    const { model } = setup({ from: { objectId: 'a', anchor: 'right' }, waypoints: [{ x: 50, y: 100 }, { x: 350, y: 100 }] });
    const pts = points(model);
    expect(pts[0]).toEqual({ x: 100, y: 330 });
    expect(pts[1]).toEqual({ x: 116, y: 330 });
    expect(pts[2]).toEqual({ x: 116, y: 100 });
  });

  it('連線範圍包含轉折點（空間索引）', () => {
    const { model } = setup({ waypoints: [{ x: 50, y: -500 }, { x: 350, y: -500 }] });
    const r = connectorRegion(model.store.get('c') as any, model.store.getter);
    expect(r.y).toBeLessThanOrEqual(-500);
  });

  it('複製貼上時轉折點跟著平移', () => {
    const { model } = setup({ waypoints: [{ x: 50, y: 100 }, { x: 350, y: 100 }] });
    const data = model.serialize(['a', 'b', 'c'])!;
    const tops = model.paste(data, { delta: { x: 1000, y: 0 } });
    const copy = tops.map((id) => model.store.get(id)!).find((o) => o.type === 'connector') as any;
    expect(copy.waypoints).toEqual([{ x: 1050, y: 100 }, { x: 1350, y: 100 }]);
  });

  it('非正交線型忽略轉折點', () => {
    const { model } = setup({ routing: 'straight', waypoints: [{ x: 50, y: 100 }, { x: 350, y: 100 }] });
    expect(points(model)).toEqual([{ x: 50, y: 300 }, { x: 350, y: 300 }]);
  });
});

describe('拖曳線段對齊相鄰的平行線段後合併', () => {
  // ㄱ 形繞一個小彎：右 → 上 → 右 → 下（四段）
  const route = [{ x: 100, y: 30 }, { x: 250, y: 30 }, { x: 250, y: -40 }, { x: 350, y: -40 }, { x: 350, y: 200 }];

  it('alignSegment：接近前後平行線段時對齊，不對齊兩端點', () => {
    // 第 2 段（水平，y = -40）拖到 y = 26：對齊第 0 段的 y = 30
    expect(alignSegment(route, 2, true, 26, 8)).toBe(30);
    expect(alignSegment(route, 2, true, 10, 8)).toBeNull();
    // 第 1 段（垂直，x = 250）拖到 x = 345：對齊第 3 段的 x = 350
    expect(alignSegment(route, 1, false, 345, 8)).toBe(350);
    // 第 1 段的前一個點是起點，不列入對齊
    expect(alignSegment(route, 1, false, 102, 8)).toBeNull();
  });

  it('對齊後放開：四段合併成兩段，路線改回自動且仍是同一個 L 形', () => {
    const { model, doc } = makeModel([
      rect('a', 0, 0),
      rect('b', 300, 200),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: 'a', anchor: 'right' }, to: { objectId: 'b', anchor: 'top' }, waypoints: route.slice(1, -1) },
    ]);
    const pos = alignSegment(route, 2, true, 26, 8)!;
    const pts = route.map((p, i) => (i === 2 || i === 3 ? { x: p.x, y: pos } : p));
    model.setRoutePoints('c', pts);
    expect((raw(doc, 'c') as any).waypoints).toEqual([]);
    expect(model.routes.get(model.store.get('c') as any).points).toEqual([{ x: 100, y: 30 }, { x: 350, y: 30 }, { x: 350, y: 200 }]);
  });
});
