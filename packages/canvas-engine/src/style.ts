import type { BoardObject, ShapeKind, Style } from '@tinycanvas/shared';

export const FONT_FAMILY = '"Noto Sans TC Variable", "PingFang TC", "Microsoft JhengHei", sans-serif';
/** 系統主色（依使用者指定） */
export const BRAND = '#0087dc';
export const SELECTION_COLOR = BRAND;
export const LINK_COLOR = '#006db6';
/** 畫布背景色（使用者指定，2026-10-15） */
export const CANVAS_BG = '#f3f5f8';
export const GRID_DOT = '#d3d8de';

/** 預設調色盤（樣式面板也使用）。name 是識別字，介面文字由 web app 自行對應 */
export const TEXT_DEFAULT_COLOR = '#1f2933';
/** 文字物件的預設文字色：調色盤最深灰的文字色（使用者指定，2026-10-15） */
export const TEXT_OBJECT_COLOR = '#2c3743';

/**
 * 預設調色盤：15 色，依使用者指定（2026-10-15），介面以每列 4 色排列，最後一格為自訂顏色。
 * - color：色盤上顯示的顏色。形狀選色時存這個值（style.stroke），繪製時再對應成 border / background；
 *   白色與 silver 的外框色相同，只存外框色會分不出選的是哪一格
 * - border：形狀繪製時的外框色；連線、文字、圖示選色時直接存這個值
 * - background：形狀只有外框 / 虛線外框且不透明時、以及整個填滿時的背景；區塊、表格等「填色」選擇器的背景
 */
export const PALETTE_COLORS: { name: string; color: string; border: string; background: string }[] = [
  { name: 'white', color: '#ffffff', border: '#c6cfd9', background: '#ffffff' },
  { name: 'silver', color: '#d7dde4', border: '#c6cfd9', background: '#f3f5f7' },
  { name: 'gray', color: '#a3acb5', border: '#a2acb9', background: '#e2e5eb' },
  { name: 'slate', color: '#848e97', border: '#7c8796', background: '#d0d8df' },
  { name: 'blue', color: '#78aade', border: '#4685d1', background: '#d8e6f5' },
  { name: 'indigo', color: '#938cf0', border: '#635bea', background: '#e0defb' },
  { name: 'purple', color: '#945bce', border: '#691abc', background: '#e0d0f0' },
  { name: 'magenta', color: '#c577da', border: '#af41cc', background: '#eed8f4' },
  { name: 'teal', color: '#7fc4bd', border: '#56aca0', background: '#d9eeec' },
  { name: 'green', color: '#63a09a', border: '#34786f', background: '#d0e3e2' },
  { name: 'taupe', color: '#aba391', border: '#867b62', background: '#e6e4df' },
  { name: 'rose', color: '#b99796', border: '#9b6a68', background: '#ebe1e1' },
  { name: 'red', color: '#d5838d', border: '#c5515e', background: '#f2dbde' },
  { name: 'orange', color: '#e5ac7f', border: '#da894c', background: '#f7e7da' },
  { name: 'yellow', color: '#f0d78f', border: '#e9c764', background: '#faf3de' },
];

/** 淺色（例如白色）當外框時改用的邊框色（調色盤白色的外框色） */
export const LIGHT_STROKE = '#c6cfd9';
/** 形狀的預設顏色（調色盤的白色；繪製時外框為 #c6cfd9、背景為 #ffffff） */
export const DEFAULT_SHAPE_COLOR = '#ffffff';
/** 未設定外觀的舊形狀與其他物件的預設外框色 */
const BASE_STROKE = '#7c8796';
/** 自訂顏色（不在調色盤內）的淡色背景：外框色 21% 混 79% 白色，與調色盤的背景色相近 */
const CUSTOM_BACKGROUND_WHITE = 0.79;

/** 「文字顏色」選擇器選這兩個灰色時另外指定的顏色（使用者指定，2026-10-15）；其他顏色使用外框色 */
const TEXT_COLOR_OVERRIDES: Record<string, string> = { gray: '#7c8796', slate: TEXT_OBJECT_COLOR };

/**
 * - text：區塊、表格等「填色」選擇器選色時一併設定的文字色
 * - textColor：「文字顏色」選擇器選這個色塊時套用的顏色
 */
export const DEFAULT_PALETTE: { name: string; color: string; border: string; background: string; text: string; textColor: string }[] = PALETTE_COLORS.map((p) => ({
  ...p,
  text: TEXT_DEFAULT_COLOR,
  textColor: TEXT_COLOR_OVERRIDES[p.name] ?? p.border,
}));

const BY_COLOR = new Map(PALETTE_COLORS.map((p) => [p.color, p]));
/** 形狀的顏色是調色盤的色塊時回傳該色（比對不分大小寫） */
export function paletteEntry(color: string | undefined): (typeof PALETTE_COLORS)[number] | undefined {
  return color ? BY_COLOR.get(color.toLowerCase()) : undefined;
}

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
  stroke: BASE_STROKE,
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
  text: { fill: 'transparent', stroke: 'transparent', strokeWidth: 0, strokeStyle: 'none', textAlign: 'left', verticalAlign: 'top', textColor: TEXT_OBJECT_COLOR },
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
 * - outline / dashed：透明時沒有背景；否則為調色盤指定的背景色（自訂顏色為外框色 21% 混 79% 白色）
 * - solid：背景與 outline 不透明時相同，沒有邊緣（邊框與背景同色）。未指定文字色時依背景亮度自動選白色或深色
 */
function applyFillMode(out: ResolvedStyle, s: Style) {
  const color = s.stroke ?? DEFAULT_SHAPE_COLOR;
  const rgb = parseHex(color);
  const mode = s.fillMode!;
  out.strokeStyle = mode === 'dashed' ? 'dashed' : 'solid';
  out.stroke = color;
  if (!rgb) return;
  // 調色盤的顏色使用指定的外框、背景與填滿色；自訂顏色由它本身推算
  const entry = paletteEntry(color);
  if (entry) out.stroke = entry.border;
  else if (luminance(rgb) > 0.9) out.stroke = LIGHT_STROKE;
  const background = entry ? entry.background : mixWithWhite(rgb, CUSTOM_BACKGROUND_WHITE);
  if (mode === 'solid') {
    // 整個填滿：背景與「只有外框」時相同，只是沒有邊緣（邊框畫成與背景同色）
    out.fill = background;
    out.stroke = background;
    if (!s.textColor) out.textColor = luminance(parseHex(background)!) < 0.55 ? '#ffffff' : TEXT_DEFAULT_COLOR;
  } else {
    out.fill = s.transparent ? 'transparent' : background;
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
