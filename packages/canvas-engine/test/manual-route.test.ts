import { describe, expect, it } from 'vitest';
import { localOrigin } from '@tinycanvas/shared';
import { connectorRegion } from '../src/connectors/ends';
import { alignSegment, moveShortEndJogs } from '../src/connectors/route';
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

// 頭尾段太短時箭頭方向錯誤（DECISIONS.md 2026-10-13）
describe('手動路線的頭尾段至少 ROUTE_MARGIN 長', () => {
  type P = { x: number; y: number };
  /** 頭尾段短於 6 px、且與相鄰線段垂直：箭頭會畫在極短的線段上，方向與看得到的線不一致 */
  const badEnds = (pts: P[]) => {
    const n = pts.length;
    const seg = (a: P, b: P) => ({ dx: b.x - a.x, dy: b.y - a.y, len: Math.hypot(b.x - a.x, b.y - a.y) });
    const bad = (s1: ReturnType<typeof seg>, s2: ReturnType<typeof seg>) => s1.len < 6 && s2.len >= 6 && Math.abs(s1.dx * s2.dx + s1.dy * s2.dy) < 1e-6;
    return n >= 3 && (bad(seg(pts[n - 2], pts[n - 1]), seg(pts[n - 3], pts[n - 2])) || bad(seg(pts[0], pts[1]), seg(pts[1], pts[2])));
  };
  const board = (to: Record<string, unknown>) =>
    makeModel([
      rect('b', 300, 100, { w: 12, h: 300 }),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: null, anchor: null, x: 600, y: 50 }, to } as any,
    ]);

  it('垂直線段拖到距離左緣端點 3 px：尾段推到 16 px，從左邊接進來', () => {
    const { model } = board({ objectId: 'b', anchor: 'left' });
    // 端點在 b 的左緣中點 (300, 250)，離開方向朝左
    model.setRoutePoints('c', [{ x: 600, y: 50 }, { x: 297, y: 50 }, { x: 297, y: 250 }, { x: 300, y: 250 }]);
    const pts = points(model as any);
    expect(pts.slice(-2)).toEqual([{ x: 284, y: 250 }, { x: 300, y: 250 }]);
    expect(model.routes.get(model.store.get('c') as any).endTangent).toEqual({ x: 1, y: 0 });
  });

  it('拖過端點到物件另一側時，同樣推回離開方向那一側', () => {
    const { model } = board({ objectId: 'b', anchor: 'left' });
    model.setRoutePoints('c', [{ x: 600, y: 50 }, { x: 303, y: 50 }, { x: 303, y: 250 }, { x: 300, y: 250 }]);
    expect(points(model as any).slice(-2)).toEqual([{ x: 284, y: 250 }, { x: 300, y: 250 }]);
  });

  it('懸空端點：太短時往原本那一側推到 16 px，剛好對齊（長度 0）時合併', () => {
    const { model } = makeModel([
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: null, anchor: null, x: 0, y: 0 }, to: { objectId: null, anchor: null, x: 300, y: 200 } } as any,
    ]);
    model.setRoutePoints('c', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 296, y: 100 }, { x: 296, y: 200 }, { x: 300, y: 200 }]);
    expect(points(model as any).slice(-2)).toEqual([{ x: 284, y: 200 }, { x: 300, y: 200 }]);
  });

  it('掃描：各種端點下，拖曳每一段中間線段到任何位置，頭尾段都不會短到讓箭頭方向錯誤', () => {
    for (const anchor of ['left', 'right', 'top', 'bottom', null, { u: 0, v: 0.3 }, { u: 0.5, v: 0 }]) {
      for (const free of [{ x: -200, y: 120 }, { x: 600, y: 50 }, { x: 100, y: -200 }, { x: 330, y: 500 }]) {
        const fe = { objectId: null, anchor: null, ...free };
        const { model } = makeModel([
          rect('b', 300, 100, { w: 12, h: 300 }),
          { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: fe, to: { objectId: 'b', anchor } } as any,
        ]);
        const base = points(model as any).map((p) => ({ ...p }));
        for (let index = 1; index < base.length - 2; index++) {
          const horizontal = Math.abs(base[index].y - base[index + 1].y) < 0.01;
          for (let v = -300; v <= 700; v += 1) {
            const pts = base.map((p) => ({ ...p }));
            for (const i of [index, index + 1]) pts[i] = horizontal ? { x: pts[i].x, y: v } : { x: v, y: pts[i].y };
            // 拖曳中（waypoints 為完整路線去頭尾）與放開後
            model.updateObject('c', { waypoints: pts.slice(1, -1) });
            expect(badEnds(points(model as any)), JSON.stringify({ anchor, free, index, v, live: true })).toBe(false);
            model.setRoutePoints('c', pts);
            expect(badEnds(points(model as any)), JSON.stringify({ anchor, free, index, v })).toBe(false);
            model.updateObject('c', { waypoints: [] });
          }
        }
      }
    }
  });

  it('只有一段中間線段、兩端要求衝突時：在中間轉折成 S 形，頭尾段都至少 16 px', () => {
    // a 的上緣中點 (50, 0) 往上離開；b 的下緣中點 (350, -20) 往下離開。中間線段在 y = -10：
    // a 需要 y ≤ -16，b 需要 y ≥ -4，沒有同時滿足的位置
    const { model } = makeModel([
      rect('a', 0, 0, { w: 100, h: 60 }),
      rect('b', 300, -80, { w: 100, h: 60, z: 'a1' }),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: 'a', anchor: 'top' }, to: { objectId: 'b', anchor: 'bottom' }, waypoints: [{ x: 50, y: -10 }, { x: 350, y: -10 }] } as any,
    ]);
    expect(points(model as any)).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: -16 },
      { x: 200, y: -16 },
      { x: 200, y: -4 },
      { x: 350, y: -4 },
      { x: 350, y: -20 },
    ]);
    const r = model.routes.get(model.store.get('c') as any);
    expect(r.endTangent).toEqual({ x: 0, y: -1 });
    expect(r.startTangent).toEqual({ x: 0, y: 1 });
  });

  it('只有一段中間線段、兩端可以同時滿足時：移到同時滿足的位置，不轉折', () => {
    // a 往上（需要 y ≤ -16），b 的下緣在 y = -100 往下（需要 y ≥ -84）；y = -10 只違反 a → 移到 -16
    const { model } = makeModel([
      rect('a', 0, 0, { w: 100, h: 60 }),
      rect('b', 300, -160, { w: 100, h: 60, z: 'a1' }),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: 'a', anchor: 'top' }, to: { objectId: 'b', anchor: 'bottom' }, waypoints: [{ x: 50, y: -10 }, { x: 350, y: -10 }] } as any,
    ]);
    expect(points(model as any)).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: -16 },
      { x: 350, y: -16 },
      { x: 350, y: -100 },
    ]);
  });

  it('隨機掃描：任意手動路線與連接點（含角落與自動選邊），頭尾段都不短於箭頭', () => {
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const anchors: unknown[] = ['left', 'right', 'top', 'bottom', null, { u: 1, v: 0.9 }, { u: 0.95, v: 1 }, { u: 1, v: 1 }, { u: 0, v: 0 }, { u: 1, v: 0.05 }];
    const pick = () => anchors[Math.floor(rnd() * anchors.length)];
    // 頭尾段短於 15 px（線寬 3 時的箭頭長度）且與相鄰線段垂直
    const tooShort = (pts: P[]) => {
      const n = pts.length;
      if (n < 3) return false;
      const seg = (a: P, b: P) => ({ dx: b.x - a.x, dy: b.y - a.y, len: Math.hypot(b.x - a.x, b.y - a.y) });
      const bad = (s1: ReturnType<typeof seg>, s2: ReturnType<typeof seg>) => s1.len < 15 && s2.len >= 6 && Math.abs(s1.dx * s2.dx + s1.dy * s2.dy) < 1e-6;
      return bad(seg(pts[n - 2], pts[n - 1]), seg(pts[n - 3], pts[n - 2])) || bad(seg(pts[0], pts[1]), seg(pts[1], pts[2]));
    };
    for (let iter = 0; iter < 5000; iter++) {
      const wp: P[] = [];
      let cur = { x: -50 + rnd() * 500, y: -150 + rnd() * 350 };
      let horiz = rnd() < 0.5;
      wp.push(cur);
      for (let i = 1, k = 2 + Math.floor(rnd() * 3); i < k; i++) {
        cur = horiz ? { x: -50 + rnd() * 500, y: cur.y } : { x: cur.x, y: -150 + rnd() * 350 };
        wp.push(cur);
        horiz = !horiz;
      }
      const toA = pick();
      const fromA = pick();
      const bx = 150 + rnd() * 300;
      const by = -150 + rnd() * 300;
      const { model } = makeModel([
        rect('a', 0, 0, { w: 100, h: 60 }),
        { type: 'shape', id: 'b', shapeKind: 'ellipse', x: bx, y: by, w: 60, h: 60, z: 'a1' } as any,
        { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: 'b', anchor: fromA }, to: { objectId: 'a', anchor: toA }, waypoints: wp } as any,
      ]);
      expect(tooShort(points(model as any)), JSON.stringify({ iter, toA, fromA, bx, by, wp })).toBe(false);
    }
  });

  it('掃描：已有手動路線時移動端點所在的形狀，頭尾段同樣不會太短', () => {
    for (const anchor of ['left', 'top', 'right', 'bottom', null, { u: 0, v: 0.4 }]) {
      const { model } = makeModel([
        rect('b', 300, 100, { w: 60, h: 100 }),
        { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: null, anchor: null, x: -200, y: 0 }, to: { objectId: 'b', anchor }, waypoints: [{ x: 100, y: 0 }, { x: 100, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 60 }] } as any,
      ]);
      for (let dx = -300; dx <= 300; dx += 1) {
        for (const dy of [-120, -60, -10, -3, 0, 3, 10, 60]) {
          model.updateObject('b', { x: 300 + dx, y: 100 + dy });
          expect(badEnds(points(model as any)), JSON.stringify({ anchor, dx, dy })).toBe(false);
        }
      }
    }
  });
});

// 兩個物件幾乎等高時，自動路由在端點前留下極短的垂直段，箭頭轉 90 度（DECISIONS.md 2026-10-14）
describe('自動路由的頭尾小轉折移到內側（moveShortEndJogs）', () => {
  type P = { x: number; y: number };
  const end = (p: P, dir: P | null) => ({ p, dir, obj: null }) as any;

  it('只有一個轉角：改在整段的中點轉折', () => {
    const pts = moveShortEndJogs([{ x: 160, y: 30 }, { x: 120, y: 30 }, { x: 120, y: 30.3 }], end({ x: 160, y: 30 }, { x: -1, y: 0 }), end({ x: 120, y: 30.3 }, { x: 1, y: 0 }));
    expect(pts).toEqual([
      { x: 160, y: 30 },
      { x: 140, y: 30 },
      { x: 140, y: 30.3 },
      { x: 120, y: 30.3 },
    ]);
  });

  it('前面還有轉折點：平移前一段線對齊端點，最後一段直接水平接進去', () => {
    const pts = moveShortEndJogs(
      [{ x: 300, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 30 }, { x: 120, y: 30 }, { x: 120, y: 34 }],
      end({ x: 300, y: 100 }, { x: -1, y: 0 }),
      end({ x: 120, y: 34 }, { x: 1, y: 0 }),
    );
    expect(pts).toEqual([
      { x: 300, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 34 },
      { x: 120, y: 34 },
    ]);
  });

  it('最後一段與端點離開方向平行（刻意的離開短線）時不處理', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }];
    expect(moveShortEndJogs(pts, end({ x: 0, y: 0 }, null), end({ x: 100, y: 10 }, { x: 0, y: -1 }))).toEqual(pts);
  });

  it('水平置中的矩形與圓形：接在矩形右邊、與圓形差 0.3 px 時，箭頭仍朝左', () => {
    const { model } = makeModel([
      rect('a', 0, 0, { w: 120, h: 60 }),
      { type: 'shape', id: 'b', shapeKind: 'ellipse', x: 200, y: 0, w: 60, h: 60, z: 'a1' } as any,
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: 'b', anchor: 'left' }, to: { objectId: 'a', anchor: { u: 1, v: 0.505 } } } as any,
    ]);
    const r = model.routes.get(model.store.get('c') as any);
    expect(r.endTangent).toEqual({ x: -1, y: 0 });
    const n = r.points.length;
    expect(r.points[n - 1].x - r.points[n - 2].x).toBeLessThanOrEqual(-16);
  });

  it('掃描：水平置中時，連接點在矩形右邊任何位置，頭尾段都不會短於箭頭', () => {
    type Pt = { x: number; y: number };
    const tooShort = (pts: Pt[]) => {
      const n = pts.length;
      if (n < 3) return false;
      const seg = (a: Pt, b: Pt) => ({ dx: b.x - a.x, dy: b.y - a.y, len: Math.hypot(b.x - a.x, b.y - a.y) });
      const bad = (s1: ReturnType<typeof seg>, s2: ReturnType<typeof seg>) => s1.len < 15 && s2.len >= 3 && Math.abs(s1.dx * s2.dx + s1.dy * s2.dy) < 1e-6;
      return bad(seg(pts[n - 2], pts[n - 1]), seg(pts[n - 3], pts[n - 2])) || bad(seg(pts[1], pts[0]), seg(pts[2], pts[1]));
    };
    for (const h of [60, 160]) {
      for (const gap of [40, 160]) {
        for (const rev of [false, true]) {
          for (let v = 0; v <= 1.0001; v += 0.005) {
            for (const cA of [null, 'left', { u: 0, v: 0.47 }]) {
              const rectEnd = { objectId: 'a', anchor: { u: 1, v: +v.toFixed(3) } };
              const circEnd = { objectId: 'b', anchor: cA };
              const { model } = makeModel([
                rect('a', 0, 0, { w: 120, h }),
                { type: 'shape', id: 'b', shapeKind: 'ellipse', x: 120 + gap, y: h / 2 - 30, w: 60, h: 60, z: 'a1' } as any,
                { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: rev ? rectEnd : circEnd, to: rev ? circEnd : rectEnd } as any,
              ]);
              expect(tooShort(points(model as any)), JSON.stringify({ h, gap, rev, v, cA })).toBe(false);
            }
          }
        }
      }
    }
  });
});
