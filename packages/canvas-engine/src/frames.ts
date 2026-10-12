// 裝置框（見 SPEC.md 第 4.2 節）：frameKind 不為 null 的區塊。只差在外觀，行為完全遵循第 3.3 節的區塊規則。
import type { FrameKind, SectionObject } from '@tinycanvas/shared';
import type { Rect } from './geometry';

/** 新裝置框的預設尺寸 */
export const FRAME_SIZES: Record<FrameKind, { w: number; h: number }> = {
  phone: { w: 375, h: 812 },
  tablet: { w: 768, h: 1024 },
  browser: { w: 1280, h: 800 },
  window: { w: 960, h: 640 },
};

/** 裝置框的標題畫在外框上方（不佔內容區），空間索引的範圍向上延伸這麼多 */
export const FRAME_TITLE_SPACE = 26;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function frameInsets(kind: FrameKind | null): Insets {
  switch (kind) {
    case 'phone':
      return { top: 10 + 34, right: 10, bottom: 10 + 22, left: 10 };
    case 'tablet':
      return { top: 16 + 24, right: 16, bottom: 16, left: 16 };
    case 'browser':
      return { top: 36 + 40, right: 0, bottom: 0, left: 0 };
    case 'window':
      return { top: 36, right: 0, bottom: 0, left: 0 };
    default:
      return { top: 0, right: 0, bottom: 0, left: 0 };
  }
}

/** 內容區（拖入判定的範圍）。一般區塊為整個區塊 */
export function sectionContentRect(o: Pick<SectionObject, 'x' | 'y' | 'w' | 'h' | 'frameKind'>): Rect {
  const i = frameInsets(o.frameKind);
  return { x: o.x + i.left, y: o.y + i.top, w: Math.max(1, o.w - i.left - i.right), h: Math.max(1, o.h - i.top - i.bottom) };
}

/** 區塊在空間索引中的範圍：裝置框包含上方的標題 */
export function sectionBounds(o: Pick<SectionObject, 'x' | 'y' | 'w' | 'h' | 'frameKind'>): Rect {
  return o.frameKind ? { x: o.x, y: o.y - FRAME_TITLE_SPACE, w: o.w, h: o.h + FRAME_TITLE_SPACE } : { x: o.x, y: o.y, w: o.w, h: o.h };
}
