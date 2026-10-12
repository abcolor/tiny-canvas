import type { TextBlock } from '@tinycanvas/shared';
import { RICH_TEXT_STYLE } from '@tinycanvas/shared';
import { TEXT_METRICS, layoutRichText, plainBlocks, taskCheckboxRect, type LayoutLine, type Measurer, type TextLayout } from '../text/layout';
import { roundRectPath } from './shapes';
import type { FontLoader } from '../text/measure';
import type { Rect } from '../geometry';
import { LINK_COLOR } from '../style';

function sameBlocks(a: TextBlock[], b: TextBlock[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.kind !== y.kind || x.level !== y.level || x.depth !== y.depth || x.index !== y.index || !!x.checked !== !!y.checked || x.runs.length !== y.runs.length) return false;
    for (let j = 0; j < x.runs.length; j++) {
      const r = x.runs[j];
      const s = y.runs[j];
      if (
        r.text !== s.text ||
        !!r.bold !== !!s.bold ||
        !!r.italic !== !!s.italic ||
        !!r.strike !== !!s.strike ||
        !!r.code !== !!s.code ||
        (r.highlight ?? null) !== (s.highlight ?? null) ||
        (r.link ?? null) !== (s.link ?? null)
      )
        return false;
    }
  }
  return true;
}

interface Entry {
  blocks: TextBlock[];
  maxWidth: number | null;
  fontSize: number;
  fontWeight: number;
  gen: number;
  layout: TextLayout;
}

/**
 * 排版快取：key 為物件 id（加上欄位）。文字內容、寬度、字級與量測世代相同時重用。
 * 快照在物件移動時會換新，但文字內容相同，因此以結構比較而非參考比較。
 */
export class TextLayoutCache {
  private map = new Map<string, Entry>();
  gen = 0;

  constructor(
    private measurer: Measurer,
    private fonts: FontLoader | null,
  ) {}

  clear() {
    this.map.clear();
    this.gen++;
  }

  delete(key: string) {
    this.map.delete(key);
  }

  peek(key: string): TextLayout | null {
    return this.map.get(key)?.layout ?? null;
  }

  get(key: string, blocks: TextBlock[], maxWidth: number | null, fontSize: number, fontWeight: 400 | 700): TextLayout {
    const e = this.map.get(key);
    if (e && e.gen === this.gen && e.maxWidth === maxWidth && e.fontSize === fontSize && e.fontWeight === fontWeight && sameBlocks(e.blocks, blocks)) {
      e.blocks = blocks;
      return e.layout;
    }
    const layout = layoutRichText(blocks, { maxWidth, fontSize, fontWeight }, this.measurer);
    if (this.fonts) {
      for (const line of layout.lines) {
        for (const s of line.segments) this.fonts.request(s.font, s.text);
        if (line.marker && line.markerFont) this.fonts.request(line.markerFont, line.marker);
      }
    }
    this.map.set(key, { blocks, maxWidth, fontSize, fontWeight, gen: this.gen, layout });
    if (this.map.size > 60000) this.map.clear();
    return layout;
  }

  plain(key: string, text: string, maxWidth: number | null, fontSize: number, fontWeight: 400 | 700): TextLayout {
    return this.get(key, plainBlocks(text), maxWidth, fontSize, fontWeight);
  }
}

export interface TextDrawOptions {
  color: string;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  /** 螢幕上的實際縮放（世界 → CSS px） */
  zoom: number;
  /** 文字在螢幕上小於這個高度（px）時畫成灰色長條 */
  barThreshold?: number;
  barColor?: string;
}

function textTop(layout: TextLayout, box: Rect, valign: string): number {
  return valign === 'top' ? box.y : valign === 'bottom' ? box.y + box.h - layout.height : box.y + (box.h - layout.height) / 2;
}

/** 行的左緣（世界座標；不含縮排）。程式碼區塊的行一律靠左 */
function lineLeft(layout: TextLayout, line: LayoutLine, box: Rect, align: string): number {
  if (line.codeBlock !== null) return codeBlockLeft(layout, box, align);
  const full = line.width + line.indent;
  return align === 'left' ? box.x : align === 'right' ? box.x + box.w - full : box.x + (box.w - full) / 2;
}

/** 程式碼區塊一律佔滿文字框寬度、靠左 */
function codeBlockLeft(_layout: TextLayout, box: Rect, _align: string): number {
  return box.x;
}

/** 文字框內第幾個核取方塊被點到（point 為世界座標，未旋轉）；沒點到回傳 null */
export function taskAt(layout: TextLayout, box: Rect, align: string, valign: string, p: { x: number; y: number }, slop = 3): number | null {
  const top = textTop(layout, box, valign);
  for (const line of layout.lines) {
    if (!line.task) continue;
    const r = taskCheckboxRect(line);
    const x = lineLeft(layout, line, box, align) + r.x;
    const y = top + r.y;
    if (p.x >= x - slop && p.x <= x + r.size + slop && p.y >= y - slop && p.y <= y + r.size + slop) return line.task.ordinal;
  }
  return null;
}

function drawCheckbox(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, checked: boolean, zoom: number) {
  const lw = Math.max(TEXT_METRICS.checkboxBorder, 0.8 / zoom);
  ctx.beginPath();
  if (checked) {
    roundRectPath(ctx, x, y, size, size, TEXT_METRICS.checkboxRadius);
    ctx.fillStyle = RICH_TEXT_STYLE.checkboxChecked;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + size * 0.24, y + size * 0.52);
    ctx.lineTo(x + size * 0.43, y + size * 0.7);
    ctx.lineTo(x + size * 0.77, y + size * 0.32);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, size * 0.13);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  } else {
    // 邊框畫在方塊內側，外緣等於 size
    roundRectPath(ctx, x + lw / 2, y + lw / 2, size - lw, size - lw, Math.max(0, TEXT_METRICS.checkboxRadius - lw / 2));
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = RICH_TEXT_STYLE.checkboxBorder;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

/** 依對齊方式在 box 內畫出排版結果（box 為世界座標） */
export function drawTextLayout(ctx: CanvasRenderingContext2D, layout: TextLayout, box: Rect, o: TextDrawOptions) {
  const top = textTop(layout, box, o.valign);
  const threshold = o.barThreshold ?? 4;
  let font = '';
  const setFont = (f: string) => {
    if (f !== font) {
      ctx.font = f;
      font = f;
    }
  };
  // 程式碼區塊的底色
  if (layout.codeBlocks?.length) {
    const left = codeBlockLeft(layout, box, o.align);
    const w = Math.max(box.w, ...layout.codeBlocks.map((c) => c.width));
    ctx.fillStyle = RICH_TEXT_STYLE.codeBlockBg;
    for (const c of layout.codeBlocks) {
      ctx.beginPath();
      roundRectPath(ctx, left, top + c.y, w, c.height, TEXT_METRICS.codeBlockRadius);
      ctx.fill();
    }
  }
  for (const line of layout.lines) {
    const left = lineLeft(layout, line, box, o.align);
    if (line.fontSize * o.zoom < threshold) {
      if (line.width > 0) {
        ctx.fillStyle = o.barColor ?? 'rgba(120,130,140,0.35)';
        ctx.fillRect(left + line.indent, top + line.y + line.height * 0.3, line.width, line.height * 0.4);
      }
      continue;
    }
    const by = top + line.baseline;
    const lineTop = top + line.y;
    if (line.task) {
      const r = taskCheckboxRect(line);
      drawCheckbox(ctx, left + r.x, top + r.y, r.size, line.task.checked, o.zoom);
    }
    if (line.marker && line.markerFont) {
      setFont(line.markerFont);
      ctx.fillStyle = o.color;
      ctx.textAlign = 'right';
      ctx.fillText(line.marker, left + line.indent - 5, by);
      ctx.textAlign = 'left';
    }
    // 底色：螢光標記、行內程式碼
    for (const s of line.segments) {
      if (s.highlight) {
        ctx.fillStyle = s.highlight;
        const sx = left + line.indent + s.x - (s.code ? TEXT_METRICS.inlineCodePad : 0);
        ctx.fillRect(sx, lineTop + line.height * 0.1, s.width, line.height * 0.8);
      }
      if (s.code) {
        const em = line.fontSize;
        ctx.fillStyle = RICH_TEXT_STYLE.inlineCodeBg;
        ctx.beginPath();
        roundRectPath(ctx, left + line.indent + s.x - TEXT_METRICS.inlineCodePad, lineTop + (line.height - em * 1.25) / 2, s.width, em * 1.25, TEXT_METRICS.inlineCodeRadius);
        ctx.fill();
      }
    }
    for (const s of line.segments) {
      setFont(s.font);
      ctx.fillStyle = s.link ? LINK_COLOR : o.color;
      const x = left + line.indent + s.x;
      ctx.fillText(s.text, x, by);
      const textW = s.code ? s.width - TEXT_METRICS.inlineCodePad * 2 : s.width;
      const thick = Math.max(1 / o.zoom, line.fontSize * 0.06);
      if (s.link) ctx.fillRect(x, by + line.fontSize * 0.12, textW, thick);
      if (s.strike) {
        ctx.fillStyle = o.color;
        ctx.fillRect(x, by - line.fontSize * 0.3 - thick / 2, textW, thick);
      }
    }
  }
}

/** 低細節：每一行畫成一條灰色長條；沒有快取的排版時以字數估算 */
export function textBarsPath(path: Path2D, layout: TextLayout | null, plainLen: number, box: Rect, align: string, valign: string, fontSize: number) {
  if (layout) {
    const top = valign === 'top' ? box.y : valign === 'bottom' ? box.y + box.h - layout.height : box.y + (box.h - layout.height) / 2;
    for (const line of layout.lines) {
      if (line.width <= 0) continue;
      const full = line.width + line.indent;
      const left = align === 'left' ? box.x : align === 'right' ? box.x + box.w - full : box.x + (box.w - full) / 2;
      path.rect(left + line.indent, top + line.y + line.height * 0.3, line.width, line.height * 0.4);
    }
    return;
  }
  if (plainLen <= 0) return;
  const lh = fontSize * 1.4;
  const total = plainLen * fontSize * 0.8;
  const lines = Math.max(1, Math.min(Math.floor(box.h / lh), Math.ceil(total / Math.max(1, box.w))));
  const height = lines * lh;
  const top = valign === 'top' ? box.y : valign === 'bottom' ? box.y + box.h - height : box.y + (box.h - height) / 2;
  for (let i = 0; i < lines; i++) {
    const w = i === lines - 1 ? Math.min(box.w, total - box.w * (lines - 1)) : box.w;
    const left = align === 'left' ? box.x : align === 'right' ? box.x + box.w - w : box.x + (box.w - w) / 2;
    path.rect(left, top + i * lh + lh * 0.3, Math.max(2, w), lh * 0.4);
  }
}
