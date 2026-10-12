import type { IconPosition, ShapeKind } from '@tinycanvas/shared';
import type { Rect } from '../geometry';

/** CanvasPath 的子集：CanvasRenderingContext2D 與 Path2D 都實作 */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw?: boolean): void;
  rect(x: number, y: number, w: number, h: number): void;
  closePath(): void;
}

function poly(p: PathSink, pts: number[]) {
  p.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
  p.closePath();
}

/** 圓角矩形的圓角半徑：短邊的一半 */
export function roundedRadius(w: number, h: number): number {
  return Math.min(w, h) / 2;
}

export function roundRectPath(p: PathSink, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r < 0.5) {
    p.rect(x, y, w, h);
    return;
  }
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r);
  p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r);
  p.arcTo(x, y, x + w, y, r);
  p.closePath();
}

function cylRy(w: number, h: number) {
  return Math.min(h * 0.14, w * 0.25, 14);
}

/**
 * 形狀外框路徑（世界座標，未旋轉）。`detail` 為 true 時只畫裝飾線（例如圓柱的上緣弧線），呼叫端只描邊不填色。
 * 回傳是否有 detail 可畫。
 */
export function shapePath(p: PathSink, kind: ShapeKind, x: number, y: number, w: number, h: number, round = true): void {
  switch (kind) {
    case 'rectangle':
      roundRectPath(p, x, y, w, h, round ? 3 : 0);
      return;
    case 'rounded':
      // 圓角矩形為膠囊形：圓角半徑為短邊的一半（W > H 時為 H / 2，否則為 W / 2）
      roundRectPath(p, x, y, w, h, round ? roundedRadius(w, h) : 0);
      return;
    case 'ellipse':
      p.moveTo(x + w, y + h / 2);
      p.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      p.closePath();
      return;
    case 'diamond':
      poly(p, [x + w / 2, y, x + w, y + h / 2, x + w / 2, y + h, x, y + h / 2]);
      return;
    case 'parallelogram': {
      const s = Math.min(w * 0.2, h * 0.6);
      poly(p, [x + s, y, x + w, y, x + w - s, y + h, x, y + h]);
      return;
    }
    case 'trapezoid': {
      const s = Math.min(w * 0.18, h * 0.6);
      poly(p, [x + s, y, x + w - s, y, x + w, y + h, x, y + h]);
      return;
    }
    case 'cylinder': {
      const ry = cylRy(w, h);
      p.moveTo(x, y + ry);
      p.lineTo(x, y + h - ry);
      p.ellipse(x + w / 2, y + h - ry, w / 2, ry, 0, Math.PI, 0, true);
      p.lineTo(x + w, y + ry);
      p.ellipse(x + w / 2, y + ry, w / 2, ry, 0, 0, Math.PI, true);
      p.closePath();
      return;
    }
    case 'document': {
      const a = Math.min(h * 0.12, 12);
      p.moveTo(x, y);
      p.lineTo(x + w, y);
      p.lineTo(x + w, y + h - a);
      p.bezierCurveTo(x + w * 0.75, y + h - 3 * a, x + w * 0.5, y + h - a * 0.2, x + w * 0.25, y + h);
      p.bezierCurveTo(x + w * 0.12, y + h + a * 0.4, x + w * 0.05, y + h, x, y + h - a * 0.6);
      p.closePath();
      return;
    }
    case 'hexagon': {
      const s = Math.min(w * 0.22, h * 0.5);
      poly(p, [x + s, y, x + w - s, y, x + w, y + h / 2, x + w - s, y + h, x + s, y + h, x, y + h / 2]);
      return;
    }
    case 'octagon': {
      const c = Math.min(w, h) * 0.29;
      poly(p, [x + c, y, x + w - c, y, x + w, y + c, x + w, y + h - c, x + w - c, y + h, x + c, y + h, x, y + h - c, x, y + c]);
      return;
    }
    case 'triangle':
      poly(p, [x + w / 2, y, x + w, y + h, x, y + h]);
      return;
    case 'pentagon':
      poly(p, [x + w / 2, y, x + w, y + h * 0.38, x + w * 0.81, y + h, x + w * 0.19, y + h, x, y + h * 0.38]);
      return;
    case 'star': {
      const pts: number[] = [];
      const cx = x + w / 2;
      const cy = y + h * 0.53;
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 1 : 0.45;
        pts.push(cx + Math.cos(a) * (w / 2) * r, cy + Math.sin(a) * (h * 0.53) * r);
      }
      poly(p, pts);
      return;
    }
    case 'cloud': {
      // 以數個弧形凸起組成
      p.moveTo(x + w * 0.25, y + h * 0.9);
      p.bezierCurveTo(x - w * 0.05, y + h * 0.9, x - w * 0.02, y + h * 0.45, x + w * 0.2, y + h * 0.45);
      p.bezierCurveTo(x + w * 0.18, y + h * 0.1, x + w * 0.5, y + h * 0.02, x + w * 0.58, y + h * 0.25);
      p.bezierCurveTo(x + w * 0.7, y + h * 0.08, x + w * 0.95, y + h * 0.2, x + w * 0.86, y + h * 0.45);
      p.bezierCurveTo(x + w * 1.04, y + h * 0.5, x + w * 1.04, y + h * 0.9, x + w * 0.78, y + h * 0.9);
      p.closePath();
      return;
    }
    case 'person': {
      const r = Math.min(w * 0.26, h * 0.17);
      p.moveTo(x + w / 2 + r, y + r);
      p.ellipse(x + w / 2, y + r, r, r, 0, 0, Math.PI * 2);
      p.closePath();
      const top = y + r * 2 + h * 0.04;
      const sr = Math.min(w * 0.4, (y + h - top) * 0.5);
      p.moveTo(x, y + h);
      p.lineTo(x, top + sr);
      p.arcTo(x, top, x + sr, top, sr);
      p.lineTo(x + w - sr, top);
      p.arcTo(x + w, top, x + w, top + sr, sr);
      p.lineTo(x + w, y + h);
      p.closePath();
      return;
    }
    case 'arrow_right': {
      const head = Math.min(w * 0.4, h * 0.9);
      poly(p, [x, y + h * 0.25, x + w - head, y + h * 0.25, x + w - head, y, x + w, y + h / 2, x + w - head, y + h, x + w - head, y + h * 0.75, x, y + h * 0.75]);
      return;
    }
    case 'chevron': {
      const s = Math.min(w * 0.25, h * 0.5);
      poly(p, [x, y, x + w - s, y, x + w, y + h / 2, x + w - s, y + h, x, y + h, x + s, y + h / 2]);
      return;
    }
    case 'callout': {
      const bh = h * 0.78;
      const r = round ? Math.min(10, bh / 4) : 0;
      p.moveTo(x + r, y);
      p.arcTo(x + w, y, x + w, y + bh, r);
      p.arcTo(x + w, y + bh, x, y + bh, r);
      p.lineTo(x + w * 0.36, y + bh);
      p.lineTo(x + w * 0.18, y + h);
      p.lineTo(x + w * 0.2, y + bh);
      p.arcTo(x, y + bh, x, y, r);
      p.arcTo(x, y, x + w, y, r);
      p.closePath();
      return;
    }
    case 'cross': {
      const tx = w / 3;
      const ty = h / 3;
      poly(p, [x + tx, y, x + w - tx, y, x + w - tx, y + ty, x + w, y + ty, x + w, y + h - ty, x + w - tx, y + h - ty, x + w - tx, y + h, x + tx, y + h, x + tx, y + h - ty, x, y + h - ty, x, y + ty, x + tx, y + ty]);
      return;
    }
    case 'manual_input':
      poly(p, [x, y + h * 0.25, x + w, y, x + w, y + h, x, y + h]);
      return;
    default:
      p.rect(x, y, w, h);
  }
}

/** 只描邊的裝飾線（例如圓柱上緣的前半弧）；沒有時回傳 false */
export function shapeDetailPath(p: PathSink, kind: ShapeKind, x: number, y: number, w: number, h: number): boolean {
  if (kind === 'cylinder') {
    const ry = cylRy(w, h);
    p.moveTo(x, y + ry);
    p.ellipse(x + w / 2, y + ry, w / 2, ry, 0, Math.PI, 0, true);
    return true;
  }
  return false;
}

export const SHAPE_PAD_X = 12;
export const SHAPE_PAD_Y = 8;
/** 形狀內圖示與文字之間的固定間隔 */
export const ICON_GAP = 8;

/** 圖示邊長與文字大小的比例：預設文字 14 px 時圖示 24 px */
export const ICON_FONT_RATIO = 24 / 14;

/** 形狀內圖示的位置與邊長 */
export interface ShapeIcon {
  position: IconPosition;
  size: number;
}

/** 形狀內嵌圖示的邊長：只跟著文字大小，不隨形狀縮放 */
export function shapeIconSize(fontSize: number): number {
  return Math.round(fontSize * ICON_FONT_RATIO);
}

/** 形狀內的圖示（fontSize 為形狀的文字大小）；沒有圖示時為 null */
export function shapeIcon(
  o: { icon: string | null; iconPosition?: IconPosition },
  fontSize: number,
): ShapeIcon | null {
  return o.icon ? { position: o.iconPosition ?? 'top', size: shapeIconSize(fontSize) } : null;
}

/**
 * 形狀內文字框（已扣除內距；世界座標，未旋轉）。有圖示時，文字框往圖示的反方向讓出「圖示 + 間隔」：
 * 文字在框內置中時，圖示、間隔與文字整體就在內容區置中（見 shapeIconRect）
 */
export function shapeTextBox(kind: ShapeKind, x: number, y: number, w: number, h: number, icon: ShapeIcon | null = null): Rect {
  const c = shapeContentBox(kind, x, y, w, h);
  if (!icon) return c;
  const d = icon.size + ICON_GAP;
  switch (icon.position) {
    case 'top':
      return { x: c.x, y: c.y + d, w: c.w, h: Math.max(1, c.h - d) };
    case 'bottom':
      return { x: c.x, y: c.y, w: c.w, h: Math.max(1, c.h - d) };
    case 'left':
      return { x: c.x + d, y: c.y, w: Math.max(1, c.w - d), h: c.h };
    case 'right':
      return { x: c.x, y: c.y, w: Math.max(1, c.w - d), h: c.h };
  }
}

/**
 * 形狀內圖示的位置（世界座標，未旋轉）。text 為排版後的文字寬高；沒有文字時傳 null，圖示在內容區正中央。
 * 有文字時圖示貼在文字區塊的指定一側，間隔固定為 ICON_GAP，並與文字區塊置中對齊
 */
export function shapeIconRect(
  kind: ShapeKind,
  x: number,
  y: number,
  w: number,
  h: number,
  icon: ShapeIcon,
  text: { width: number; height: number } | null,
  align: string,
  valign: string,
): Rect {
  const s = icon.size;
  if (!text) {
    const c = shapeContentBox(kind, x, y, w, h);
    return { x: c.x + (c.w - s) / 2, y: c.y + (c.h - s) / 2, w: s, h: s };
  }
  const b = shapeTextBox(kind, x, y, w, h, icon);
  const top = valign === 'top' ? b.y : valign === 'bottom' ? b.y + b.h - text.height : b.y + (b.h - text.height) / 2;
  const left = align === 'left' ? b.x : align === 'right' ? b.x + b.w - text.width : b.x + (b.w - text.width) / 2;
  switch (icon.position) {
    case 'top':
      return { x: left + (text.width - s) / 2, y: top - ICON_GAP - s, w: s, h: s };
    case 'bottom':
      return { x: left + (text.width - s) / 2, y: top + text.height + ICON_GAP, w: s, h: s };
    case 'left':
      return { x: left - ICON_GAP - s, y: top + (text.height - s) / 2, w: s, h: s };
    case 'right':
      return { x: left + text.width + ICON_GAP, y: top + (text.height - s) / 2, w: s, h: s };
  }
}

/** 形狀的內容區：扣除內距與形狀本身避開的區域（世界座標，未旋轉） */
function shapeContentBox(kind: ShapeKind, x: number, y: number, w: number, h: number): Rect {
  let l = SHAPE_PAD_X;
  let r = SHAPE_PAD_X;
  let t = SHAPE_PAD_Y;
  let b = SHAPE_PAD_Y;
  switch (kind) {
    case 'rounded': {
      // 兩端是半圓：文字避開弧線（橫長時加大左右內距，直長時加大上下內距）
      const rr = roundedRadius(w, h);
      if (w > h) l = r = Math.max(SHAPE_PAD_X, rr * 0.45);
      else t = b = Math.max(SHAPE_PAD_Y, rr * 0.45);
      break;
    }
    case 'ellipse':
      l = r = w * 0.146 + 4;
      t = b = h * 0.146 + 2;
      break;
    case 'diamond':
      l = r = w * 0.25;
      t = b = h * 0.25;
      break;
    case 'triangle':
      l = r = w * 0.24;
      t = h * 0.45;
      b = 6;
      break;
    case 'hexagon':
      l = r = Math.min(w * 0.22, h * 0.5) * 0.7 + 6;
      break;
    case 'octagon':
      l = r = Math.min(w, h) * 0.12 + 8;
      break;
    case 'pentagon':
      l = r = w * 0.18;
      t = h * 0.3;
      break;
    case 'parallelogram':
      l = r = Math.min(w * 0.2, h * 0.6) * 0.75 + 8;
      break;
    case 'trapezoid':
      l = r = Math.min(w * 0.18, h * 0.6) + 6;
      break;
    case 'cylinder':
      t = cylRy(w, h) * 2 + 4;
      break;
    case 'document':
      b = Math.min(h * 0.12, 12) + 8;
      break;
    case 'star':
      l = r = w * 0.32;
      t = h * 0.38;
      b = h * 0.22;
      break;
    case 'cloud':
      l = r = w * 0.16;
      t = h * 0.3;
      b = h * 0.14;
      break;
    case 'person':
      t = Math.min(w * 0.26, h * 0.17) * 2 + h * 0.06 + 4;
      l = r = 4;
      b = 4;
      break;
    case 'arrow_right':
      l = 8;
      r = Math.min(w * 0.4, h * 0.9) * 0.6;
      t = b = h * 0.25 + 2;
      break;
    case 'chevron':
      l = Math.min(w * 0.25, h * 0.5) + 4;
      r = l;
      break;
    case 'callout':
      b = h * 0.22 + 6;
      break;
    case 'cross':
      l = r = w / 3 + 2;
      t = b = h / 3 + 2;
      break;
    case 'manual_input':
      t = h * 0.25 + 4;
      break;
  }
  return { x: x + l, y: y + t, w: Math.max(1, w - l - r), h: Math.max(1, h - t - b) };
}

/** 讓文字高度 textH 放得下所需的形狀高度（線性求解：文字框高度對形狀高度是線性的） */
export function shapeHeightForText(kind: ShapeKind, w: number, textH: number, icon: ShapeIcon | null): number {
  const h1 = shapeTextBox(kind, 0, 0, w, 100, icon).h;
  const h2 = shapeTextBox(kind, 0, 0, w, 200, icon).h;
  const a = (h2 - h1) / 100;
  if (a <= 0.01) return textH + 2 * SHAPE_PAD_Y;
  const b = a * 100 - h1;
  return (textH + b) / a;
}
