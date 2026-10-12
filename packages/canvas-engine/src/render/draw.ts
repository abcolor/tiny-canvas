import type {
  ArrowHead,
  BoardObject,
  ConnectorObject,
  ImageObject,
  LinkCardObject,
  IconObject,
  Point,
  SectionObject,
  ShapeObject,
  TextObject,
} from '@tinycanvas/shared';
import { distToSegment, rectCenter, toLocal, type Rect } from '../geometry';
import { bezierPoint, type Route, type RouteCache } from '../connectors/route';
import { resolveStyle, fontString, CANVAS_BG, BRAND, type ResolvedStyle } from '../style';
import type { EditField, EditingState, EngineLabels } from '../types';
import { roundRectPath, shapeDetailPath, shapeIcon, shapeIconRect, shapePath, shapeTextBox } from './shapes';
import { drawTextLayout, textBarsPath, type TextLayoutCache } from './text';
import { drawIcon, getIconPath } from './icons';
import type { ImageCache } from './images';
import { wireframeRenderer } from './wireframe';
import { tableRenderer } from './table';
export { TABLE_CELL_PAD, tableCellRect } from './table';
import { FRAME_TITLE_SPACE, sectionContentRect } from '../frames';

export interface RenderContext {
  /** 世界座標 → CSS px 的縮放（匯出時為匯出倍率） */
  zoom: number;
  get: (id: string) => BoardObject | undefined;
  routes: RouteCache;
  text: TextLayoutCache;
  images: ImageCache;
  labels: EngineLabels;
  editing: EditingState | null;
  canOpenLinks: boolean;
  /** 非同步資源（圖示、圖片）載入完成後要求重繪 */
  invalidate: (id: string) => void;
  /** 拖曳預覽時替換連線路由 */
  routeOf?: (c: ConnectorObject) => Route;
  exporting?: boolean;
}

/** 物件類型的渲染器（線框圖、表格等之後可以替換） */
export interface ObjectRenderer<T extends BoardObject = any> {
  draw(ctx: CanvasRenderingContext2D, o: T, rc: RenderContext): void;
  /** 低縮放時的批次繪製；回傳 false 表示改用 draw() */
  drawLod?(batch: LodBatch, o: T, rc: RenderContext): boolean;
  /** 世界座標點是否命中（點已轉為物件未旋轉時的座標）。'body' 表示命中區塊本體（可框選） */
  hitTest?(o: T, p: Point, rc: RenderContext, tolerance: number): boolean | 'body';
  /** 編輯文字時的文字框（世界座標、未旋轉、已扣除內距） */
  getTextBox?(o: T, field: EditField, cellKey: string | undefined, rc: RenderContext): Rect | null;
}

const registry = new Map<string, ObjectRenderer>();

/** 註冊（或替換）某個物件類型的渲染器 */
export function registerRenderer<T extends BoardObject = any>(type: string, r: ObjectRenderer<T>): void {
  registry.set(type, r as ObjectRenderer);
}

export function getRenderer(type: string): ObjectRenderer {
  return registry.get(type) ?? placeholderRenderer;
}

// ---------------------------------------------------------------- 批次（低細節）

/** 依顏色合併路徑，一次 fill/stroke，大幅減少低縮放時的繪製呼叫 */
export class LodBatch {
  fills = new Map<string, Path2D>();
  strokes = new Map<string, Path2D>();
  bars: Path2D | null = null;
  barColor = 'rgba(120,130,140,0.4)';
  count = 0;
  constructor(public zoom: number) {}
  fill(color: string): Path2D {
    let p = this.fills.get(color);
    if (!p) this.fills.set(color, (p = new Path2D()));
    this.count++;
    return p;
  }
  /** key：`${color}|${width}|${dash}` */
  stroke(color: string, width: number, dash = ''): Path2D {
    const key = `${color}|${width}|${dash}`;
    let p = this.strokes.get(key);
    if (!p) this.strokes.set(key, (p = new Path2D()));
    this.count++;
    return p;
  }
  bar(): Path2D {
    if (!this.bars) this.bars = new Path2D();
    this.count++;
    return this.bars;
  }
  flush(ctx: CanvasRenderingContext2D) {
    if (!this.count) return;
    for (const [color, p] of this.fills) {
      ctx.fillStyle = color;
      ctx.fill(p);
    }
    for (const [key, p] of this.strokes) {
      const [color, w, dash] = key.split('|');
      ctx.strokeStyle = color;
      // 線寬至少 1 個螢幕像素
      ctx.lineWidth = Math.max(Number(w), 0.8 / this.zoom);
      ctx.setLineDash(dash ? dash.split(',').map(Number) : []);
      ctx.stroke(p);
    }
    ctx.setLineDash([]);
    if (this.bars) {
      ctx.fillStyle = this.barColor;
      ctx.fill(this.bars);
    }
    this.fills.clear();
    this.strokes.clear();
    this.bars = null;
    this.count = 0;
  }
}

// ---------------------------------------------------------------- 共用

const SHADOW_1 = 'rgba(16, 24, 40, 0.06)';
const SHADOW_2 = 'rgba(16, 24, 40, 0.035)';
const isTransparent = (c: string) => !c || c === 'transparent' || c === 'none';

/** 低縮放時色塊的顏色：白色或透明的填色改用淡灰 */
function blockColor(st: ResolvedStyle): string {
  const f = st.fill?.toLowerCase();
  if (isTransparent(f) || f === '#ffffff' || f === '#fff' || f === 'white') return isTransparent(st.stroke) ? '#d9dee3' : '#dfe3e8';
  return st.fill;
}

function dashFor(st: ResolvedStyle): number[] {
  if (st.strokeStyle === 'dashed') return [st.strokeWidth * 4, st.strokeWidth * 3];
  if (st.strokeStyle === 'dotted') return [st.strokeWidth, st.strokeWidth * 2];
  return [];
}

/** 在物件的區域座標系中執行繪製（原點為物件左上角，含旋轉） */
function withLocal(ctx: CanvasRenderingContext2D, o: BoardObject, fn: () => void) {
  if (o.rotation) {
    ctx.save();
    const c = rectCenter(o);
    ctx.translate(c.x, c.y);
    ctx.rotate((o.rotation * Math.PI) / 180);
    ctx.translate(-o.w / 2, -o.h / 2);
    fn();
    ctx.restore();
  } else {
    ctx.translate(o.x, o.y);
    fn();
    ctx.translate(-o.x, -o.y);
  }
}

const pathCache = new WeakMap<BoardObject, { round: boolean; path: Path2D }>();
function localShapePath(o: ShapeObject, round: boolean): Path2D {
  const hit = pathCache.get(o);
  if (hit && hit.round === round) return hit.path;
  const p = new Path2D();
  shapePath(p, o.shapeKind, 0, 0, o.w, o.h, round);
  pathCache.set(o, { round, path: p });
  return p;
}

function isEditing(rc: RenderContext, id: string, field: EditField, cellKey?: string) {
  const e = rc.editing;
  return !!e && e.id === id && e.field === field && (field !== 'cell' || e.cellKey === cellKey);
}

function plainLength(o: { text: { runs: { text: string }[] }[] }): number {
  let n = 0;
  for (const b of o.text) for (const r of b.runs) n += r.text.length;
  return n;
}

// ---------------------------------------------------------------- shape

export function shapeTextBoxOf(o: ShapeObject): Rect {
  return shapeTextBox(o.shapeKind, o.x, o.y, o.w, o.h, shapeIcon(o, resolveStyle(o).fontSize));
}

const shapeRenderer: ObjectRenderer<ShapeObject> = {
  draw(ctx, o, rc) {
    const st = resolveStyle(o);
    const z = rc.zoom;
    const round = Math.min(o.w, o.h) * z > 12;
    const path = localShapePath(o, round);
    if (st.opacity < 1) ctx.globalAlpha = st.opacity;
    withLocal(ctx, o, () => {
      const filled = !isTransparent(st.fill);
      if (filled && z >= 0.5 && !rc.exporting) {
        ctx.fillStyle = SHADOW_2;
        ctx.translate(0, 3);
        ctx.fill(path);
        ctx.fillStyle = SHADOW_1;
        ctx.translate(0, -2);
        ctx.fill(path);
        ctx.translate(0, -1);
      } else if (filled && rc.exporting) {
        ctx.fillStyle = SHADOW_1;
        ctx.translate(0, 1.5);
        ctx.fill(path);
        ctx.translate(0, -1.5);
      }
      if (filled) {
        ctx.fillStyle = st.fill;
        ctx.fill(path);
      }
      if (st.strokeStyle !== 'none' && st.strokeWidth > 0 && !isTransparent(st.stroke)) {
        ctx.strokeStyle = st.stroke;
        ctx.lineWidth = Math.max(st.strokeWidth, 0.8 / z);
        const dash = dashFor(st);
        if (dash.length) ctx.setLineDash(dash);
        ctx.lineJoin = 'round';
        ctx.stroke(path);
        if (o.shapeKind === 'cylinder') {
          ctx.beginPath();
          shapeDetailPath(ctx, o.shapeKind, 0, 0, o.w, o.h);
          ctx.stroke();
        }
        if (dash.length) ctx.setLineDash([]);
      }
      const icon = shapeIcon(o, st.fontSize);
      const box = shapeTextBox(o.shapeKind, 0, 0, o.w, o.h, icon);
      const editing = isEditing(rc, o.id, 'text');
      if (o.icon && icon && icon.size * z >= 3) {
        const ip = getIconPath(o.icon, () => rc.invalidate(o.id));
        // 沒有文字時圖示在正中央；有文字（或編輯中）時與文字一起置中
        const lay = plainLength(o) === 0 && !editing ? null : rc.text.get(o.id, o.text, box.w, st.fontSize, st.fontWeight);
        const r = shapeIconRect(o.shapeKind, 0, 0, o.w, o.h, icon, lay, st.textAlign, st.verticalAlign);
        if (ip) drawIcon(ctx, ip, r.x, r.y, r.w, st.textColor);
      }
      if (!editing) {
        if (st.fontSize * z < 1.2) return;
        const lay = rc.text.get(o.id, o.text, box.w, st.fontSize, st.fontWeight);
        drawTextLayout(ctx, lay, box, { color: st.textColor, align: st.textAlign, valign: st.verticalAlign, zoom: z });
      }
    });
    if (st.opacity < 1) ctx.globalAlpha = 1;
  },
  drawLod(b, o, rc) {
    if (o.rotation) return false;
    const st = resolveStyle(o);
    const z = rc.zoom;
    if (st.fontSize * z >= 4 && plainLength(o) > 0) return false;
    if (Math.max(o.w, o.h) * z < 2) {
      b.fill(blockColor(st)).rect(o.x, o.y, o.w, o.h);
      return true;
    }
    const filled = !isTransparent(st.fill);
    const stroked = st.strokeStyle !== 'none' && st.strokeWidth > 0 && !isTransparent(st.stroke);
    const simple = Math.min(o.w, o.h) * z < 6;
    if (filled) {
      const p = b.fill(st.fill);
      if (simple) p.rect(o.x, o.y, o.w, o.h);
      else shapePath(p, o.shapeKind, o.x, o.y, o.w, o.h, false);
    }
    if (stroked) {
      const p = b.stroke(st.stroke, st.strokeWidth);
      if (simple) p.rect(o.x, o.y, o.w, o.h);
      else shapePath(p, o.shapeKind, o.x, o.y, o.w, o.h, false);
    }
    if (!isEditing(rc, o.id, 'text') && st.fontSize * z >= 0.6) {
      const box = shapeTextBoxOf(o);
      textBarsPath(b.bar(), rc.text.peek(o.id), plainLength(o), box, st.textAlign, st.verticalAlign, st.fontSize);
    }
    return true;
  },
  getTextBox(o, field) {
    return field === 'text' ? shapeTextBoxOf(o) : null;
  },
};

// ---------------------------------------------------------------- text

const textRenderer: ObjectRenderer<TextObject> = {
  draw(ctx, o, rc) {
    const st = resolveStyle(o);
    if (st.opacity < 1) ctx.globalAlpha = st.opacity;
    withLocal(ctx, o, () => {
      if (!isTransparent(st.fill)) {
        ctx.fillStyle = st.fill;
        ctx.fillRect(0, 0, o.w, o.h);
      }
      if (isEditing(rc, o.id, 'text') || st.fontSize * rc.zoom < 1.2) return;
      const lay = rc.text.get(o.id, o.text, o.fixedWidth ? o.w : null, st.fontSize, st.fontWeight);
      drawTextLayout(ctx, lay, { x: 0, y: 0, w: o.w, h: o.h }, { color: st.textColor, align: st.textAlign, valign: 'top', zoom: rc.zoom });
    });
    if (st.opacity < 1) ctx.globalAlpha = 1;
  },
  drawLod(b, o, rc) {
    if (o.rotation) return false;
    const st = resolveStyle(o);
    if (st.fontSize * rc.zoom >= 4) return false;
    if (isEditing(rc, o.id, 'text')) return true;
    textBarsPath(b.bar(), rc.text.peek(o.id), plainLength(o), o, st.textAlign, 'top', st.fontSize);
    return true;
  },
  getTextBox(o, field) {
    return field === 'text' ? { x: o.x, y: o.y, w: o.w, h: o.h } : null;
  },
};

// ---------------------------------------------------------------- section / device frame

export const SECTION_TITLE_H = 32;
export const SECTION_TITLE_FONT = 13;

/** 標題文字框：一般區塊在左上角內側；裝置框在外框上方 */
export function sectionTitleBox(o: SectionObject): Rect {
  if (o.frameKind) return { x: o.x + 2, y: o.y - FRAME_TITLE_SPACE + 2, w: Math.max(10, o.w - 4), h: 20 };
  return { x: o.x + 12, y: o.y + 8, w: Math.max(10, o.w - 24), h: 18 };
}

const FR = { bezel: '#e3e7eb', edge: '#9aa5b1', chrome: '#eef1f4', ink: '#2f3a45', mute: '#8a96a3', line: '#d4dae0' };

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string | null, stroke: string | null, lw: number) {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function frameIcon(ctx: CanvasRenderingContext2D, rc: RenderContext, id: string, name: string, x: number, y: number, s: number, color: string) {
  if (s * rc.zoom < 4) return;
  const p = getIconPath(name, () => rc.invalidate(id));
  if (p) drawIcon(ctx, p, x, y, s, color);
}

function statusBar(ctx: CanvasRenderingContext2D, rc: RenderContext, o: SectionObject, x: number, y: number, w: number, h: number, notch: boolean) {
  const z = rc.zoom;
  if (notch) {
    const nw = Math.min(120, w * 0.32);
    rr(ctx, x + (w - nw) / 2, y + 7, nw, 22, 11, FR.ink, null, 1);
  }
  if (12 * z >= 4) {
    const lay = rc.text.plain('frame:time', '9:41', null, 12, 700);
    drawTextLayout(ctx, lay, { x: x + 22, y, w: 60, h }, { color: FR.ink, align: 'left', valign: 'middle', zoom: z });
  }
  // 訊號與電池
  const bx = x + w - 22 - 24;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = FR.ink;
    ctx.fillRect(bx - 28 + i * 4.5, y + h / 2 + 4 - (i + 1) * 2.5, 3, (i + 1) * 2.5);
  }
  rr(ctx, bx, y + h / 2 - 5, 22, 10, 3, null, FR.ink, Math.max(1, 0.8 / z));
  rr(ctx, bx + 2, y + h / 2 - 3, 14, 6, 1.5, FR.ink, null, 1);
}

const sectionRenderer: ObjectRenderer<SectionObject> = {
  draw(ctx, o, rc) {
    const st = resolveStyle(o);
    const z = rc.zoom;
    const lw = Math.max(1, 0.8 / z);
    const content = sectionContentRect(o);
    const detail = Math.min(o.w, o.h) * z > 40;
    switch (o.frameKind) {
      case 'phone': {
        const R = Math.min(48, o.w * 0.13);
        rr(ctx, o.x, o.y, o.w, o.h, R, FR.bezel, FR.edge, Math.max(1.5, lw));
        rr(ctx, o.x + 10, o.y + 10, o.w - 20, o.h - 20, Math.max(0, R - 9), isTransparent(st.fill) ? '#ffffff' : st.fill === '#f1f3f5' ? '#ffffff' : st.fill, null, 1);
        if (detail) {
          statusBar(ctx, rc, o, o.x + 10, o.y + 10, o.w - 20, 34, true);
          rr(ctx, o.x + o.w * 0.34, o.y + o.h - 10 - 13, o.w * 0.32, 5, 2.5, FR.ink, null, 1);
        }
        break;
      }
      case 'tablet': {
        rr(ctx, o.x, o.y, o.w, o.h, 30, FR.bezel, FR.edge, Math.max(1.5, lw));
        rr(ctx, o.x + 16, o.y + 16, o.w - 32, o.h - 32, 12, st.fill === '#f1f3f5' || isTransparent(st.fill) ? '#ffffff' : st.fill, null, 1);
        if (detail) {
          ctx.fillStyle = FR.edge;
          ctx.beginPath();
          ctx.arc(o.x + o.w / 2, o.y + 8, 3, 0, Math.PI * 2);
          ctx.fill();
          statusBar(ctx, rc, o, o.x + 16, o.y + 16, o.w - 32, 24, false);
        }
        break;
      }
      case 'browser': {
        rr(ctx, o.x, o.y, o.w, o.h, 10, '#ffffff', null, 1);
        ctx.save();
        ctx.beginPath();
        roundRectPath(ctx, o.x, o.y, o.w, o.h, 10);
        ctx.clip();
        ctx.fillStyle = FR.chrome;
        ctx.fillRect(o.x, o.y, o.w, 36);
        if (detail) {
          for (let i = 0; i < 3; i++) {
            ctx.fillStyle = '#c5ccd3';
            ctx.beginPath();
            ctx.arc(o.x + 18 + i * 14, o.y + 18, 4.5, 0, Math.PI * 2);
            ctx.fill();
          }
          const tw = Math.min(220, o.w * 0.3);
          rr(ctx, o.x + 72, o.y + 6, tw, 30, 8, '#ffffff', null, 1);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(o.x + 72, o.y + 26, tw, 10);
          if (12 * z >= 4) {
            const t = o.title || rc.labels.frame.browser;
            const lay = rc.text.plain(o.id + ':tab', t, null, 12, 400);
            ctx.save();
            ctx.beginPath();
            ctx.rect(o.x + 84, o.y, tw - 24, 36);
            ctx.clip();
            drawTextLayout(ctx, { ...lay, lines: lay.lines.slice(0, 1) }, { x: o.x + 84, y: o.y + 6, w: tw - 24, h: 30 }, { color: FR.ink, align: 'left', valign: 'middle', zoom: z });
            ctx.restore();
          }
          frameIcon(ctx, rc, o.id, 'ChevronLeft', o.x + 14, o.y + 48, 16, FR.mute);
          frameIcon(ctx, rc, o.id, 'ChevronRight', o.x + 38, o.y + 48, 16, FR.mute);
          frameIcon(ctx, rc, o.id, 'RefreshCw', o.x + 64, o.y + 49, 14, FR.mute);
          rr(ctx, o.x + 92, o.y + 42, Math.max(40, o.w - 108), 28, 14, FR.chrome, null, 1);
          frameIcon(ctx, rc, o.id, 'Lock', o.x + 104, o.y + 49, 13, FR.mute);
          ctx.fillStyle = '#d4dae0';
          ctx.fillRect(o.x + 124, o.y + 53, Math.min(220, o.w * 0.25), 6);
        }
        ctx.fillStyle = FR.line;
        ctx.fillRect(o.x, o.y + 76 - lw, o.w, lw);
        ctx.restore();
        rr(ctx, o.x, o.y, o.w, o.h, 10, null, FR.edge, Math.max(1.25, lw));
        break;
      }
      case 'window': {
        rr(ctx, o.x, o.y, o.w, o.h, 8, '#ffffff', null, 1);
        ctx.save();
        ctx.beginPath();
        roundRectPath(ctx, o.x, o.y, o.w, o.h, 8);
        ctx.clip();
        ctx.fillStyle = FR.chrome;
        ctx.fillRect(o.x, o.y, o.w, 36);
        ctx.fillStyle = FR.line;
        ctx.fillRect(o.x, o.y + 36 - lw, o.w, lw);
        if (detail) {
          // 中性的視窗控制（最小化、最大化、關閉）
          const cy = o.y + 18;
          const xs = [o.x + o.w - 92, o.x + o.w - 60, o.x + o.w - 28];
          ctx.strokeStyle = FR.mute;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(xs[0] - 6, cy);
          ctx.lineTo(xs[0] + 6, cy);
          ctx.rect(xs[1] - 5.5, cy - 5.5, 11, 11);
          ctx.moveTo(xs[2] - 5.5, cy - 5.5);
          ctx.lineTo(xs[2] + 5.5, cy + 5.5);
          ctx.moveTo(xs[2] + 5.5, cy - 5.5);
          ctx.lineTo(xs[2] - 5.5, cy + 5.5);
          ctx.stroke();
          ctx.fillStyle = '#c5ccd3';
          ctx.fillRect(o.x + 16, cy - 7, 14, 14);
          ctx.fillStyle = '#d4dae0';
          ctx.fillRect(o.x + 40, cy - 3, Math.min(160, o.w * 0.2), 6);
        }
        ctx.restore();
        rr(ctx, o.x, o.y, o.w, o.h, 8, null, FR.edge, Math.max(1.25, lw));
        break;
      }
      default:
        rr(ctx, o.x, o.y, o.w, o.h, Math.min(o.w, o.h) * z > 12 ? 10 : 0, st.fill, st.stroke, Math.max(st.strokeWidth, 0.8 / z));
    }
    void content;
    if (isEditing(rc, o.id, 'title')) return;
    const tb = sectionTitleBox(o);
    const title = o.title || (o.frameKind ? rc.labels.frame[o.frameKind] : '');
    if (!title) return;
    if (SECTION_TITLE_FONT * z < 4) {
      if (SECTION_TITLE_FONT * z >= 0.8) {
        ctx.fillStyle = 'rgba(120,130,140,0.4)';
        ctx.fillRect(tb.x, tb.y + 5, Math.min(tb.w, title.length * 9), 8);
      }
      return;
    }
    const lay = rc.text.plain(o.id + ':title', title, null, SECTION_TITLE_FONT, 700);
    ctx.save();
    ctx.beginPath();
    ctx.rect(tb.x, tb.y - 4, tb.w, tb.h + 8);
    ctx.clip();
    drawTextLayout(ctx, { ...lay, lines: lay.lines.slice(0, 1) }, tb, { color: o.frameKind ? '#6b7682' : st.textColor, align: 'left', valign: 'middle', zoom: z });
    ctx.restore();
  },
  hitTest(o, p, _rc, tol) {
    const tb = sectionTitleBox(o);
    if (p.x >= tb.x && p.x <= tb.x + tb.w && p.y >= tb.y && p.y <= tb.y + tb.h) return true;
    if (p.x < o.x - tol || p.x > o.x + o.w + tol || p.y < o.y - tol || p.y > o.y + o.h + tol) return false;
    if (!o.frameKind) {
      if (p.y >= o.y && p.y <= o.y + SECTION_TITLE_H) return true;
      const nearEdge = p.x - o.x < tol || o.x + o.w - p.x < tol || p.y - o.y < tol || o.y + o.h - p.y < tol;
      return nearEdge ? true : 'body';
    }
    // 裝置框：外框與頂端的介面列可以點選拖曳，內容區可以框選
    const c = sectionContentRect(o);
    return p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h ? 'body' : true;
  },
  getTextBox(o, field) {
    return field === 'title' ? sectionTitleBox(o) : null;
  },
};

// ---------------------------------------------------------------- image

const imageRenderer: ObjectRenderer<ImageObject> = {
  draw(ctx, o, rc) {
    const e = rc.images.get(o.assetId);
    withLocal(ctx, o, () => {
      if (e?.status === 'ready' && e.source) {
        const screen = Math.max(o.w, o.h) * rc.zoom * (globalThis.devicePixelRatio || 1);
        const src = e.thumb && screen < 256 && !rc.exporting ? e.thumb : e.source;
        ctx.drawImage(src, 0, 0, o.w, o.h);
        return;
      }
      ctx.fillStyle = '#eef1f4';
      ctx.fillRect(0, 0, o.w, o.h);
      ctx.strokeStyle = '#d4dae0';
      ctx.lineWidth = Math.max(1, 0.8 / rc.zoom);
      ctx.strokeRect(0, 0, o.w, o.h);
      if (13 * rc.zoom >= 4) {
        const label = e?.status === 'error' ? rc.labels.imageError : rc.labels.imageLoading;
        const ip = getIconPath(e?.status === 'error' ? 'CircleAlert' : 'Image');
        if (ip && o.w > 40 && o.h > 40) drawIcon(ctx, ip, o.w / 2 - 12, o.h / 2 - 22, 24, '#8a96a3');
        const lay = rc.text.plain('img:' + label, label, null, 12, 400);
        drawTextLayout(ctx, lay, { x: 0, y: o.h / 2 + 4, w: o.w, h: 18 }, { color: '#8a96a3', align: 'center', valign: 'top', zoom: rc.zoom });
      }
    });
  },
};

// ---------------------------------------------------------------- link card

export function linkOpenBox(o: LinkCardObject): Rect {
  return { x: o.x + o.w - 32, y: o.y + o.h / 2 - 12, w: 24, h: 24 };
}

/** 獨立圖示：Lucide 的 24×24 描邊路徑，等比縮放置中於物件框內 */
const DEFAULT_ICON_COLOR = '#33322d';
const iconRenderer: ObjectRenderer<IconObject> = {
  draw(ctx, o, rc) {
    const size = Math.min(o.w, o.h);
    const color = o.style.stroke && o.style.stroke !== 'transparent' ? o.style.stroke : DEFAULT_ICON_COLOR;
    withLocal(ctx, o, () => {
      const path = getIconPath(o.iconName, () => rc.invalidate(o.id));
      const x = (o.w - size) / 2;
      const y = (o.h - size) / 2;
      if (!path || size * rc.zoom < 4) {
        // 尚未載入或太小：以淡色方塊代替
        ctx.fillStyle = 'rgba(120,130,140,0.25)';
        ctx.fillRect(x + size * 0.15, y + size * 0.15, size * 0.7, size * 0.7);
        return;
      }
      ctx.save();
      ctx.translate(x, y);
      const s = size / 24;
      ctx.scale(s, s);
      ctx.strokeStyle = color;
      // strokeWidth 以 24×24 座標為單位，與 Lucide 的預設線寬 2 一致
      ctx.lineWidth = o.style.strokeWidth ?? 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
      ctx.restore();
    });
  },
  // p 為世界座標（已抵銷旋轉）；整個方框都可點選，圖示的線條很細，只判斷線條會很難點到
  hitTest(o, p, _rc, tol) {
    return p.x >= o.x - tol && p.y >= o.y - tol && p.x <= o.x + o.w + tol && p.y <= o.y + o.h + tol;
  },
};

const linkCardRenderer: ObjectRenderer<LinkCardObject> = {
  draw(ctx, o, rc) {
    const st = resolveStyle(o);
    const z = rc.zoom;
    withLocal(ctx, o, () => {
      ctx.beginPath();
      roundRectPath(ctx, 0, 0, o.w, o.h, z * 8 > 1.5 ? 8 : 0);
      if (z >= 0.5) {
        ctx.save();
        ctx.translate(0, 2);
        ctx.fillStyle = SHADOW_1;
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = st.fill;
      ctx.fill();
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = Math.max(st.strokeWidth, 0.8 / z);
      ctx.stroke();
      const iconSize = Math.min(24, o.h - 16);
      const ip = getIconPath('FileText');
      if (ip && iconSize * z >= 3) drawIcon(ctx, ip, 14, (o.h - iconSize) / 2, iconSize, BRAND);
      const title = o.targetTitle || rc.labels.untitledLink;
      const tx = 14 + iconSize + 10;
      const tw = Math.max(10, o.w - tx - (rc.canOpenLinks ? 40 : 14));
      if (st.fontSize * z >= 4) {
        const lay = rc.text.plain(o.id + ':title', title, null, st.fontSize, 700);
        ctx.save();
        ctx.beginPath();
        ctx.rect(tx, 0, tw, o.h);
        ctx.clip();
        drawTextLayout(ctx, { ...lay, lines: lay.lines.slice(0, 1) }, { x: tx, y: 0, w: tw, h: o.h }, { color: st.textColor, align: 'left', valign: 'middle', zoom: z });
        ctx.restore();
      } else if (st.fontSize * z >= 0.8) {
        ctx.fillStyle = 'rgba(120,130,140,0.4)';
        ctx.fillRect(tx, o.h / 2 - 4, Math.min(tw, title.length * 9), 8);
      }
      if (rc.canOpenLinks && z >= 0.3) {
        const op = getIconPath('ArrowUpRight');
        if (op) drawIcon(ctx, op, o.w - 30, o.h / 2 - 10, 20, '#8a96a3');
      }
    });
  },
  drawLod(b, o, rc) {
    if (o.rotation) return false;
    const st = resolveStyle(o);
    if (st.fontSize * rc.zoom >= 4) return false;
    b.fill('#ffffff').rect(o.x, o.y, o.w, o.h);
    b.stroke(st.stroke, st.strokeWidth).rect(o.x, o.y, o.w, o.h);
    b.bar().rect(o.x + 44, o.y + o.h / 2 - 4, Math.min(o.w - 60, 120), 8);
    return true;
  },
};

// ---------------------------------------------------------------- wireframe / table（基本外觀，之後可由 registerRenderer 替換）

const placeholderRenderer: ObjectRenderer = {
  draw(ctx, o, rc) {
    withLocal(ctx, o, () => {
      ctx.fillStyle = '#f6f7f9';
      ctx.fillRect(0, 0, o.w, o.h);
      ctx.strokeStyle = '#c5ccd3';
      ctx.lineWidth = Math.max(1, 0.8 / rc.zoom);
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(0, 0, o.w, o.h);
      ctx.setLineDash([]);
      if (12 * rc.zoom >= 4) {
        const lay = rc.text.plain('ph:' + rc.labels.unsupported, rc.labels.unsupported, o.w - 8, 12, 400);
        drawTextLayout(ctx, lay, { x: 4, y: 0, w: o.w - 8, h: o.h }, { color: '#8a96a3', align: 'center', valign: 'middle', zoom: rc.zoom });
      }
    });
  },
};

const groupRenderer: ObjectRenderer = {
  draw() {
    /* 群組本身沒有外觀 */
  },
  drawLod() {
    return true;
  },
  hitTest() {
    return false;
  },
};

// ---------------------------------------------------------------- connector

export const LABEL_FONT = 13;
export const LABEL_MAX_W = 240;

export function connectorRoute(c: ConnectorObject, rc: RenderContext): Route {
  return rc.routeOf ? rc.routeOf(c) : rc.routes.get(c);
}

export function connectorLabelBox(c: ConnectorObject, rc: RenderContext, route = connectorRoute(c, rc)): Rect {
  const lay = rc.text.plain(c.id + ':label', c.label || ' ', LABEL_MAX_W, LABEL_FONT, 400);
  const w = Math.max(lay.width, 24) + 12;
  const h = lay.height + 6;
  return { x: route.mid.x - w / 2, y: route.mid.y - h / 2, w, h };
}

export function traceRoute(p: { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void }, r: Route) {
  const pts = r.points;
  p.moveTo(pts[0].x, pts[0].y);
  if (r.curved) p.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
  else for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
}

/** 平滑轉角的折線（圓角半徑 r） */
function traceRounded(ctx: CanvasRenderingContext2D, pts: Point[], radius: number) {
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const r = Math.min(radius, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    ctx.arcTo(b.x, b.y, c.x, c.y, r);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

function drawArrow(ctx: CanvasRenderingContext2D, kind: ArrowHead, tip: Point, dir: Point, size: number, color: string, lw: number) {
  if (kind === 'none') return;
  const ux = dir.x;
  const uy = dir.y;
  const px = -uy;
  const py = ux;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  if (kind === 'arrow') {
    ctx.moveTo(tip.x - ux * size + px * size * 0.55, tip.y - uy * size + py * size * 0.55);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ux * size - px * size * 0.55, tip.y - uy * size - py * size * 0.55);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  } else if (kind === 'triangle') {
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ux * size + px * size * 0.5, tip.y - uy * size + py * size * 0.5);
    ctx.lineTo(tip.x - ux * size - px * size * 0.5, tip.y - uy * size - py * size * 0.5);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'circle') {
    const r = size * 0.4;
    ctx.arc(tip.x - ux * r, tip.y - uy * r, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'diamond') {
    const h = size * 0.5;
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ux * h + px * h * 0.7, tip.y - uy * h + py * h * 0.7);
    ctx.lineTo(tip.x - ux * size, tip.y - uy * size);
    ctx.lineTo(tip.x - ux * h - px * h * 0.7, tip.y - uy * h - py * h * 0.7);
    ctx.closePath();
    ctx.fill();
  }
}

/** 線身要從箭頭尖端往內縮的長度：讓實心箭頭蓋住線尾，線（尤其是虛線的圓頭）不會從尖端凸出 */
export function arrowInset(kind: ArrowHead, size: number): number {
  if (kind === 'triangle') return size * 0.6;
  if (kind === 'diamond') return size * 0.5;
  if (kind === 'circle') return size * 0.4;
  return 0;
}

/** 把路徑兩端沿切線往內縮（不超過該端第一段長度的一半），曲線只移動端點 */
export function insetRoute(r: Route, start: number, end: number): Route {
  if (!start && !end) return r;
  const pts = r.points.slice();
  const move = (i: number, j: number, dir: Point, d: number) => {
    if (!d) return;
    const len = Math.hypot(r.points[j].x - r.points[i].x, r.points[j].y - r.points[i].y);
    const k = Math.min(d, len / 2);
    pts[i] = { x: pts[i].x - dir.x * k, y: pts[i].y - dir.y * k };
  };
  const n = pts.length;
  move(n - 1, n - 2, r.endTangent, end);
  move(0, 1, r.startTangent, start);
  return { ...r, points: pts };
}

const connectorRenderer: ObjectRenderer<ConnectorObject> = {
  draw(ctx, o, rc) {
    const st = resolveStyle(o);
    const z = rc.zoom;
    const route = connectorRoute(o, rc);
    const lw = Math.max(st.strokeWidth, 0.8 / z);
    ctx.strokeStyle = st.stroke;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const size = 9 + st.strokeWidth * 2;
    const showArrows = size * z >= 2;
    const body = showArrows ? insetRoute(route, arrowInset(o.startArrow, size), arrowInset(o.endArrow, size)) : route;
    if (o.dashed) ctx.setLineDash([lw * 4, lw * 3]);
    ctx.beginPath();
    if (body.curved || body.points.length < 3 || z < 0.3) traceRoute(ctx, body);
    else traceRounded(ctx, body.points, 8);
    ctx.stroke();
    if (o.dashed) ctx.setLineDash([]);
    ctx.lineCap = 'butt';
    if (showArrows) {
      const n = route.points.length;
      drawArrow(ctx, o.endArrow, route.points[n - 1], route.endTangent, size, st.stroke, lw);
      drawArrow(ctx, o.startArrow, route.points[0], route.startTangent, size, st.stroke, lw);
    }
    if (o.label && !isEditing(rc, o.id, 'label')) {
      const box = connectorLabelBox(o, rc, route);
      if (LABEL_FONT * z < 4) {
        if (LABEL_FONT * z >= 0.8) {
          ctx.fillStyle = 'rgba(120,130,140,0.4)';
          ctx.fillRect(box.x + 6, box.y + box.h * 0.3, box.w - 12, box.h * 0.4);
        }
        return;
      }
      ctx.fillStyle = rc.exporting ? '#ffffff' : CANVAS_BG;
      ctx.beginPath();
      roundRectPath(ctx, box.x, box.y, box.w, box.h, 4);
      ctx.fill();
      const lay = rc.text.plain(o.id + ':label', o.label, LABEL_MAX_W, LABEL_FONT, 400);
      drawTextLayout(ctx, lay, { x: box.x + 6, y: box.y + 3, w: box.w - 12, h: box.h - 6 }, { color: st.textColor, align: 'center', valign: 'middle', zoom: z });
    }
  },
  drawLod(b, o, rc) {
    const st = resolveStyle(o);
    const route = connectorRoute(o, rc);
    traceRoute(b.stroke(st.stroke, st.strokeWidth, o.dashed ? `${st.strokeWidth * 4},${st.strokeWidth * 3}` : ''), route);
    return true;
  },
  hitTest(o, p, rc, tol) {
    const r = connectorRoute(o, rc);
    if (r.curved) {
      let prev = r.points[0];
      for (let i = 1; i <= 24; i++) {
        const q = bezierPoint(r.points, i / 24);
        if (distToSegment(p, prev, q) <= tol) return true;
        prev = q;
      }
    } else {
      for (let i = 1; i < r.points.length; i++) if (distToSegment(p, r.points[i - 1], r.points[i]) <= tol) return true;
    }
    if (o.label) {
      const b = connectorLabelBox(o, rc, r);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return true;
    }
    return false;
  },
  getTextBox(o, field, _k, rc) {
    if (field !== 'label') return null;
    const b = connectorLabelBox(o, rc);
    return { x: b.x + 6, y: b.y + 3, w: Math.max(b.w - 12, 80), h: b.h - 6 };
  },
};

registerRenderer('shape', shapeRenderer);
registerRenderer('text', textRenderer);
registerRenderer('section', sectionRenderer);
registerRenderer('image', imageRenderer);
registerRenderer('link_card', linkCardRenderer);
registerRenderer('icon', iconRenderer);
registerRenderer('wireframe', wireframeRenderer);
registerRenderer('table', tableRenderer);
registerRenderer('group', groupRenderer);
registerRenderer('connector', connectorRenderer);

// ---------------------------------------------------------------- 場景

/** 低細節模式的門檻：預設字級在螢幕上小於 4px */
export function isFar(zoom: number): boolean {
  return 14 * zoom < 4;
}

/**
 * 依順序畫出物件（呼叫端負責裁切與排序，ctx 已設定為世界座標）。
 * 低縮放時盡量放進批次；遇到無法批次的物件先送出批次以維持層級。
 */
export function drawObjects(ctx: CanvasRenderingContext2D, objs: BoardObject[], rc: RenderContext) {
  const far = isFar(rc.zoom);
  const batch = far ? new LodBatch(rc.zoom) : null;
  for (const o of objs) {
    const r = getRenderer(o.type);
    if (batch && r.drawLod) {
      if (o.type === 'section') batch.flush(ctx);
      if (r.drawLod(batch, o, rc)) continue;
    }
    if (batch) batch.flush(ctx);
    r.draw(ctx, o, rc);
  }
  batch?.flush(ctx);
}

/** 命中測試：point 為世界座標；回傳命中結果 */
export function hitObject(o: BoardObject, p: Point, rc: RenderContext, tol: number): boolean | 'body' {
  const r = getRenderer(o.type);
  const local = o.type === 'connector' ? p : toLocal(o, p);
  if (r.hitTest) return r.hitTest(o, local, rc, tol);
  return local.x >= o.x - tol && local.x <= o.x + o.w + tol && local.y >= o.y - tol && local.y <= o.y + o.h + tol;
}

export function textBoxOf(o: BoardObject, field: EditField, cellKey: string | undefined, rc: RenderContext): Rect | null {
  const r = getRenderer(o.type);
  return r.getTextBox ? r.getTextBox(o, field, cellKey, rc) : null;
}

export { fontString };
