import type * as Y from 'yjs';
import type { FrameKind, ObjectType, Point, ShapeKind, TextAlign, VerticalAlign, WireframeKind } from '@tinycanvas/shared';
import type { Rect } from './geometry';

export type Tool =
  | { kind: 'select' }
  | { kind: 'hand' }
  | { kind: 'shape'; shapeKind: ShapeKind }
  | { kind: 'text'; variant?: 'body' | 'heading' }
  | { kind: 'connector' }
  | { kind: 'section' }
  | { kind: 'frame'; frameKind: FrameKind }
  | { kind: 'wireframe'; componentKind: WireframeKind }
  | { kind: 'table' }
  | { kind: 'icon'; iconName: string };

export type EditField = 'text' | 'title' | 'label' | 'cell';

export interface EditingState {
  id: string;
  field: EditField;
  cellKey?: string;
  seed?: string;
}

/** 刪除含有內容的區塊時，引擎先不刪除，而是設定這個狀態，由 web app 詢問使用者 */
export interface PendingSectionDelete {
  /** 選取範圍內「有子物件」的區塊 */
  sectionIds: string[];
  /** 這次要刪除的完整選取（含區塊） */
  ids: string[];
}

export interface EditorState {
  tool: Tool;
  selection: string[];
  enteredGroupId: string | null;
  editing: EditingState | null;
  camera: { x: number; y: number; zoom: number };
  canUndo: boolean;
  canRedo: boolean;
  readOnly: boolean;
  selectionScreenBounds: Rect | null;
  selectionTypes: ObjectType[];
  quickConnect: null | { screen: Point; world: Point; fromId: string };
  /** 右鍵選單；在表格上按右鍵時 cellKey 為該儲存格 */
  contextMenu: null | { screen: Point; targetId: string | null; cellKey?: string };
  /** 以下為擴充欄位 */
  pendingSectionDelete: PendingSectionDelete | null;
  /** 正在放置複本（startPlacingDuplicate）：web app 可以顯示提示 */
  placing: boolean;
  /** 正在拖曳物件、線段或連線端點（移動超過門檻後才為 true）；浮動工具列在拖曳期間隱藏 */
  dragging: boolean;
  /** 正在編輯時的幾何資訊（與 getEditingGeometry() 相同），相機或物件變動時更新 */
  editingGeometry: EditingGeometry | null;
  /** 選取範圍是否可以執行各指令（給工具列與右鍵選單判斷灰色） */
  can: {
    group: boolean;
    ungroup: boolean;
    align: boolean;
    distribute: boolean;
    autoLayout: boolean;
    rotate: boolean;
    edit: boolean;
  };
  /** 選取物件是否全部鎖定 */
  selectionLocked: boolean;
}

export interface EditingGeometry {
  id: string;
  field: EditField;
  cellKey?: string;
  /** 文字框（已扣除內距）在畫布容器內的位置與大小（CSS px，未旋轉的框；旋轉以框中心為原點） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 同 x/y/w/h */
  screenRect: Rect;
  /** 同一個框在畫布世界座標中的位置與大小 */
  worldRect: Rect;
  /** 文字框中心（螢幕座標）；旋轉以此為中心 */
  screenCenter: Point;
  zoom: number;
  /** 角度（度） */
  rotation: number;
  /** 世界座標下的字級（px）。覆蓋層應以世界尺寸排版，再以 transform: scale(zoom) 縮放 */
  fontSize: number;
  fontWeight: 400 | 700;
  fontFamily: string;
  lineHeight: number;
  color: string;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  /** true：寬度依內容（自由文字且未固定寬度），覆蓋層不應換行 */
  autoWidth: boolean;
  /** true：高度會隨內容增長（形狀 autoHeight 或文字物件） */
  autoHeight: boolean;
}

export interface EngineLabels {
  /** 新區塊的標題 */
  sectionTitle: string;
  frame: Record<FrameKind, string>;
  /** 連結卡沒有標題時 */
  untitledLink: string;
  /** 圖片載入中 */
  imageLoading: string;
  /** 圖片載入失敗 */
  imageError: string;
  /** 未實作或未知類型的佔位文字 */
  unsupported: string;
  /** 插入線框圖元件時的預設內容（依介面語系）；未提供的元件用 WIREFRAME_DEFAULTS */
  wireframe: Partial<Record<WireframeKind, WireframeContent>>;
}

/** 線框圖元件的可翻譯預設內容：主要文字與 props 內的文字項目 */
export interface WireframeContent {
  text?: string;
  items?: string[];
  columns?: string[];
  body?: string;
  buttons?: string[];
}

export interface EngineOptions {
  doc: Y.Doc;
  container: HTMLElement;
  readOnly?: boolean;
  extraTrackedOrigins?: unknown[];
  loadImage?: (assetId: string) => Promise<CanvasImageSource>;
  uploadImage?: (file: Blob) => Promise<{ assetId: string; width: number; height: number }>;
  onOpenLink?: (fileId: string) => void;
  labels?: Partial<EngineLabels>;
}

export const DEFAULT_LABELS: EngineLabels = {
  sectionTitle: '區塊',
  frame: { phone: '手機', tablet: '平板', browser: '瀏覽器', window: '視窗' },
  untitledLink: '未命名檔案',
  imageLoading: '載入中…',
  imageError: '無法載入圖片',
  unsupported: '尚未支援的物件',
  wireframe: {},
};

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** 匯出範圍內沒有任何物件 */
export class ExportEmptyError extends Error {
  constructor() {
    super('nothing to export');
    this.name = 'ExportEmptyError';
  }
}

export class ExportTooLargeError extends Error {
  constructor(
    public readonly width: number,
    public readonly height: number,
  ) {
    super(`export too large: ${width}x${height}`);
    this.name = 'ExportTooLargeError';
  }
}
