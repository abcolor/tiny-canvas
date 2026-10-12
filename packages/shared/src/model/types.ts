// 畫布物件模型，見 docs/SPEC.md 第 8.2 節。
// Y.Doc 內有一個 `objects: Y.Map<id, Y.Map>`；本檔定義每個物件 Y.Map 的欄位，
// 以及讀出來之後給渲染器與其他模組使用的純資料快照（BoardObject）。

/** 本期的物件類型。`type` 欄位可擴充，未知類型要能被安全略過。 */
export const OBJECT_TYPES = [
  'shape',
  'text',
  'connector',
  'wireframe',
  'table',
  'image',
  'link_card',
  'section',
  'group',
  'icon',
] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export const CONTAINER_TYPES = ['group', 'section'] as const;

export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted' | 'none';

/** 樣式。整個物件存成一個普通 JSON 值，修改時整個替換。 */
export interface Style {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  textColor?: string;
  fontSize?: number;
  fontWeight?: 400 | 700;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  opacity?: number;
  /**
   * 形狀的外觀（只用於 shape）：solid 整個填滿、outline 只有外框、dashed 虛線外框。
   * 設定後背景色由外框色（stroke）推算，不再使用 fill；未設定時沿用 fill / stroke（舊畫布的外觀）
   */
  fillMode?: FillMode;
  /** 背景透明（只用於 fillMode 為 outline / dashed 的 shape）；否則背景為外框色的 30% 淡色 */
  transparent?: boolean;
  /** @deprecated 舊的半透明背景，已不再影響外觀（2026-10-12 改為 transparent） */
  translucent?: boolean;
}

export type FillMode = 'solid' | 'outline' | 'dashed';

/** 形狀內嵌圖示相對於文字的位置 */
export type IconPosition = 'top' | 'bottom' | 'left' | 'right';

export type ShapeKind =
  | 'rectangle'
  | 'rounded'
  | 'ellipse'
  | 'diamond'
  | 'parallelogram'
  | 'trapezoid'
  | 'cylinder'
  | 'document'
  | 'hexagon'
  | 'octagon'
  | 'triangle'
  | 'pentagon'
  | 'star'
  | 'cloud'
  | 'person'
  | 'arrow_right'
  | 'chevron'
  | 'callout'
  | 'cross'
  | 'manual_input';

export const SHAPE_KINDS: ShapeKind[] = [
  'rectangle',
  'rounded',
  'ellipse',
  'diamond',
  'parallelogram',
  'trapezoid',
  'cylinder',
  'document',
  'hexagon',
  'octagon',
  'triangle',
  'pentagon',
  'star',
  'cloud',
  'person',
  'arrow_right',
  'chevron',
  'callout',
  'cross',
  'manual_input',
];

export type WireframeKind =
  | 'button'
  | 'button_secondary'
  | 'link_button'
  | 'icon_button'
  | 'input'
  | 'textarea'
  | 'search'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'switch'
  | 'slider'
  | 'stepper'
  | 'tabs'
  | 'segmented'
  | 'navbar'
  | 'sidebar'
  | 'breadcrumb'
  | 'pagination'
  | 'card'
  | 'list'
  | 'table'
  | 'image_placeholder'
  | 'video_placeholder'
  | 'avatar'
  | 'badge'
  | 'tag'
  | 'modal'
  | 'toast'
  | 'tooltip'
  | 'progress'
  | 'spinner'
  | 'divider'
  | 'heading'
  | 'paragraph'
  | 'label'
  | 'date_picker'
  | 'accordion'
  | 'menu'
  | 'chart_placeholder'
  | 'map_placeholder'
  | 'rating';

export const WIREFRAME_KINDS: WireframeKind[] = [
  'button',
  'button_secondary',
  'link_button',
  'icon_button',
  'input',
  'textarea',
  'search',
  'select',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'stepper',
  'tabs',
  'segmented',
  'navbar',
  'sidebar',
  'breadcrumb',
  'pagination',
  'card',
  'list',
  'table',
  'image_placeholder',
  'video_placeholder',
  'avatar',
  'badge',
  'tag',
  'modal',
  'toast',
  'tooltip',
  'progress',
  'spinner',
  'divider',
  'heading',
  'paragraph',
  'label',
  'date_picker',
  'accordion',
  'menu',
  'chart_placeholder',
  'map_placeholder',
  'rating',
];

export type FrameKind = 'phone' | 'tablet' | 'browser' | 'window';

export type AnchorSide = 'top' | 'right' | 'bottom' | 'left';
/** 連接點：四邊中點，或 0–1 的相對位置（任意點） */
export type Anchor = AnchorSide | { u: number; v: number };

export interface ConnectorEnd {
  /** 接在物件上時為物件 id；懸空端點為 null，改用 x/y */
  objectId: string | null;
  anchor: Anchor | null;
  x?: number;
  y?: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Routing = 'straight' | 'orthogonal' | 'curved';
export type ArrowHead = 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond';

/** 富文本快照：由 Y.XmlFragment 轉出，給渲染器與搜尋使用 */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** 刪除線 */
  strike?: boolean;
  /** 行內程式碼（等寬字型、淡色底） */
  code?: boolean;
  /** 螢光標記（背景色；未指定顏色時用預設黃色） */
  highlight?: string | true;
  link?: string;
}
export interface TextBlock {
  /** task：核取清單項目；code：程式碼區塊（runs 內以 \n 分行，不自動合併空白） */
  kind: 'paragraph' | 'heading' | 'bullet' | 'ordered' | 'task' | 'code';
  /** heading 的層級（1–3） */
  level?: number;
  /** 列表的巢狀深度，從 0 開始 */
  depth?: number;
  /** ordered list 的序號，從 1 開始 */
  index?: number;
  /** task 是否已勾選 */
  checked?: boolean;
  runs: TextRun[];
}

interface Base {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: string;
  parentId: string | null;
  locked: boolean;
  style: Style;
}

export interface ShapeObject extends Base {
  type: 'shape';
  shapeKind: ShapeKind;
  icon: string | null;
  /** 圖示在文字的哪一側（沒有圖示時不使用） */
  iconPosition: IconPosition;
  autoHeight: boolean;
  text: TextBlock[];
}
export interface TextObject extends Base {
  type: 'text';
  variant: 'body' | 'heading';
  fixedWidth: boolean;
  text: TextBlock[];
}
export interface ConnectorObject extends Base {
  type: 'connector';
  from: ConnectorEnd;
  to: ConnectorEnd;
  waypoints: Point[];
  label: string;
  routing: Routing;
  startArrow: ArrowHead;
  endArrow: ArrowHead;
  dashed: boolean;
}
export interface WireframeObject extends Base {
  type: 'wireframe';
  componentKind: WireframeKind;
  props: Record<string, unknown>;
  text: TextBlock[];
}
export interface TableColumn {
  id: string;
  width: number;
}
export interface TableRow {
  id: string;
  height: number;
}
export interface TableObject extends Base {
  type: 'table';
  columns: TableColumn[];
  rows: TableRow[];
  /** key 為 `${rowId}:${colId}` */
  cells: Record<string, TextBlock[]>;
  headerRow: boolean;
}
export interface ImageObject extends Base {
  type: 'image';
  assetId: string;
  naturalWidth: number;
  naturalHeight: number;
}
export interface LinkCardObject extends Base {
  type: 'link_card';
  targetFileId: string;
  /** 目標檔案標題的快取，分享頁面無法查詢 api 時使用 */
  targetTitle: string;
}
export interface SectionObject extends Base {
  type: 'section';
  title: string;
  frameKind: FrameKind | null;
}
export interface GroupObject extends Base {
  type: 'group';
}
/** 獨立的圖示（Lucide Icons）。顏色與線條粗細使用 style.stroke / style.strokeWidth */
export interface IconObject extends Base {
  type: 'icon';
  /** lucide-react 的圖示名稱（PascalCase，例如 'Database'） */
  iconName: string;
}

export type BoardObject =
  | ShapeObject
  | TextObject
  | ConnectorObject
  | WireframeObject
  | TableObject
  | ImageObject
  | LinkCardObject
  | SectionObject
  | GroupObject
  | IconObject;

export type ObjectOf<T extends ObjectType> = Extract<BoardObject, { type: T }>;
