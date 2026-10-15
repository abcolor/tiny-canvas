import { describe, expect, it } from 'vitest';
import { thumbnailSize } from '../src/geometry';

describe('縮圖尺寸', () => {
  it('寬的內容以寬度為限，等比縮小', () => {
    expect(thumbnailSize({ x: -500, y: 0, w: 4000, h: 1000 }, 800, 240)).toEqual({ scale: 0.2, width: 800, height: 200 });
  });

  it('高的內容以高度為限', () => {
    expect(thumbnailSize({ x: 0, y: 0, w: 600, h: 2400 }, 800, 240)).toEqual({ scale: 0.1, width: 60, height: 240 });
  });

  it('內容比上限小時不放大', () => {
    expect(thumbnailSize({ x: 10, y: 10, w: 120, h: 80 }, 800, 240)).toEqual({ scale: 1, width: 120, height: 80 });
  });

  it('極細長的內容至少 1 px，且不超過上限', () => {
    const s = thumbnailSize({ x: 0, y: 0, w: 100000, h: 2 }, 800, 240);
    expect(s.width).toBe(800);
    expect(s.height).toBe(1);
    const z = thumbnailSize({ x: 0, y: 0, w: 0, h: 0 }, 800, 240);
    expect(z).toEqual({ scale: 1, width: 1, height: 1 });
  });
});
