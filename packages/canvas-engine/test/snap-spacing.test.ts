import { describe, expect, it } from 'vitest';
import { equalSpacingSnap, spacingGuides } from '../src/geometry';

// 移動時的等距提示（DECISIONS.md 2026-10-14）
const box = (x: number, y: number, w = 100, h = 60) => ({ x, y, w, h });
// 上下排列、間距 40 的兩個物件
const A = box(0, 0);
const B = box(0, 100);

describe('等距吸附（equalSpacingSnap）', () => {
  it('連續等距：與上一個鄰居的間距吸到等於上面兩個物件的間距', () => {
    // C 在 B 下方 43 px，吸到 40
    expect(equalSpacingSnap(box(0, 203), [A, B], 'y', 6)).toBeCloseTo(-3, 6);
    expect(equalSpacingSnap(box(0, 196), [A, B], 'y', 6)).toBeCloseTo(4, 6);
  });

  it('往下的連續等距：與下一個鄰居的間距等於下面兩個物件的間距', () => {
    // 移動的物件在 A 上方，B 在 A 下方 40；物件底部離 A 37 時吸到 40
    expect(equalSpacingSnap(box(0, -97), [A, B], 'y', 6)).toBeCloseTo(-3, 6);
  });

  it('位在兩個鄰居正中間', () => {
    const top = box(0, 0);
    const bottom = box(0, 300);
    // 中間物件高 60：正中間的 y = (60 + 300 - 60) / 2 = 150
    expect(equalSpacingSnap(box(0, 153), [top, bottom], 'y', 6)).toBeCloseTo(-3, 6);
  });

  it('左右方向同樣適用', () => {
    const L = box(0, 0);
    const M = box(130, 0);
    expect(equalSpacingSnap(box(262, 10), [L, M], 'x', 6)).toBeCloseTo(-2, 6);
  });

  it('超出容差、或另一軸範圍沒有重疊時不吸附', () => {
    expect(equalSpacingSnap(box(0, 215), [A, B], 'y', 6)).toBeNull();
    // 左右錯開、沒有重疊的物件不算上下鄰居
    expect(equalSpacingSnap(box(300, 203), [A, B], 'y', 6)).toBeNull();
  });

  it('多個候選時取最近的一個', () => {
    // 往上的連續等距要求 y = 200（差 -6），B 與 below 的正中間要求 y = (160 + 320 - 60) / 2 = 210（差 +4）
    const below = box(0, 320);
    expect(equalSpacingSnap(box(0, 206), [A, B, below], 'y', 6)).toBeCloseTo(4, 6);
  });
});

describe('等距提示線（spacingGuides）', () => {
  it('連續等距：標出移動物件與鄰居、鄰居與上一個物件兩段間距', () => {
    const guides = spacingGuides(box(0, 200), [A, B]);
    expect(guides).toEqual([
      { axis: 'x', pos: 50, from: 160, to: 200, gap: true },
      { axis: 'x', pos: 50, from: 60, to: 100, gap: true },
    ]);
  });

  it('更長的等距鏈：每一段相等的間距都標出來，不相等處停止', () => {
    const top = box(0, -200);
    const guides = spacingGuides(box(0, 200), [top, A, B]);
    // top 與 A 間距 140，不相等，不標
    expect(guides.map((g) => [g.from, g.to])).toEqual([
      [160, 200],
      [60, 100],
    ]);
    const C = box(0, 200);
    const chain = spacingGuides(box(0, 300), [A, B, C]);
    expect(chain.map((g) => [g.from, g.to])).toEqual([
      [260, 300],
      [160, 200],
      [60, 100],
    ]);
  });

  it('位在兩個鄰居正中間：標出兩邊的間距', () => {
    const guides = spacingGuides(box(0, 150), [box(0, 0), box(0, 300)]);
    expect(guides.map((g) => [g.from, g.to])).toEqual([
      [60, 150],
      [210, 300],
    ]);
  });

  it('提示線畫在兩個物件另一軸重疊範圍的中央', () => {
    // B 往右錯開 40：A、B 重疊 x 40～100 → 中央 70；B 與移動物件重疊 x 40～100
    const B2 = box(40, 100);
    const guides = spacingGuides(box(0, 200), [A, B2]);
    expect(guides).toEqual([
      { axis: 'x', pos: 70, from: 160, to: 200, gap: true },
      { axis: 'x', pos: 70, from: 60, to: 100, gap: true },
    ]);
  });

  it('左右方向：畫成水平的線', () => {
    const guides = spacingGuides(box(260, 10), [box(0, 0), box(130, 0)]);
    expect(guides).toEqual([
      { axis: 'y', pos: 35, from: 230, to: 260, gap: true },
      { axis: 'y', pos: 30, from: 100, to: 130, gap: true },
    ]);
  });

  it('間距不相等或沒有鄰居時不畫', () => {
    expect(spacingGuides(box(0, 210), [A, B])).toEqual([]);
    expect(spacingGuides(box(500, 500), [A, B])).toEqual([]);
    // 只有一個鄰居
    expect(spacingGuides(box(0, 200), [B])).toEqual([]);
  });
});
