import { describe, expect, it } from 'vitest';
import { ICON_GAP, shapeHeightForText, shapeIconRect, shapeIconSize, shapeTextBox, type ShapeIcon } from '../src/render/shapes';
import { resolveStyle } from '../src/style';
import { makeModel, rect } from './helpers';

// 形狀內嵌圖示：置中、上下左右位置、固定間隔、大小跟著文字大小（SPEC.md 第 4.1 節）
const W = 160;
const H = 80;
// 矩形內容區：左右內距 12、上下內距 8 → (12, 8, 136, 64)，中心 (80, 40)
const cx = (r: { x: number; w: number }) => r.x + r.w / 2;
const cy = (r: { y: number; h: number }) => r.y + r.h / 2;
const text = { width: 60, height: 20 };
const ic = (position: ShapeIcon['position'], size = 24): ShapeIcon => ({ position, size });

describe('形狀內嵌圖示', () => {
  it('圖示邊長跟著文字大小，不隨形狀縮放', () => {
    expect(shapeIconSize(14)).toBe(24);
    expect(shapeIconSize(28)).toBe(48);
    const { model } = makeModel([rect('a', 0, 0, { icon: 'Star', w: 40, h: 30, style: { fontSize: 20 } } as any), rect('b', 0, 100, { icon: 'Star', w: 600, h: 400, z: 'a1' } as any)]);
    const a = model.store.get('a') as any;
    const b = model.store.get('b') as any;
    // 小形狀也不縮小、大形狀也不放大
    const ra = shapeIconRect('rectangle', 0, 0, a.w, a.h, ic('top', shapeIconSize(resolveStyle(a).fontSize)), null, 'center', 'middle');
    const rb = shapeIconRect('rectangle', 0, 0, b.w, b.h, ic('top', shapeIconSize(resolveStyle(b).fontSize)), null, 'center', 'middle');
    expect(ra.w).toBe(34);
    expect(rb.w).toBe(24);
  });

  it('沒有文字時圖示在形狀正中央', () => {
    const r = shapeIconRect('rectangle', 0, 0, W, H, ic('top'), null, 'center', 'middle');
    expect(cx(r)).toBeCloseTo(80, 6);
    expect(cy(r)).toBeCloseTo(40, 6);
  });

  it('圖示在上方：圖示 + 間隔 + 文字整體垂直置中，圖示水平置中', () => {
    const s = 24;
    const r = shapeIconRect('rectangle', 0, 0, W, H, ic('top'), text, 'center', 'middle');
    const box = shapeTextBox('rectangle', 0, 0, W, H, ic('top'));
    const textTop = box.y + (box.h - text.height) / 2;
    expect(textTop - (r.y + r.h)).toBeCloseTo(ICON_GAP, 6);
    // 群組上緣到下緣的中點 = 形狀中心
    expect((r.y + textTop + text.height) / 2).toBeCloseTo(40, 6);
    expect(cx(r)).toBeCloseTo(80, 6);
    expect(r.w).toBe(s);
  });

  it('圖示在下方：群組垂直置中', () => {
    const r = shapeIconRect('rectangle', 0, 0, W, H, ic('bottom'), text, 'center', 'middle');
    const box = shapeTextBox('rectangle', 0, 0, W, H, ic('bottom'));
    const textTop = box.y + (box.h - text.height) / 2;
    expect(r.y - (textTop + text.height)).toBeCloseTo(ICON_GAP, 6);
    expect((textTop + r.y + r.h) / 2).toBeCloseTo(40, 6);
  });

  it('圖示在左側、右側：群組水平置中，圖示與文字垂直置中', () => {
    for (const pos of ['left', 'right'] as const) {
      const r = shapeIconRect('rectangle', 0, 0, W, H, ic(pos), text, 'center', 'middle');
      const box = shapeTextBox('rectangle', 0, 0, W, H, ic(pos));
      const textLeft = box.x + (box.w - text.width) / 2;
      const groupL = Math.min(r.x, textLeft);
      const groupR = Math.max(r.x + r.w, textLeft + text.width);
      expect((groupL + groupR) / 2).toBeCloseTo(80, 6);
      expect(cy(r)).toBeCloseTo(40, 6);
      const gap = pos === 'left' ? textLeft - (r.x + r.w) : r.x - (textLeft + text.width);
      expect(gap).toBeCloseTo(ICON_GAP, 6);
    }
  });

  it('間隔固定，不隨形狀縮放', () => {
    const big = shapeIconRect('rectangle', 0, 0, W * 3, H * 3, ic('top'), text, 'center', 'middle');
    const box = shapeTextBox('rectangle', 0, 0, W * 3, H * 3, ic('top'));
    expect(box.y + (box.h - text.height) / 2 - (big.y + big.h)).toBeCloseTo(ICON_GAP, 6);
  });

  it('自動增高時把圖示算進去', () => {
    const need = shapeHeightForText('rectangle', W, 100, ic('top'));
    expect(shapeTextBox('rectangle', 0, 0, W, need, ic('top')).h).toBeCloseTo(100, 1);
    expect(need).toBeCloseTo(100 + 24 + ICON_GAP + 16, 1);
    const side = shapeHeightForText('rectangle', W, 100, ic('left'));
    expect(shapeTextBox('rectangle', 0, 0, W, side, ic('left')).h).toBeCloseTo(100, 1);
  });

  it('新形狀的圖示位置預設在上方', () => {
    const { model } = makeModel([rect('a', 0, 0, { icon: 'Star' } as any)]);
    expect(model.store.get('a')).toMatchObject({ iconPosition: 'top' });
  });
});
