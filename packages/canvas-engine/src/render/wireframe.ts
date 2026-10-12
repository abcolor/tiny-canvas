// 線框圖元件（見 SPEC.md 第 4.2 節）：低保真風格，灰階加一個強調色（品牌青綠）。
// 每種元件有預設尺寸、預設文字與 props；主要文字存在物件的 `text`（可編輯、可搜尋），其他結構化項目放在 props。
import type { Point, TextBlock, WireframeKind, WireframeObject } from '@tinycanvas/shared';
import { WIREFRAME_KINDS } from '@tinycanvas/shared';
import type { Rect } from '../geometry';
import type { WireframeContent } from '../types';
import { BRAND } from '../style';
import { roundRectPath } from './shapes';
import { drawTextLayout } from './text';
import { drawIcon, getIconPath } from './icons';
import type { LodBatch, ObjectRenderer, RenderContext } from './draw';

// ---------------------------------------------------------------- 調色

export const WF = {
  ink: '#2f3a45',
  text: '#46525e',
  mute: '#8a96a3',
  line: '#c5ccd3',
  soft: '#eef1f4',
  softer: '#f6f7f9',
  white: '#ffffff',
  accent: BRAND,
  accentSoft: '#e3f2fc',
  radius: 6,
  stroke: 1,
};

// ---------------------------------------------------------------- 預設值

export interface WireframeDefaults {
  w: number;
  h: number;
  text: string;
  props: Record<string, unknown>;
}

const D = (w: number, h: number, text = '', props: Record<string, unknown> = {}): WireframeDefaults => ({ w, h, text, props });

export const WIREFRAME_DEFAULTS: Record<WireframeKind, WireframeDefaults> = {
  button: D(120, 40, '按鈕'),
  button_secondary: D(120, 40, '取消'),
  link_button: D(96, 32, '了解更多'),
  icon_button: D(40, 40, '', { icon: 'Plus' }),
  input: D(240, 40, '請輸入…'),
  textarea: D(240, 96, '請輸入內容…'),
  search: D(240, 40, '搜尋…'),
  select: D(200, 40, '選項'),
  checkbox: D(140, 24, '核取方塊', { checked: true }),
  radio: D(120, 24, '選項 A', { checked: true }),
  switch: D(120, 24, '開關', { checked: true }),
  slider: D(200, 24, '', { value: 0.5 }),
  stepper: D(120, 36, '1'),
  tabs: D(320, 40, '', { items: ['分頁一', '分頁二', '分頁三'], active: 0 }),
  segmented: D(240, 36, '', { items: ['日', '週', '月'], active: 0 }),
  navbar: D(640, 56, '網站名稱', { items: ['首頁', '產品', '價格', '關於'] }),
  sidebar: D(200, 400, '選單', { items: ['儀表板', '專案', '團隊', '報表', '設定'], active: 0 }),
  breadcrumb: D(280, 24, '', { items: ['首頁', '分類', '目前頁面'] }),
  pagination: D(240, 32, '', { pages: 5, active: 1 }),
  card: D(240, 200, '卡片標題'),
  list: D(240, 176, '', { items: ['項目一', '項目二', '項目三', '項目四'] }),
  table: D(320, 160, '', { columns: ['名稱', '狀態', '日期'], rows: 3 }),
  image_placeholder: D(200, 140),
  video_placeholder: D(240, 136),
  avatar: D(48, 48),
  badge: D(40, 24, '新'),
  tag: D(72, 24, '標籤'),
  modal: D(360, 220, '對話框標題', { body: '對話框的說明文字，請確認後再繼續。', buttons: ['取消', '確定'] }),
  toast: D(280, 48, '已儲存變更'),
  tooltip: D(140, 44, '提示文字'),
  progress: D(200, 8, '', { value: 0.6 }),
  spinner: D(32, 32),
  divider: D(240, 16),
  heading: D(240, 36, '標題'),
  paragraph: D(280, 64, '這是一段說明文字，用來表示頁面上的內容。'),
  label: D(96, 20, '欄位名稱'),
  date_picker: D(240, 40, '2026/01/01'),
  accordion: D(280, 136, '', { items: ['項目一', '項目二', '項目三'], open: 0 }),
  menu: D(160, 128, '', { items: ['編輯', '複製', '刪除'] }),
  chart_placeholder: D(240, 160),
  map_placeholder: D(240, 160),
  rating: D(120, 24, '', { value: 3, max: 5 }),
};

/** 插入新元件時的預設欄位（尺寸、文字、props）；`content` 為依介面語系覆寫的文字 */
export function wireframeDefaults(kind: WireframeKind, content?: WireframeContent): WireframeDefaults {
  const d = WIREFRAME_DEFAULTS[kind] ?? D(160, 40);
  const props = JSON.parse(JSON.stringify(d.props)) as Record<string, unknown>;
  if (!content) return { ...d, props };
  const { text, ...rest } = content;
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) props[k] = Array.isArray(v) ? [...v] : v;
  return { ...d, text: text ?? d.text, props };
}

// ---------------------------------------------------------------- 主要文字的位置

interface LabelSpec {
  box: Rect;
  size: number;
  weight: 400 | 700;
  color: string;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  wrap: boolean;
}

/** 主要文字（object.text）的文字框，區域座標；沒有主要文字的元件回傳 null */
export function wireframeLabel(o: Pick<WireframeObject, 'componentKind' | 'w' | 'h' | 'style'>): LabelSpec | null {
  const { w, h } = o;
  const tc = o.style?.textColor;
  const L = (x: number, y: number, bw: number, bh: number, size: number, weight: 400 | 700, color: string, align: LabelSpec['align'] = 'left', valign: LabelSpec['valign'] = 'middle', wrap = false): LabelSpec => ({
    box: { x, y, w: Math.max(1, bw), h: Math.max(1, bh) },
    size: o.style?.fontSize ?? size,
    weight,
    color: tc ?? color,
    align,
    valign,
    wrap,
  });
  switch (o.componentKind) {
    case 'button':
      return L(8, 0, w - 16, h, 14, 700, WF.white, 'center');
    case 'button_secondary':
      return L(8, 0, w - 16, h, 14, 400, WF.ink, 'center');
    case 'link_button':
      return L(4, 0, w - 8, h, 14, 400, WF.accent, 'center');
    case 'input':
      return L(12, 0, w - 24, h, 14, 400, WF.mute);
    case 'textarea':
      return L(12, 10, w - 24, h - 20, 14, 400, WF.mute, 'left', 'top', true);
    case 'search':
      return L(36, 0, w - 48, h, 14, 400, WF.mute);
    case 'select':
      return L(12, 0, w - 44, h, 14, 400, WF.ink);
    case 'date_picker':
      return L(12, 0, w - 48, h, 14, 400, WF.ink);
    case 'checkbox':
    case 'radio':
      return L(24, 0, w - 24, h, 14, 400, WF.ink);
    case 'switch':
      return L(46, 0, w - 46, h, 14, 400, WF.ink);
    case 'stepper':
      return L(h, 0, w - 2 * h, h, 14, 400, WF.ink, 'center');
    case 'navbar':
      return L(56, 0, Math.min(200, w * 0.35), h, 16, 700, WF.ink);
    case 'sidebar':
      return L(16, 12, w - 32, 28, 14, 700, WF.ink);
    case 'card':
      return L(12, Math.round(h * 0.5) + 10, w - 24, 22, 15, 700, WF.ink, 'left', 'top');
    case 'modal':
      return L(20, 14, w - 64, 28, 16, 700, WF.ink);
    case 'toast':
      return L(40, 0, w - 52, h, 14, 400, WF.white);
    case 'tooltip':
      return L(8, 0, w - 16, h - 8, 13, 400, WF.white, 'center');
    case 'badge':
      return L(4, 0, w - 8, h, 12, 700, WF.white, 'center');
    case 'tag':
      return L(8, 0, w - 16, h, 12, 400, WF.text, 'center');
    case 'heading':
      return L(0, 0, w, h, 24, 700, WF.ink, 'left', 'middle', true);
    case 'paragraph':
      return L(0, 0, w, h, 14, 400, WF.text, 'left', 'top', true);
    case 'label':
      return L(0, 0, w, h, 12, 700, WF.text);
    default:
      return null;
  }
}

export function wireframeHasText(kind: WireframeKind): boolean {
  return wireframeLabel({ componentKind: kind, w: 100, h: 40, style: {} }) !== null;
}

// ---------------------------------------------------------------- 繪圖小工具

type Ctx = CanvasRenderingContext2D;

function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | null, stroke: string | null, lw = WF.stroke, z = 1) {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r * z >= 0.75 ? r : 0);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(lw, 0.8 / z);
    ctx.stroke();
  }
}

function circle(ctx: Ctx, cx: number, cy: number, r: number, fill: string | null, stroke: string | null, lw = WF.stroke) {
  ctx.beginPath();
  ctx.moveTo(cx + r, cy);
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
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

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, lw = WF.stroke) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** 代表文字的灰色長條 */
function bar(ctx: Ctx, x: number, y: number, w: number, h = 6, color = WF.soft) {
  if (w <= 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fill();
}

function icon(ctx: Ctx, rc: RenderContext, id: string, name: string, x: number, y: number, size: number, color: string) {
  if (size * rc.zoom < 3) return;
  const p = getIconPath(name, () => rc.invalidate(id));
  if (p) drawIcon(ctx, p, x, y, size, color);
}

function text(ctx: Ctx, rc: RenderContext, key: string, s: string, box: Rect, size: number, color: string, align: 'left' | 'center' | 'right' = 'left', weight: 400 | 700 = 400) {
  if (!s || size * rc.zoom < 1) return;
  const lay = rc.text.plain('wf:' + key + ':' + s, s, null, size, weight);
  drawTextLayout(ctx, { ...lay, lines: lay.lines.slice(0, 1) }, box, { color, align, valign: 'middle', zoom: rc.zoom });
}

function mainText(ctx: Ctx, rc: RenderContext, o: WireframeObject, spec: LabelSpec) {
  const e = rc.editing;
  if (e && e.id === o.id && e.field === 'text') return;
  if (spec.size * rc.zoom < 1) return;
  const blocks: TextBlock[] = o.text;
  const lay = rc.text.get(o.id, blocks, spec.wrap ? spec.box.w : null, spec.size, spec.weight);
  const clip = !spec.wrap;
  if (clip) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(spec.box.x, 0, spec.box.w, o.h);
    ctx.clip();
  }
  drawTextLayout(ctx, clip ? { ...lay, lines: lay.lines.slice(0, 1), height: lay.lines[0]?.height ?? lay.height } : lay, spec.box, {
    color: spec.color,
    align: spec.align,
    valign: spec.valign,
    zoom: rc.zoom,
  });
  if (clip) ctx.restore();
}

const items = (o: WireframeObject, fallback: string[]): string[] => {
  const v = o.props?.items;
  return Array.isArray(v) ? v.map((x) => String(x)) : fallback;
};
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function check(ctx: Ctx, x: number, y: number, s: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(x + s * 0.22, y + s * 0.52);
  ctx.lineTo(x + s * 0.42, y + s * 0.72);
  ctx.lineTo(x + s * 0.78, y + s * 0.3);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function starPath(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// ---------------------------------------------------------------- 各元件（區域座標，原點為元件左上角）

type Painter = (ctx: Ctx, o: WireframeObject, rc: RenderContext) => void;

const P: Record<WireframeKind, Painter> = {
  button: (ctx, o, rc) => rrect(ctx, 0, 0, o.w, o.h, WF.radius, o.style.fill ?? WF.accent, null, 1, rc.zoom),
  button_secondary: (ctx, o, rc) => rrect(ctx, 0, 0, o.w, o.h, WF.radius, o.style.fill ?? WF.white, o.style.stroke ?? WF.line, 1, rc.zoom),
  link_button: (ctx, o) => {
    const lay = mainLayout(o);
    if (lay) line(ctx, o.w / 2 - Math.min(lay, o.w - 8) / 2, o.h / 2 + 9, o.w / 2 + Math.min(lay, o.w - 8) / 2, o.h / 2 + 9, WF.accent);
  },
  icon_button: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, WF.radius, WF.white, WF.line, 1, rc.zoom);
    const s = Math.min(o.w, o.h) * 0.5;
    icon(ctx, rc, o.id, String(o.props.icon ?? 'Plus'), (o.w - s) / 2, (o.h - s) / 2, s, WF.ink);
  },
  input: (ctx, o, rc) => rrect(ctx, 0, 0, o.w, o.h, 4, WF.white, WF.line, 1, rc.zoom),
  textarea: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, 4, WF.white, WF.line, 1, rc.zoom);
    line(ctx, o.w - 12, o.h - 4, o.w - 4, o.h - 12, WF.mute);
    line(ctx, o.w - 8, o.h - 4, o.w - 4, o.h - 8, WF.mute);
  },
  search: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, o.h / 2, WF.softer, WF.line, 1, rc.zoom);
    icon(ctx, rc, o.id, 'Search', 12, o.h / 2 - 8, 16, WF.mute);
  },
  select: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, 4, WF.white, WF.line, 1, rc.zoom);
    icon(ctx, rc, o.id, 'ChevronDown', o.w - 28, o.h / 2 - 8, 16, WF.text);
  },
  date_picker: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, 4, WF.white, WF.line, 1, rc.zoom);
    icon(ctx, rc, o.id, 'Calendar', o.w - 30, o.h / 2 - 8, 16, WF.text);
  },
  checkbox: (ctx, o, rc) => {
    const y = (o.h - 16) / 2;
    const on = !!o.props.checked;
    rrect(ctx, 0, y, 16, 16, 3, on ? WF.accent : WF.white, on ? null : WF.mute, 1.25, rc.zoom);
    if (on) check(ctx, 0, y, 16, WF.white);
  },
  radio: (ctx, o) => {
    const cy = o.h / 2;
    const on = !!o.props.checked;
    circle(ctx, 8, cy, 7.5, WF.white, on ? WF.accent : WF.mute, on ? 1.5 : 1.25);
    if (on) circle(ctx, 8, cy, 4, WF.accent, null);
  },
  switch: (ctx, o, rc) => {
    const y = (o.h - 20) / 2;
    const on = !!o.props.checked;
    rrect(ctx, 0, y, 36, 20, 10, on ? WF.accent : WF.line, null, 1, rc.zoom);
    circle(ctx, on ? 26 : 10, y + 10, 8, WF.white, null);
  },
  slider: (ctx, o, rc) => {
    const v = clamp01(num(o.props.value, 0.5));
    const cy = o.h / 2;
    const x0 = 8;
    const x1 = o.w - 8;
    rrect(ctx, x0, cy - 2, x1 - x0, 4, 2, WF.line, null, 1, rc.zoom);
    rrect(ctx, x0, cy - 2, (x1 - x0) * v, 4, 2, WF.accent, null, 1, rc.zoom);
    circle(ctx, x0 + (x1 - x0) * v, cy, 8, WF.white, WF.accent, 1.5);
  },
  stepper: (ctx, o, rc) => {
    const s = o.h;
    rrect(ctx, 0, 0, o.w, o.h, 4, WF.white, WF.line, 1, rc.zoom);
    line(ctx, s, 0, s, o.h, WF.line);
    line(ctx, o.w - s, 0, o.w - s, o.h, WF.line);
    icon(ctx, rc, o.id, 'Minus', s / 2 - 7, o.h / 2 - 7, 14, WF.text);
    icon(ctx, rc, o.id, 'Plus', o.w - s / 2 - 7, o.h / 2 - 7, 14, WF.text);
  },
  tabs: (ctx, o, rc) => {
    const list = items(o, ['分頁一', '分頁二', '分頁三']);
    const active = num(o.props.active, 0);
    const tw = o.w / Math.max(1, list.length);
    line(ctx, 0, o.h - 0.5, o.w, o.h - 0.5, WF.line);
    list.forEach((s, i) => {
      text(ctx, rc, o.id + i, s, { x: i * tw, y: 0, w: tw, h: o.h }, 14, i === active ? WF.accent : WF.text, 'center', i === active ? 700 : 400);
      if (i === active) rrect(ctx, i * tw + 8, o.h - 2.5, tw - 16, 2.5, 1, WF.accent, null, 1, rc.zoom);
    });
  },
  segmented: (ctx, o, rc) => {
    const list = items(o, ['日', '週', '月']);
    const active = num(o.props.active, 0);
    const tw = (o.w - 6) / Math.max(1, list.length);
    rrect(ctx, 0, 0, o.w, o.h, 8, WF.soft, null, 1, rc.zoom);
    list.forEach((s, i) => {
      if (i === active) rrect(ctx, 3 + i * tw, 3, tw, o.h - 6, 6, WF.white, WF.line, 1, rc.zoom);
      text(ctx, rc, o.id + i, s, { x: 3 + i * tw, y: 0, w: tw, h: o.h }, 13, i === active ? WF.ink : WF.text, 'center', i === active ? 700 : 400);
    });
  },
  navbar: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, 0, WF.white, null, 1, rc.zoom);
    line(ctx, 0, o.h - 0.5, o.w, o.h - 0.5, WF.line);
    rrect(ctx, 16, o.h / 2 - 14, 28, 28, 6, WF.accent, null, 1, rc.zoom);
    const list = items(o, []);
    let x = o.w - 16;
    const sizes = list.map((s) => Math.max(40, s.length * 14 + 16));
    for (let i = list.length - 1; i >= 0; i--) {
      x -= sizes[i];
      if (x < o.w * 0.4) break;
      text(ctx, rc, o.id + i, list[i], { x, y: 0, w: sizes[i], h: o.h }, 14, WF.text, 'center');
    }
  },
  sidebar: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, 0, WF.softer, null, 1, rc.zoom);
    line(ctx, o.w - 0.5, 0, o.w - 0.5, o.h, WF.line);
    const list = items(o, []);
    const active = num(o.props.active, 0);
    list.forEach((s, i) => {
      const y = 52 + i * 40;
      if (y + 36 > o.h) return;
      if (i === active) rrect(ctx, 8, y, o.w - 16, 36, 6, WF.accentSoft, null, 1, rc.zoom);
      rrect(ctx, 20, y + 10, 16, 16, 4, i === active ? WF.accent : WF.line, null, 1, rc.zoom);
      text(ctx, rc, o.id + i, s, { x: 46, y, w: o.w - 56, h: 36 }, 14, i === active ? WF.ink : WF.text, 'left', i === active ? 700 : 400);
    });
  },
  breadcrumb: (ctx, o, rc) => {
    const list = items(o, []);
    let x = 0;
    list.forEach((s, i) => {
      const w = s.length * 13 + 4;
      text(ctx, rc, o.id + i, s, { x, y: 0, w, h: o.h }, 13, i === list.length - 1 ? WF.ink : WF.accent, 'left', i === list.length - 1 ? 700 : 400);
      x += w;
      if (i < list.length - 1) {
        icon(ctx, rc, o.id, 'ChevronRight', x + 2, o.h / 2 - 7, 14, WF.mute);
        x += 18;
      }
    });
  },
  pagination: (ctx, o, rc) => {
    const pages = Math.max(1, Math.min(9, num(o.props.pages, 5)));
    const active = num(o.props.active, 1);
    const n = pages + 2;
    const gap = 6;
    const s = Math.min(o.h, (o.w - gap * (n - 1)) / n);
    for (let i = 0; i < n; i++) {
      const x = i * (s + gap);
      const isPage = i > 0 && i < n - 1;
      const on = isPage && i === active;
      rrect(ctx, x, (o.h - s) / 2, s, s, 4, on ? WF.accent : WF.white, on ? null : WF.line, 1, rc.zoom);
      if (isPage) text(ctx, rc, o.id + 'p', String(i), { x, y: 0, w: s, h: o.h }, 13, on ? WF.white : WF.text, 'center');
      else icon(ctx, rc, o.id, i === 0 ? 'ChevronLeft' : 'ChevronRight', x + s / 2 - 7, o.h / 2 - 7, 14, WF.text);
    }
  },
  card: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, 8, WF.white, WF.line, 1, rc.zoom);
    const ih = Math.round(o.h * 0.5);
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, o.w, o.h, 8);
    ctx.clip();
    imagePh(ctx, rc, o, 0, 0, o.w, ih);
    ctx.restore();
    line(ctx, 0, ih, o.w, ih, WF.line);
    bar(ctx, 12, ih + 40, o.w * 0.7);
    bar(ctx, 12, ih + 54, o.w * 0.5);
  },
  list: (ctx, o, rc) => {
    const list = items(o, []);
    const rh = 44;
    rrect(ctx, 0, 0, o.w, o.h, 8, WF.white, WF.line, 1, rc.zoom);
    list.forEach((s, i) => {
      const y = i * rh;
      if (y + rh > o.h + 1) return;
      circle(ctx, 24, y + rh / 2, 12, WF.soft, null);
      text(ctx, rc, o.id + i, s, { x: 46, y, w: o.w - 80, h: rh }, 14, WF.ink);
      icon(ctx, rc, o.id, 'ChevronRight', o.w - 26, y + rh / 2 - 7, 14, WF.mute);
      if (i < list.length - 1 && y + rh < o.h - 1) line(ctx, 12, y + rh, o.w - 12, y + rh, WF.soft);
    });
  },
  table: (ctx, o, rc) => {
    const cols = Array.isArray(o.props.columns) ? (o.props.columns as unknown[]).map(String) : ['名稱', '狀態', '日期'];
    const rows = Math.max(1, num(o.props.rows, 3));
    const rh = o.h / (rows + 1);
    const cw = o.w / Math.max(1, cols.length);
    rrect(ctx, 0, 0, o.w, o.h, 4, WF.white, WF.line, 1, rc.zoom);
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, o.w, o.h, 4);
    ctx.clip();
    ctx.fillStyle = WF.soft;
    ctx.fillRect(0, 0, o.w, rh);
    ctx.restore();
    cols.forEach((c, i) => text(ctx, rc, o.id + i, c, { x: i * cw + 10, y: 0, w: cw - 20, h: rh }, 13, WF.ink, 'left', 700));
    for (let r = 1; r <= rows; r++) {
      line(ctx, 0, r * rh, o.w, r * rh, WF.line);
      for (let i = 0; i < cols.length; i++) bar(ctx, i * cw + 10, r * rh + rh / 2 - 3, (cw - 20) * (0.45 + ((r * 7 + i * 3) % 5) * 0.1));
    }
  },
  image_placeholder: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, 4, null, WF.line, 1, rc.zoom);
    imagePh(ctx, rc, o, 0, 0, o.w, o.h);
  },
  video_placeholder: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, 6, WF.ink, null, 1, rc.zoom);
    const r = Math.min(o.w, o.h) * 0.16;
    circle(ctx, o.w / 2, o.h / 2, r, 'rgba(255,255,255,0.18)', null);
    ctx.beginPath();
    ctx.moveTo(o.w / 2 - r * 0.35, o.h / 2 - r * 0.5);
    ctx.lineTo(o.w / 2 + r * 0.55, o.h / 2);
    ctx.lineTo(o.w / 2 - r * 0.35, o.h / 2 + r * 0.5);
    ctx.closePath();
    ctx.fillStyle = WF.white;
    ctx.fill();
    rrect(ctx, 12, o.h - 14, o.w - 24, 3, 1.5, 'rgba(255,255,255,0.3)', null, 1, rc.zoom);
    rrect(ctx, 12, o.h - 14, (o.w - 24) * 0.35, 3, 1.5, WF.accent, null, 1, rc.zoom);
  },
  avatar: (ctx, o) => {
    const r = Math.min(o.w, o.h) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(o.w / 2, o.h / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = WF.soft;
    ctx.fill();
    ctx.clip();
    circle(ctx, o.w / 2, o.h / 2 - r * 0.18, r * 0.36, WF.line, null);
    circle(ctx, o.w / 2, o.h / 2 + r * 0.95, r * 0.7, WF.line, null);
    ctx.restore();
  },
  badge: (ctx, o, rc) => rrect(ctx, 0, 0, o.w, o.h, o.h / 2, o.style.fill ?? WF.accent, null, 1, rc.zoom),
  tag: (ctx, o, rc) => rrect(ctx, 0, 0, o.w, o.h, 4, o.style.fill ?? WF.soft, null, 1, rc.zoom),
  modal: (ctx, o, rc) => {
    if (rc.zoom >= 0.4) rrect(ctx, 0, 4, o.w, o.h, 10, 'rgba(16,24,40,0.08)', null, 1, rc.zoom);
    rrect(ctx, 0, 0, o.w, o.h, 10, WF.white, WF.line, 1, rc.zoom);
    icon(ctx, rc, o.id, 'X', o.w - 36, 18, 18, WF.mute);
    const body = String(o.props.body ?? '');
    if (body) {
      const lay = rc.text.plain('wf:body:' + body, body, o.w - 40, 14, 400);
      drawTextLayout(ctx, lay, { x: 20, y: 52, w: o.w - 40, h: o.h - 120 }, { color: WF.text, align: 'left', valign: 'top', zoom: rc.zoom });
    }
    const btns = Array.isArray(o.props.buttons) ? (o.props.buttons as unknown[]).map(String) : ['取消', '確定'];
    let x = o.w - 20;
    for (let i = btns.length - 1; i >= 0; i--) {
      const bw = Math.max(72, btns[i].length * 14 + 28);
      x -= bw;
      const primary = i === btns.length - 1;
      rrect(ctx, x, o.h - 56, bw, 36, WF.radius, primary ? WF.accent : WF.white, primary ? null : WF.line, 1, rc.zoom);
      text(ctx, rc, o.id + 'b' + i, btns[i], { x, y: o.h - 56, w: bw, h: 36 }, 14, primary ? WF.white : WF.ink, 'center', primary ? 700 : 400);
      x -= 8;
    }
  },
  toast: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, 8, WF.ink, null, 1, rc.zoom);
    icon(ctx, rc, o.id, 'CircleCheck', 12, o.h / 2 - 9, 18, '#7fd3c6');
  },
  tooltip: (ctx, o, rc) => {
    const bh = o.h - 8;
    rrect(ctx, 0, 0, o.w, bh, 6, WF.ink, null, 1, rc.zoom);
    ctx.beginPath();
    ctx.moveTo(o.w / 2 - 6, bh);
    ctx.lineTo(o.w / 2, o.h);
    ctx.lineTo(o.w / 2 + 6, bh);
    ctx.closePath();
    ctx.fillStyle = WF.ink;
    ctx.fill();
  },
  progress: (ctx, o, rc) => {
    const v = clamp01(num(o.props.value, 0.6));
    rrect(ctx, 0, 0, o.w, o.h, o.h / 2, WF.soft, null, 1, rc.zoom);
    rrect(ctx, 0, 0, o.w * v, o.h, o.h / 2, WF.accent, null, 1, rc.zoom);
  },
  spinner: (ctx, o) => {
    const r = Math.min(o.w, o.h) / 2 - 3;
    const lw = Math.max(2, r * 0.25);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(o.w / 2, o.h / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = WF.soft;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(o.w / 2, o.h / 2, r, -Math.PI / 2, Math.PI * 0.35);
    ctx.strokeStyle = WF.accent;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  },
  divider: (ctx, o) => line(ctx, 0, o.h / 2, o.w, o.h / 2, WF.line),
  heading: () => {},
  paragraph: () => {},
  label: () => {},
  accordion: (ctx, o, rc) => {
    const list = items(o, []);
    const open = num(o.props.open, 0);
    rrect(ctx, 0, 0, o.w, o.h, 8, WF.white, WF.line, 1, rc.zoom);
    const hh = 40;
    let y = 0;
    list.forEach((s, i) => {
      if (y + hh > o.h + 1) return;
      text(ctx, rc, o.id + i, s, { x: 14, y, w: o.w - 50, h: hh }, 14, WF.ink, 'left', i === open ? 700 : 400);
      icon(ctx, rc, o.id, i === open ? 'ChevronUp' : 'ChevronDown', o.w - 30, y + hh / 2 - 8, 16, WF.text);
      y += hh;
      if (i === open) {
        const extra = Math.max(0, o.h - hh * list.length);
        if (extra >= 20) {
          bar(ctx, 14, y + 4, (o.w - 28) * 0.85);
          if (extra >= 34) bar(ctx, 14, y + 18, (o.w - 28) * 0.6);
        }
        y += extra;
      }
      if (i < list.length - 1 && y < o.h - 1) line(ctx, 0, y, o.w, y, WF.line);
    });
  },
  menu: (ctx, o, rc) => {
    if (rc.zoom >= 0.4) rrect(ctx, 0, 3, o.w, o.h, 8, 'rgba(16,24,40,0.08)', null, 1, rc.zoom);
    rrect(ctx, 0, 0, o.w, o.h, 8, WF.white, WF.line, 1, rc.zoom);
    const list = items(o, []);
    const ih = 36;
    list.forEach((s, i) => {
      const y = 6 + i * ih;
      if (y + ih > o.h) return;
      if (i === 0) rrect(ctx, 4, y, o.w - 8, ih, 4, WF.softer, null, 1, rc.zoom);
      text(ctx, rc, o.id + i, s, { x: 14, y, w: o.w - 28, h: ih }, 14, WF.ink);
    });
  },
  chart_placeholder: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, 6, WF.white, WF.line, 1, rc.zoom);
    const pad = 16;
    const base = o.h - pad;
    line(ctx, pad, pad, pad, base, WF.line);
    line(ctx, pad, base, o.w - pad, base, WF.line);
    const n = 6;
    const bw = (o.w - pad * 2 - 8) / n;
    const hs = [0.45, 0.7, 0.55, 0.85, 0.6, 0.95];
    for (let i = 0; i < n; i++) {
      const h = (base - pad - 8) * hs[i];
      rrect(ctx, pad + 8 + i * bw + bw * 0.2, base - h, bw * 0.6, h, 2, i === n - 1 ? WF.accent : WF.line, null, 1, rc.zoom);
    }
  },
  map_placeholder: (ctx, o, rc) => {
    rrect(ctx, 0, 0, o.w, o.h, 6, '#eef2ee', WF.line, 1, rc.zoom);
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, o.w, o.h, 6);
    ctx.clip();
    line(ctx, 0, o.h * 0.35, o.w, o.h * 0.55, WF.white, 6);
    line(ctx, o.w * 0.3, 0, o.w * 0.5, o.h, WF.white, 6);
    line(ctx, o.w * 0.7, 0, o.w * 0.85, o.h, WF.white, 4);
    ctx.restore();
    icon(ctx, rc, o.id, 'MapPin', o.w / 2 - 12, o.h / 2 - 22, 24, WF.accent);
  },
  rating: (ctx, o) => {
    const max = Math.max(1, Math.min(10, num(o.props.max, 5)));
    const v = num(o.props.value, 3);
    const s = Math.min(o.h, o.w / max);
    for (let i = 0; i < max; i++) {
      starPath(ctx, i * s + s / 2, o.h / 2, s * 0.45);
      if (i < v) {
        ctx.fillStyle = WF.accent;
        ctx.fill();
      } else {
        ctx.strokeStyle = WF.line;
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
    }
  },
};

/** 連結按鈕底線用：主要文字的估計寬度 */
function mainLayout(o: WireframeObject): number {
  let n = 0;
  for (const b of o.text) for (const r of b.runs) for (const ch of r.text) n += ch.charCodeAt(0) > 0x2e7f ? 14 : 8;
  return n;
}

function imagePh(ctx: Ctx, rc: RenderContext, o: WireframeObject, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = WF.soft;
  ctx.fillRect(x, y, w, h);
  const s = Math.min(w, h) * 0.3;
  if (s * rc.zoom >= 4) icon(ctx, rc, o.id, 'Image', x + (w - s) / 2, y + (h - s) / 2, s, WF.mute);
}

// ---------------------------------------------------------------- 互動：點擊切換 props

/**
 * 已選取的元件被點擊時，若點在可切換的位置，回傳要寫回 props 的變更（一個 transaction）；否則 null。
 * p 為區域座標（相對元件左上角）。
 */
export function wireframeClick(o: WireframeObject, p: Point): Record<string, unknown> | null {
  const { w, h } = o;
  const inside = (x: number, y: number, bw: number, bh: number) => p.x >= x - 3 && p.x <= x + bw + 3 && p.y >= y - 3 && p.y <= y + bh + 3;
  switch (o.componentKind) {
    case 'checkbox':
    case 'radio':
      return inside(0, (h - 16) / 2, 16, 16) ? { checked: !o.props.checked } : null;
    case 'switch':
      return inside(0, (h - 20) / 2, 36, 20) ? { checked: !o.props.checked } : null;
    case 'tabs':
    case 'segmented': {
      const list = items(o, ['', '', '']);
      const i = Math.floor((p.x / w) * list.length);
      return i >= 0 && i < list.length && i !== num(o.props.active, 0) ? { active: i } : null;
    }
    case 'rating': {
      const max = Math.max(1, Math.min(10, num(o.props.max, 5)));
      const s = Math.min(h, w / max);
      const i = Math.floor(p.x / s);
      return i >= 0 && i < max ? { value: i + 1 } : null;
    }
    case 'slider': {
      const v = clamp01((p.x - 8) / Math.max(1, w - 16));
      return { value: Math.round(v * 100) / 100 };
    }
    case 'accordion': {
      const list = items(o, []);
      const open = num(o.props.open, 0);
      // 依目前展開的項目計算每個標題的位置
      const extra = Math.max(0, h - 40 * list.length);
      let y = 0;
      for (let i = 0; i < list.length; i++) {
        if (p.y >= y && p.y <= y + 40) return { open: i === open ? -1 : i };
        y += 40 + (i === open ? extra : 0);
      }
      return null;
    }
    case 'sidebar': {
      const list = items(o, []);
      const i = Math.floor((p.y - 52) / 40);
      return p.y >= 52 && i >= 0 && i < list.length ? { active: i } : null;
    }
    case 'pagination': {
      const pages = Math.max(1, Math.min(9, num(o.props.pages, 5)));
      const n = pages + 2;
      const s = Math.min(h, (w - 6 * (n - 1)) / n);
      const i = Math.floor(p.x / (s + 6));
      return i > 0 && i < n - 1 ? { active: i } : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- 渲染器

export const wireframeRenderer: ObjectRenderer<WireframeObject> = {
  draw(ctx, o, rc) {
    const painter = P[o.componentKind];
    const opacity = o.style?.opacity ?? 1;
    if (opacity < 1) ctx.globalAlpha = opacity;
    ctx.translate(o.x, o.y);
    ctx.lineJoin = 'round';
    if (painter) painter(ctx, o, rc);
    else rrect(ctx, 0, 0, o.w, o.h, 4, WF.softer, WF.line, 1, rc.zoom);
    const spec = wireframeLabel(o);
    if (spec) mainText(ctx, rc, o, spec);
    ctx.translate(-o.x, -o.y);
    if (opacity < 1) ctx.globalAlpha = 1;
  },
  drawLod(b: LodBatch, o, rc) {
    if (rc.zoom * 14 >= 4) return false;
    const k = o.componentKind;
    const dark = k === 'button' || k === 'badge' || k === 'toast' || k === 'tooltip' || k === 'video_placeholder';
    const flat = k === 'heading' || k === 'paragraph' || k === 'label' || k === 'divider' || k === 'link_button' || k === 'breadcrumb' || k === 'tabs' || k === 'rating' || k === 'slider' || k === 'progress' || k === 'spinner';
    if (Math.max(o.w, o.h) * rc.zoom < 2 || flat) {
      if (flat) b.bar().rect(o.x, o.y + o.h * 0.3, o.w * (k === 'heading' ? 0.6 : 1), Math.max(o.h * 0.4, 2));
      else b.fill(dark ? WF.ink : WF.soft).rect(o.x, o.y, o.w, o.h);
      return true;
    }
    b.fill(k === 'button' || k === 'badge' ? WF.accent : dark ? WF.ink : WF.white).rect(o.x, o.y, o.w, o.h);
    if (!dark) b.stroke(WF.line, 1).rect(o.x, o.y, o.w, o.h);
    const spec = wireframeLabel(o);
    if (spec) b.bar().rect(o.x + spec.box.x + (spec.align === 'center' ? spec.box.w * 0.2 : 0), o.y + spec.box.y + spec.box.h / 2 - spec.size * 0.3, spec.box.w * 0.6, spec.size * 0.6);
    return true;
  },
  getTextBox(o, field) {
    if (field !== 'text') return null;
    const spec = wireframeLabel(o);
    return spec ? { x: o.x + spec.box.x, y: o.y + spec.box.y, w: spec.box.w, h: spec.box.h } : null;
  },
};

/** 編輯覆蓋層需要的字級、粗細、顏色與對齊（getEditingGeometry 使用） */
export function wireframeTextStyle(o: WireframeObject) {
  const spec = wireframeLabel(o);
  return spec && { fontSize: spec.size, fontWeight: spec.weight, color: spec.color, textAlign: spec.align, verticalAlign: spec.valign, wrap: spec.wrap };
}

export const ALL_WIREFRAME_KINDS = WIREFRAME_KINDS;
