import { describe, expect, it } from 'vitest';
import { alignGuides, nearestAlignLine } from '../src/geometry';

const ref = { x: 200, y: 100, w: 100, h: 60 };

describe('縮放時吸附附近物件（nearestAlignLine）', () => {
  it('吸到容差內最近的邊或中心', () => {
    expect(nearestAlignLine(197, [ref], 'x', 6)).toBe(200);
    expect(nearestAlignLine(253, [ref], 'x', 6)).toBe(250);
    expect(nearestAlignLine(304, [ref], 'x', 6)).toBe(300);
    expect(nearestAlignLine(158, [ref], 'y', 6)).toBe(160);
  });

  it('超出容差時回傳 null，交給格線吸附', () => {
    expect(nearestAlignLine(190, [ref], 'x', 6)).toBeNull();
    expect(nearestAlignLine(120, [ref], 'y', 6)).toBeNull();
  });

  it('多個參考物件時取最近的一條', () => {
    const other = { x: 205, y: 0, w: 10, h: 10 };
    expect(nearestAlignLine(204, [ref, other], 'x', 6)).toBe(205);
    expect(nearestAlignLine(201, [ref, other], 'x', 6)).toBe(200);
  });
});

describe('縮放後的參考線（alignGuides）', () => {
  it('右邊對齊參考物件的左邊時，畫一條涵蓋兩者的垂直線', () => {
    const r = { x: 0, y: 300, w: 200, h: 50 };
    expect(alignGuides(r, { xs: [200], ys: [] }, [ref])).toEqual([{ axis: 'x', pos: 200, from: 100, to: 350 }]);
  });

  it('下邊對齊參考物件的中心時，畫一條水平線', () => {
    const r = { x: 0, y: 0, w: 50, h: 130 };
    expect(alignGuides(r, { xs: [], ys: [130] }, [ref])).toEqual([{ axis: 'y', pos: 130, from: 0, to: 300 }]);
  });

  it('同一條線對齊多個物件時，線延伸到所有物件', () => {
    const other = { x: 150, y: 500, w: 50, h: 50 };
    const r = { x: 0, y: 300, w: 200, h: 50 };
    expect(alignGuides(r, { xs: [200], ys: [] }, [ref, other])).toEqual([{ axis: 'x', pos: 200, from: 100, to: 550 }]);
  });

  it('沒有重合的線不畫；只檢查指定的線', () => {
    const r = { x: 200, y: 300, w: 77, h: 50 };
    // 左邊 200 與 ref 對齊，但沒有指定（左邊沒有移動），所以不畫
    expect(alignGuides(r, { xs: [277], ys: [350] }, [ref])).toEqual([]);
  });
});
