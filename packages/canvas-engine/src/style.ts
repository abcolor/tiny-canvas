import type { BoardObject, ShapeKind, Style } from '@tinycanvas/shared';

export const FONT_FAMILY = '"Noto Sans TC Variable", "PingFang TC", "Microsoft JhengHei", sans-serif';
/** 系統主色（依使用者指定） */
export const BRAND = '#0087dc';
export const SELECTION_COLOR = BRAND;
export const LINK_COLOR = '#006db6';
export const CANVAS_BG = '#f8f9fa';
export const GRID_DOT = '#d3d8de';

/** 預設調色盤（樣式面板也使用）。name 是識別字，介面文字由 web app 自行對應 */
export const TEXT_DEFAULT_COLOR = '#1f2933';

/**
 * 預設調色盤：15 色，依使用者指定（2026-10-12），介面以每列 4 色排列，最後一格為自訂顏色。
 * - color：原色，用於形狀顏色、圖示、外框與文字
 * - fill：區塊、表格等「填色」選擇器使用的淡色背景（原色調淡 85%）
 * - stroke：搭配 fill 的外框色（白色改用淺灰，否則在白底上看不見）
 */
export const PALETTE_COLORS: { name: string; color: string }[] = [
  { name: 'white', color: '#ffffff' },
  { name: 'silver', color: '#c5cfda' },
  { name: 'gray', color: '#798897' },
  { name: 'slate', color: '#4d5c6d' },
  { name: 'blue', color: '#2888d7' },
  { name: 'indigo', color: '#665bf4' },
  { name: 'purple', color: '#730fc3' },
  { name: 'magenta', color: '#bf36d3' },
  { name: 'teal', color: '#28afa0' },
  { name: 'green', color: '#007a6f' },
  { name: 'taupe', color: '#897a5f' },
  { name: 'rose', color: '#a46768' },
  { name: 'red', color: '#d5475b' },
  { name: 'orange', color: '#e9843c' },
  { name: 'yellow', color: '#f0c54f' },
];

/** 淺色（例如白色）當外框時改用的邊框色 */
export const LIGHT_STROKE = '#c5cfda';
/** 形狀的預設外框色（調色盤的 slate） */
export const DEFAULT_SHAPE_COLOR = '#4d5c6d';

export const DEFAULT_PALETTE: { name: string; color: string; fill: string; stroke: string; text: string }[] = PALETTE_COLORS.map(({ name, color }) => {
  const rgb = parseHex(color)!;
  return {
    name,
    color,
    fill: mixWithWhite(rgb, 0.85),
    stroke: luminance(rgb) > 0.9 ? LIGHT_STROKE : color,
    text: TEXT_DEFAULT_COLOR,
  };
});


export interface ResolvedStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted' | 'none';
  textColor: string;
  fontSize: number;
  fontWeight: 400 | 700;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  opacity: number;
}

const BASE: ResolvedStyle = {
  fill: '#ffffff',
  stroke: DEFAULT_SHAPE_COLOR,
  strokeWidth: 1.5,
  strokeStyle: 'solid',
  textColor: TEXT_DEFAULT_COLOR,
  fontSize: 14,
  fontWeight: 400,
  textAlign: 'center',
  verticalAlign: 'middle',
  opacity: 1,
};

const TYPE_DEFAULTS: Partial<Record<BoardObject['type'], Partial<ResolvedStyle>>> = {
  text: { fill: 'transparent', stroke: 'transparent', strokeWidth: 0, strokeStyle: 'none', textAlign: 'left', verticalAlign: 'top' },
  section: { fill: '#f1f3f5', stroke: '#d4dae0', strokeWidth: 1, textColor: '#46525e', textAlign: 'left', verticalAlign: 'top' },
  connector: { stroke: '#5b6672', strokeWidth: 1.5, textColor: '#46525e', fontSize: 13 },
  link_card: { fill: '#ffffff', stroke: '#d4dae0', strokeWidth: 1, textAlign: 'left' },
  image: { fill: 'transparent', stroke: 'transparent', strokeWidth: 0 },
  wireframe: { fill: '#ffffff', stroke: '#9aa5b1', strokeWidth: 1 },
  table: { fill: '#ffffff', stroke: '#c5ccd3', strokeWidth: 1, textAlign: 'left' },
};

const cache = new WeakMap<object, ResolvedStyle>();

/** 合併類型預設值與物件樣式。快照物件在變動時會整個替換，因此以快照為 key 快取 */
export function resolveStyle(o: BoardObject): ResolvedStyle {
  const hit = cache.get(o);
  if (hit) return hit;
  const s: Style = o.style ?? {};
  const d = TYPE_DEFAULTS[o.type] ?? {};
  const out: ResolvedStyle = { ...BASE, ...d } as ResolvedStyle;
  if (o.type === 'text' && o.variant === 'heading') {
    out.fontSize = 24;
    out.fontWeight = 700;
  }
  for (const k of Object.keys(s) as (keyof Style)[]) {
    const v = s[k];
    if (v !== undefined && v !== null) (out as any)[k] = v;
  }
  if (o.type === 'shape' && s.fillMode) applyFillMode(out, s);
  cache.set(o, out);
  return out;
}

/**
 * 形狀外觀（見 SPEC.md 第 4.1 節）：背景色由外框色推算。
 * - outline / dashed：透明時沒有背景；否則為外框色 30% 混 70% 白色的不透明淡色
 * - solid：背景即外框色；未指定文字色時依亮度自動選白色或深色
 */
function applyFillMode(out: ResolvedStyle, s: Style) {
  const color = out.stroke;
  const rgb = parseHex(color);
  const mode = s.fillMode!;
  out.strokeStyle = mode === 'dashed' ? 'dashed' : 'solid';
  if (!rgb) return;
  if (luminance(rgb) > 0.9) out.stroke = LIGHT_STROKE;
  if (mode === 'solid') {
    out.fill = color;
    if (!s.textColor) out.textColor = luminance(rgb) < 0.55 ? '#ffffff' : TEXT_DEFAULT_COLOR;
  } else {
    out.fill = s.transparent ? 'transparent' : mixWithWhite(rgb, 0.7);
  }
}

type Rgb = [number, number, number];

export function parseHex(color: string | undefined): Rgb | null {
  if (!color) return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** 往白色混合：amount 為白色所佔比例 */
export function mixWithWhite([r, g, b]: Rgb, amount: number): string {
  const f = (c: number) => Math.round(c + (255 - c) * amount);
  return '#' + [f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** 相對亮度（0–1） */
function luminance([r, g, b]: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** 新形狀的預設尺寸 */
export function defaultShapeSize(kind: ShapeKind): { w: number; h: number } {
  switch (kind) {
    case 'ellipse':
    case 'diamond':
    case 'hexagon':
    case 'octagon':
    case 'pentagon':
    case 'star':
    case 'triangle':
    case 'cross':
      return { w: 120, h: 96 };
    case 'cylinder':
      return { w: 120, h: 112 };
    case 'person':
      return { w: 64, h: 96 };
    case 'cloud':
      return { w: 176, h: 104 };
    default:
      return { w: 160, h: 80 };
  }
}

export function fontString(size: number, weight: number, italic = false): string {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT_FAMILY}`;
}

/** 新建立的形狀與連線的線條粗細（見 DECISIONS.md 2026-10-12） */
export const NEW_STROKE_WIDTH = 3;
