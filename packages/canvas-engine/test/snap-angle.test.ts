import { describe, expect, it } from 'vitest';
import { snapAngle } from '../src/geometry';

const o = { x: 10, y: 20 };

describe('Shift 限制連線角度（snapAngle）', () => {
  it('接近水平、垂直時吸到 0 與 90 度，保留投影長度', () => {
    expect(snapAngle(o, { x: 110, y: 28 })).toEqual({ x: 110, y: 20 });
    expect(snapAngle(o, { x: 4, y: -80 })).toEqual({ x: 10, y: -80 });
    expect(snapAngle(o, { x: -90, y: 15 })).toEqual({ x: -90, y: 20 });
  });

  it('接近對角線時吸到 45 度倍數，兩軸位移相等', () => {
    const p = snapAngle(o, { x: 110, y: 130 });
    expect(p.x - o.x).toBeCloseTo(105);
    expect(p.y - o.y).toBeCloseTo(105);
    const q = snapAngle(o, { x: -60, y: -50 });
    expect(q.x - o.x).toBeCloseTo(q.y - o.y);
    expect(q.x).toBeLessThan(o.x);
  });

  it('與起點重合時不變', () => {
    expect(snapAngle(o, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });
});
