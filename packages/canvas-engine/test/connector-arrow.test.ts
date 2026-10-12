import { describe, expect, it } from 'vitest';
import { arrowInset, insetRoute } from '../src/render/draw';
import type { Route } from '../src/connectors/route';

const route = (points: { x: number; y: number }[], startTangent: { x: number; y: number }, endTangent: { x: number; y: number }): Route => ({
  points,
  curved: false,
  startTangent,
  endTangent,
  mid: points[0],
  bounds: { x: 0, y: 0, w: 0, h: 0 },
});

describe('連線線身在箭頭處內縮', () => {
  it('實心箭頭內縮，開放箭頭與無箭頭不內縮', () => {
    expect(arrowInset('triangle', 15)).toBeCloseTo(9);
    expect(arrowInset('diamond', 15)).toBeCloseTo(7.5);
    expect(arrowInset('circle', 15)).toBeCloseTo(6);
    expect(arrowInset('arrow', 15)).toBe(0);
    expect(arrowInset('none', 15)).toBe(0);
  });

  it('終點沿切線往回縮，箭頭仍畫在原本的尖端', () => {
    // 往右再往下的折線；終點切線朝下，起點切線朝左
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], { x: -1, y: 0 }, { x: 0, y: 1 });
    const body = insetRoute(r, 0, 9);
    expect(body.points[2]).toEqual({ x: 100, y: 91 });
    expect(body.points[0]).toEqual({ x: 0, y: 0 });
    expect(r.points[2]).toEqual({ x: 100, y: 100 });
  });

  it('兩端都縮，且不超過該段長度的一半', () => {
    const r = route([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: -1, y: 0 }, { x: 1, y: 0 });
    const body = insetRoute(r, 9, 9);
    expect(body.points[0].x).toBeCloseTo(5);
    expect(body.points[1].x).toBeCloseTo(5);
  });

  it('不需內縮時回傳原路徑', () => {
    const r = route([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: -1, y: 0 }, { x: 1, y: 0 });
    expect(insetRoute(r, 0, 0)).toBe(r);
  });
});
