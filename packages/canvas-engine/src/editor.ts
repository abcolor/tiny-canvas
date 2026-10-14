import * as Y from 'yjs';
import {
  GRID_SIZE,
  IMAGE_MIME_TYPES,
  MAX_EXPORT_PIXELS,
  ZOOM_MAX,
  ZOOM_MIN,
  fragmentToPlain,
  type Anchor,
  type AnchorSide,
  type BoardObject,
  type ConnectorEnd,
  type ConnectorObject,
  type NewObjectInput,
  type ObjectType,
  type Point,
  type ShapeKind,
  type ShapeObject,
  type Style,
  newId,
} from '@tinycanvas/shared';
import { EditorModel, type Placement, type GeomPatch, type SectionDeleteMode } from './model';
import { Renderer, type Camera } from './renderer';
import {
  alignGuides,
  avoidAlignOverlap,
  clamp,
  equalSpacingSnap,
  containsPoint,
  dist,
  distToSegment,
  inflate,
  nearestAlignLine,
  normalizeRect,
  objectCorners,
  rectCenter,
  rotatePoint,
  rotatedAabb,
  snap,
  snapAngle,
  spacingGuides,
  toLocal,
  unionRects,
  type AlignGuide,
  type Rect,
} from './geometry';
import {
  drawObjects,
  hitObject,
  linkOpenBox,
  textBoxOf,
  traceRoute,
  type RenderContext,
} from './render/draw';
import { TextLayoutCache } from './render/text';
import { wireframeClick, wireframeDefaults, wireframeHasText, wireframeTextStyle } from './render/wireframe';
import { tableCellAt, tableCellTextBox } from './render/table';
import { taskAt } from './render/text';
import { shapeIcon, shapeTextBox } from './render/shapes';
import { FRAME_SIZES } from './frames';
import { ImageCache } from './render/images';
import { CanvasMeasurer, FontLoader } from './text/measure';
import { alignSegment, computeRoute, type Route } from './connectors/route';
import { anchorPoint, isConnectable, resolveEnds, toObjectLocal } from './connectors/ends';
import { insideOutline, nearestOnOutline, sideOnOutline } from './connectors/outline';
import { CLIPBOARD_MIME, parsePayload } from './clipboard';
import { FONT_FAMILY, NEW_STROKE_WIDTH, SELECTION_COLOR, defaultShapeSize, fontString, resolveStyle } from './style';
import { TEXT_METRICS, monoFont } from './text/layout';
import {
  DEFAULT_LABELS,
  ExportEmptyError,
  ExportTooLargeError,
  type AlignKind,
  type EditField,
  type EditingGeometry,
  type EditingState,
  type EditorState,
  type EngineLabels,
  type EngineOptions,
  type PendingSectionDelete,
  type Tool,
} from './types';

const ZOOM_STEPS = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const DRAG_THRESHOLD = 3;
const HANDLE_SIZE = 8;
const HANDLE_HIT = 7;
/** 在折線中間線段上按住即可拖曳的距離（螢幕像素） */
const SEGMENT_HIT = 6;
/** 拖曳折線線段時，對齊相鄰平行線段的吸附距離（螢幕像素） */
const SEGMENT_ALIGN = 8;
const ROTATE_OFFSET = 24;
/** 外框連接點的感應範圍（螢幕像素）：形狀外側、內側，以及吸附到四邊中點的距離 */
// 拖曳連線端點時，放在外框附近（外側 EDGE_OUT、內側 EDGE_IN 像素內）就固定在該點
const EDGE_OUT = 14;
const EDGE_IN = 6;
// 游標懸停時，在外框內外 EDGE_HOVER 像素內才出現連接點，避免一靠近物件就吸附
const EDGE_HOVER = 2;
const MID_SNAP = 8;
/** 會改動物件或線段的拖曳手勢 */
const DRAG_GESTURES = new Set(['move', 'resize', 'rotate', 'connect', 'endpoint', 'segment', 'tableResize']);
const SIDES: AnchorSide[] = ['top', 'right', 'bottom', 'left'];
const SNAP_PX = 6;
const GUIDE_COLOR = '#e5487a';
/** 等距提示兩端短橫槓的半長（螢幕像素） */
const GAP_CAP = 4;
/** 等距提示線與對齊線重疊時移開的距離（螢幕像素） */
const GAP_OFFSET = 12;

/** 指標附近物件外框上的連接點（p 為畫布座標） */
type EdgeDot = { id: string; anchor: Anchor; p: Point };

type HandleKind = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type Handle =
  | { kind: HandleKind; p: Point }
  | { kind: 'rotate'; p: Point }
  | { kind: 'from' | 'to'; p: Point }
  /** 折線中間線段的控制點：index 為線段在路線上的序號（第 index 點到第 index + 1 點） */
  | { kind: 'segment'; p: Point; index: number; horizontal: boolean };

type Guide = AlignGuide;

type Gesture =
  | { kind: 'none' }
  | {
      kind: 'pending';
      startScreen: Point;
      startWorld: Point;
      hitId: string | null;
      target: string | null;
      sectionBody: boolean;
      shift: boolean;
      wasSelected: boolean;
      /** 已選取的線框圖元件被點擊時，放開滑鼠（沒有拖曳）要切換的 props */
      /** 已選取物件上的點擊（沒有拖曳）要執行的切換：線框圖 props 或核取清單項目 */
      toggle?: (() => void) | null;
    }
  | { kind: 'pan'; last: Point }
  | { kind: 'marquee'; startWorld: Point; curWorld: Point; base: string[] }
  | { kind: 'move'; units: string[]; startWorld: Point; bounds: Rect; dx: number; dy: number; snapRefs: Rect[] | null }
  | {
      kind: 'resize';
      handle: HandleKind;
      units: string[];
      startWorld: Point;
      bounds: Rect;
      single: BoardObject | null;
      proportional: boolean;
      plan: Map<string, GeomPatch>;
      to: Rect;
      snapRefs: Rect[] | null;
    }
  | { kind: 'rotate'; units: string[]; center: Point; startAngle: number; startRotation: number; delta: number }
  | { kind: 'create'; tool: Tool; startWorld: Point; curWorld: Point }
  | { kind: 'connect'; from: ConnectorEnd; fromId: string | null; fromAnchor: Anchor | null; startScreen: Point; curWorld: Point; target: ConnectorEnd | null; origin: Point; constrained?: boolean }
  | { kind: 'endpoint'; connId: string; end: 'from' | 'to'; curWorld: Point; target: ConnectorEnd | null; origin: Point; constrained?: boolean }
  | { kind: 'segment'; connId: string; index: number; horizontal: boolean; points: Point[]; route: Point[] | null }
  | { kind: 'scroll'; axis: 'x' | 'y'; last: Point; scale: number }
  | { kind: 'tableResize'; id: string; axis: 'col' | 'row'; refId: string; start: Point; orig: number };

export interface ExportOptions {
  scope: 'all' | 'selection';
  /** 匯出對話框提供 1x、2x；「複製為圖片」用 3x */
  scale: 1 | 2 | 3;
  background: 'white' | 'transparent';
}

interface SelectionInfo {
  bounds: Rect | null;
  types: ObjectType[];
  can: EditorState['can'];
  locked: boolean;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');

export class BoardEditor {
  readonly doc: Y.Doc;
  readonly undoManager: Y.UndoManager;
  readonly model: EditorModel;
  readonly renderer: Renderer;
  readonly stats: { lastFrameMs: number; frameTimes: number[] };
  readonly labels: EngineLabels;

  private opts: EngineOptions;
  private readOnly: boolean;
  private measurer = new CanvasMeasurer();
  private fonts: FontLoader | null;
  private textCache: TextLayoutCache;
  private images: ImageCache;
  private listeners = new Set<(s: EditorState) => void>();
  private state: EditorState;
  private stateDirty = true;
  private tool: Tool = { kind: 'select' };
  private editing: EditingState | null = null;
  private quickConnect: EditorState['quickConnect'] = null;
  private quickConnectAnchor: Anchor | null = null;
  private contextMenu: EditorState['contextMenu'] = null;
  private pendingSectionDelete: PendingSectionDelete | null = null;
  private gesture: Gesture = { kind: 'none' };
  private hoverId: string | null = null;
  private hoverHandle: Handle | null = null;
  private hoverDot: EdgeDot | null = null;
  private guides: Guide[] = [];
  private spaceDown = false;
  private lastPointer: Point | null = null;
  private overrides = new Map<string, BoardObject>();
  private liveRoutes = new Map<string, Route>();
  private createdForEditing: { id: string; stack: number } | null = null;
  private cleanup: (() => void)[] = [];
  private minimapCache: { canvas: HTMLCanvasElement; version: number; w: number; h: number; bounds: Rect; scale: number } | null = null;
  private destroyed = false;

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.doc = opts.doc;
    this.readOnly = !!opts.readOnly;
    this.labels = { ...DEFAULT_LABELS, ...(opts.labels ?? {}), frame: { ...DEFAULT_LABELS.frame, ...(opts.labels?.frame ?? {}) } };
    this.model = new EditorModel({
      doc: opts.doc,
      extraTrackedOrigins: opts.extraTrackedOrigins,
      measurer: this.measurer,
      readOnly: this.readOnly,
      labels: this.labels,
    });
    this.undoManager = this.model.undoManager;
    const fontSet = typeof document !== 'undefined' && (document as any).fonts ? ((document as any).fonts as FontFaceSet) : null;
    this.fonts = new FontLoader(fontSet as any, () => this.onFontsLoaded(), (cb) => requestAnimationFrame(cb));
    this.textCache = new TextLayoutCache(this.measurer, this.fonts);
    this.images = new ImageCache(opts.loadImage, (assetId) => this.onImageLoaded(assetId));
    this.renderer = new Renderer(opts.container, {
      store: this.model.store,
      renderContext: () => this.baseRenderContext(),
      paintLive: (ctx, rc) => this.paintLive(ctx, rc),
      paintOverlay: (ctx) => this.paintOverlay(ctx),
      afterFrame: () => this.afterFrame(),
    });
    this.stats = this.renderer.stats;
    this.state = this.computeState();

    this.cleanup.push(
      this.model.store.onChange((c) => {
        this.renderer.invalidateWorld(c.dirty);
        this.renderer.invalidateOverlay();
        if (this.overrides.size) this.renderer.invalidateLive();
        this.minimapCache = this.minimapCache ? { ...this.minimapCache, version: -1 } : null;
        if (this.editing && !this.model.store.get(this.editing.id)) this.stopEditing();
        this.markState();
      }),
      this.model.onSelectionChange(() => {
        this.renderer.invalidateOverlay();
        this.markState();
      }),
    );
    const onStack = () => this.markState();
    this.undoManager.on('stack-item-added', onStack);
    this.undoManager.on('stack-item-popped', onStack);
    this.cleanup.push(() => {
      this.undoManager.off('stack-item-added', onStack);
      this.undoManager.off('stack-item-popped', onStack);
    });
    this.attachEvents();
    // 初始相機：內容置中
    const b = this.model.store.contentBounds();
    if (b) this.zoomToFit();
    else this.renderer.camera = { x: -this.renderer.cssW / 2, y: -this.renderer.cssH / 2, zoom: 1 };
    this.renderer.invalidateAll();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const c of this.cleanup) c();
    this.fonts?.destroy();
    this.renderer.destroy();
    this.model.destroy();
    this.listeners.clear();
  }

  focus() {
    this.renderer.root.focus({ preventScroll: true });
  }

  /**
   * 焦點不在畫布上（例如剛點過浮動工具列的按鈕，或工具列消失後焦點落在 body）時，由 web app 轉送的按鍵。
   * Enter、空白鍵、Tab 留給按鈕本身。引擎處理了這個按鍵時把焦點還給畫布，之後的按鍵直接由畫布處理。回傳是否處理
   */
  handleExternalKeyDown(e: KeyboardEvent): boolean {
    if (this.destroyed || e.defaultPrevented || e.isComposing) return false;
    if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space' || e.key === 'Tab') return false;
    this.onKeyDown(e);
    if (!e.defaultPrevented) return false;
    this.focus();
    return true;
  }

  /** 引擎的可聚焦根元素（web app 可以用來判斷焦點） */
  get element(): HTMLElement {
    return this.renderer.root;
  }

  // =================================================================== state

  getState(): EditorState {
    if (this.stateDirty) {
      this.state = this.computeState();
      this.stateDirty = false;
    }
    return this.state;
  }

  subscribe(listener: (s: EditorState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private markState() {
    this.stateDirty = true;
    this.renderer.requestFrame();
  }

  private afterFrame() {
    if (!this.stateDirty) return;
    const s = this.getState();
    for (const l of this.listeners) l(s);
  }

  /**
   * 立即通知訂閱者，不等下一幀。用於開始 / 結束編輯：覆蓋層必須在同一個按鍵事件內掛上並取得焦點，
   * 否則緊接著輸入的字元會落到畫布上。
   */
  private flushState() {
    this.markState();
    this.afterFrame();
  }

  private selMemo: { sel: string[]; version: number; entered: string | null; locked: boolean; data: SelectionInfo } | null = null;

  /** 選取相關、與相機無關的資訊；選取或內容沒變時重用 */
  private selectionInfo(): SelectionInfo {
    const m = this.model;
    const sel = m.selection;
    const memo = this.selMemo;
    if (memo && memo.sel === sel && memo.version === m.store.version && memo.entered === m.enteredGroupId) return memo.data;
    const objs = sel.map((id) => m.store.get(id)).filter(Boolean) as BoardObject[];
    const single = objs.length === 1 ? objs[0] : undefined;
    const nonConn = objs.filter((o) => o.type !== 'connector').length;
    const data: SelectionInfo = {
      bounds: m.selectionBounds(),
      types: Array.from(new Set(objs.map((o) => o.type))),
      can: {
        group: !this.readOnly && m.canGroup(),
        ungroup: !this.readOnly && m.canUngroup(),
        align: !this.readOnly && nonConn >= 2,
        distribute: !this.readOnly && nonConn >= 3,
        autoLayout: !this.readOnly && objs.filter((o) => o.type !== 'connector' && o.type !== 'section').length >= 2,
        rotate: !this.readOnly && m.canRotate(),
        edit: !this.readOnly && !!single && this.editableField(single) !== null && !m.isLocked(single.id),
      },
      locked: sel.length > 0 && sel.every((id) => m.isLocked(id)),
    };
    this.selMemo = { sel, version: m.store.version, entered: m.enteredGroupId, locked: data.locked, data };
    return data;
  }

  private computeState(): EditorState {
    const m = this.model;
    const info = this.selectionInfo();
    const cam = this.renderer.camera;
    return {
      tool: this.tool,
      selection: m.selection.slice(),
      enteredGroupId: m.enteredGroupId,
      editing: this.editing ? { ...this.editing } : null,
      camera: { x: cam.x, y: cam.y, zoom: cam.zoom },
      canUndo: !this.readOnly && this.undoManager.undoStack.length > 0,
      canRedo: !this.readOnly && this.undoManager.redoStack.length > 0,
      readOnly: this.readOnly,
      selectionScreenBounds: info.bounds ? this.worldRectToScreen(info.bounds) : null,
      selectionTypes: info.types,
      quickConnect: this.quickConnect,
      contextMenu: this.contextMenu,
      pendingSectionDelete: this.pendingSectionDelete,
      placing: !!this.placing,
      dragging: this.dragging,
      editingGeometry: this.getEditingGeometry(),
      can: info.can,
      selectionLocked: info.locked,
    };
  }

  // =================================================================== tools

  setTool(tool: Tool) {
    if (this.readOnly && tool.kind !== 'select' && tool.kind !== 'hand') return;
    this.tool = tool;
    this.cancelPlacing();
    this.cancelGesture();
    this.updateCursor();
    this.renderer.invalidateOverlay();
    this.markState();
  }

  // =================================================================== camera

  screenToWorld(p: Point): Point {
    const c = this.renderer.camera;
    return { x: c.x + p.x / c.zoom, y: c.y + p.y / c.zoom };
  }

  worldToScreen(p: Point): Point {
    const c = this.renderer.camera;
    return { x: (p.x - c.x) * c.zoom, y: (p.y - c.y) * c.zoom };
  }

  private worldRectToScreen(r: Rect): Rect {
    const p = this.worldToScreen(r);
    const z = this.renderer.camera.zoom;
    return { x: p.x, y: p.y, w: r.w * z, h: r.h * z };
  }

  private setCamera(c: Camera) {
    this.renderer.camera = c;
    this.renderer.invalidateOverlay();
    if (this.overrides.size || this.placing) this.renderer.invalidateLive();
    this.renderer.requestFrame();
    this.contextMenu = null;
    if (this.quickConnect) this.quickConnect = { ...this.quickConnect, screen: this.worldToScreen(this.quickConnect.world) };
    this.markState();
  }

  setZoom(zoom: number, anchorScreen?: Point) {
    const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    const c = this.renderer.camera;
    const a = anchorScreen ?? { x: this.renderer.cssW / 2, y: this.renderer.cssH / 2 };
    const w = this.screenToWorld(a);
    this.setCamera({ x: w.x - a.x / z, y: w.y - a.y / z, zoom: z });
    void c;
  }

  zoomIn() {
    const z = this.renderer.camera.zoom;
    this.setZoom(ZOOM_STEPS.find((s) => s > z + 1e-6) ?? ZOOM_MAX);
  }

  zoomOut() {
    const z = this.renderer.camera.zoom;
    this.setZoom([...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? ZOOM_MIN);
  }

  private fitRect(r: Rect, maxZoom: number) {
    const pad = 48;
    const W = this.renderer.cssW;
    const H = this.renderer.cssH;
    const z = clamp(Math.min((W - pad * 2) / Math.max(r.w, 1), (H - pad * 2) / Math.max(r.h, 1)), ZOOM_MIN, maxZoom);
    const c = rectCenter(r);
    this.setCamera({ x: c.x - W / 2 / z, y: c.y - H / 2 / z, zoom: z });
  }

  zoomToFit() {
    const b = this.getContentBounds();
    if (b) this.fitRect(b, 1);
  }

  zoomToSelection() {
    const b = this.model.selectionBounds();
    if (b) this.fitRect(b, 2);
    else this.zoomToFit();
  }

  panBy(dxScreen: number, dyScreen: number) {
    const c = this.renderer.camera;
    const dpr = this.renderer.dpr;
    // 以整數裝置像素平移，靜態層可以直接位移重用
    const dx = Math.round(dxScreen * dpr) / (dpr * c.zoom);
    const dy = Math.round(dyScreen * dpr) / (dpr * c.zoom);
    if (!dx && !dy) return;
    this.setCamera({ x: c.x - dx, y: c.y - dy, zoom: c.zoom });
  }

  centerOn(world: Point) {
    const c = this.renderer.camera;
    this.setCamera({ x: world.x - this.renderer.cssW / 2 / c.zoom, y: world.y - this.renderer.cssH / 2 / c.zoom, zoom: c.zoom });
  }

  getObjectScreenRect(id: string): { x: number; y: number; w: number; h: number; rotation: number } | null {
    const o = this.model.store.get(id);
    if (!o) return null;
    if (o.type === 'connector') {
      const b = this.model.unitBounds(id)!;
      return { ...this.worldRectToScreen(b), rotation: 0 };
    }
    return { ...this.worldRectToScreen(o), rotation: o.rotation };
  }

  /** 所有物件的外接框（連線只計入懸空端點；接在物件上的端點已包含在物件內） */
  getContentBounds(): Rect | null {
    const s = this.model.store;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (r: Rect) => {
      if (r.x < x0) x0 = r.x;
      if (r.y < y0) y0 = r.y;
      if (r.x + r.w > x1) x1 = r.x + r.w;
      if (r.y + r.h > y1) y1 = r.y + r.h;
    };
    for (const o of s.objects.values()) {
      if (o.type === 'connector') {
        for (const e of [o.from, o.to]) if (!e.objectId || !s.get(e.objectId)) add({ x: e.x ?? 0, y: e.y ?? 0, w: 0, h: 0 });
      } else if (o.type !== 'group') add(rotatedAabb(o));
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // =================================================================== selection & commands

  select(ids: string[]) {
    this.model.setSelection(ids);
  }

  selectAll() {
    const m = this.model;
    const g = m.enteredGroupId;
    const ids = g ? m.store.children(g) : Array.from(m.store.objects.values()).filter((o) => m.store.effectiveParent(o) === null).map((o) => o.id);
    m.setSelection(ids);
  }

  clearSelection() {
    this.model.setSelection([]);
  }

  /**
   * 刪除選取。選取內有「含子物件的區塊」且沒有指定 sectionMode 時不刪除，
   * 改設定 state.pendingSectionDelete，由 web app 詢問後再呼叫 deleteSelection({ sectionMode })；取消則呼叫 cancelSectionDelete()。
   */
  deleteSelection(opts: { sectionMode?: SectionDeleteMode } = {}) {
    if (this.readOnly) return;
    const ids = this.pendingSectionDelete?.ids ?? this.model.selection;
    if (!opts.sectionMode) {
      const sections = this.model.sectionsNeedingConfirm(ids);
      if (sections.length) {
        this.pendingSectionDelete = { sectionIds: sections, ids: ids.slice() };
        this.markState();
        return;
      }
    }
    this.pendingSectionDelete = null;
    this.model.stopCapturing();
    this.model.deleteIds(ids, opts.sectionMode ?? 'with-contents');
    this.model.stopCapturing();
    this.markState();
  }

  cancelSectionDelete() {
    this.pendingSectionDelete = null;
    this.markState();
  }

  /** 回應 pendingSectionDelete 的詢問：mode 為 null 表示取消 */
  resolveSectionDelete(mode: SectionDeleteMode | null) {
    if (!this.pendingSectionDelete) return;
    if (mode === null) this.cancelSectionDelete();
    else this.deleteSelection({ sectionMode: mode });
  }

  // 表格（列與欄以 id 指定）
  tableInsertRow(tableId: string, refRowId: string, where: 'above' | 'below') {
    this.step(() => this.model.tableInsertRow(tableId, refRowId, where));
  }
  tableInsertColumn(tableId: string, refColId: string, where: 'left' | 'right') {
    this.step(() => this.model.tableInsertColumn(tableId, refColId, where));
  }
  tableDeleteRow(tableId: string, rowId: string) {
    this.step(() => this.model.tableDeleteRow(tableId, rowId));
  }
  tableDeleteColumn(tableId: string, colId: string) {
    this.step(() => this.model.tableDeleteColumn(tableId, colId));
  }

  /** 以工具的預設尺寸在畫面中心插入物件（指令面板、元件庫使用）。文字物件會直接進入編輯。回傳 id */
  insertWithTool(tool: Tool): string | null {
    if (this.readOnly) return null;
    const c = this.screenToWorld({ x: this.renderer.cssW / 2, y: this.renderer.cssH / 2 });
    const input = this.defaultInputFor(tool, c, null);
    if (!input) {
      this.setTool(tool);
      return null;
    }
    this.model.stopCapturing();
    const id = this.model.insert(input);
    if (tool.kind === 'text') {
      this.createdForEditing = { id, stack: this.undoManager.undoStack.length };
      this.startEditing(id);
    } else this.model.stopCapturing();
    // 進入編輯時焦點交給文字覆蓋層，不可搶回
    if (!this.editing) this.focus();
    return id;
  }

  private step<T>(fn: () => T): T {
    this.model.stopCapturing();
    const r = fn();
    this.model.stopCapturing();
    return r;
  }

  duplicateSelection() {
    if (!this.readOnly) this.step(() => this.model.duplicate());
  }
  group() {
    if (!this.readOnly) this.step(() => this.model.group());
  }
  ungroup() {
    if (!this.readOnly) this.step(() => this.model.ungroup());
  }
  rotateEach(delta: number) {
    if (!this.readOnly) this.step(() => this.model.rotateEach(delta));
  }
  bringForward() {
    this.step(() => this.model.bringForward());
  }
  sendBackward() {
    this.step(() => this.model.sendBackward());
  }
  bringToFront() {
    this.step(() => this.model.bringToFront());
  }
  sendToBack() {
    this.step(() => this.model.sendToBack());
  }
  setLocked(locked: boolean) {
    this.step(() => this.model.setLocked(locked));
    this.markState();
  }
  align(kind: AlignKind) {
    this.step(() => this.model.align(kind));
  }
  distribute(axis: 'h' | 'v') {
    this.step(() => this.model.distribute(axis));
  }
  setStyle(patch: Partial<Style>) {
    this.model.setStyle(patch);
  }
  copyStyle() {
    this.model.copyStyle();
  }
  pasteStyle() {
    this.step(() => this.model.pasteStyle());
  }
  updateObject(id: string, patch: Record<string, unknown>) {
    this.model.updateObject(id, patch);
  }
  extend(direction: 'up' | 'down' | 'left' | 'right') {
    if (this.readOnly) return;
    const id = this.step(() => this.model.extend(direction));
    if (id) this.ensureVisible(id);
  }
  async autoLayout(direction: 'down' | 'right'): Promise<void> {
    if (this.readOnly) return;
    this.model.stopCapturing();
    await this.model.autoLayout(direction);
    this.model.stopCapturing();
  }

  /** 新增物件。atViewportCenter 時以畫面中心為物件中心（忽略 input 的 x/y） */
  insert(input: NewObjectInput, opts: { select?: boolean; atViewportCenter?: boolean } = {}): string {
    if (this.readOnly) return '';
    let inp = input;
    if (opts.atViewportCenter) {
      const c = this.screenToWorld({ x: this.renderer.cssW / 2, y: this.renderer.cssH / 2 });
      inp = { ...input, x: snap(c.x - input.w / 2, GRID_SIZE), y: snap(c.y - input.h / 2, GRID_SIZE) };
    }
    return this.step(() => this.model.insert(inp, { select: opts.select !== false }));
  }

  async insertImageFile(file: Blob, at?: Point): Promise<void> {
    if (this.readOnly || !this.opts.uploadImage) return;
    if (file.type && !(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return;
    const { assetId, width, height } = await this.opts.uploadImage(file);
    const maxSide = 480;
    const s = Math.min(1, maxSide / Math.max(width, height, 1));
    const w = Math.max(16, Math.round(width * s));
    const h = Math.max(16, Math.round(height * s));
    const c = at ?? this.screenToWorld({ x: this.renderer.cssW / 2, y: this.renderer.cssH / 2 });
    this.step(() =>
      this.model.insert({
        type: 'image',
        x: snap(c.x - w / 2, GRID_SIZE),
        y: snap(c.y - h / 2, GRID_SIZE),
        w,
        h,
        assetId,
        naturalWidth: width,
        naturalHeight: height,
      }),
    );
  }

  completeQuickConnect(shapeKind: ShapeKind) {
    const q = this.quickConnect;
    if (!q || this.readOnly) return;
    const anchor = this.quickConnectAnchor ?? 'right';
    const src = this.model.store.get(q.fromId);
    const side = typeof anchor === 'string' ? anchor : src ? anchorPoint(src, anchor).side : 'right';
    this.quickConnect = null;
    this.quickConnectAnchor = null;
    this.step(() => this.model.createConnectedShape(q.fromId, side, shapeKind, q.world, anchor));
    this.renderer.invalidateOverlay();
    this.markState();
  }

  cancelQuickConnect() {
    this.quickConnect = null;
    this.quickConnectAnchor = null;
    this.renderer.invalidateOverlay();
    this.markState();
  }

  // =================================================================== 放置複本

  /**
   * 進入「放置複本」模式：選取（含子孫與兩端都在範圍內的連線）的預覽跟著指標移動，
   * 外接框左上角對齊指標（吸附格線，按住 Alt 不吸附）。主要按鍵在畫布上按下時以一個 transaction 建立複本並選取；
   * Esc、右鍵、cancelPlacing()、切換工具或開始編輯都會取消。放置期間不寫入文件。
   * 唯讀或沒有可複製的物件時回傳 false。
   */
  startPlacingDuplicate(): boolean {
    if (this.readOnly) return false;
    if (this.editing) this.stopEditing({ refocus: false });
    const p = this.model.preparePlacement();
    if (!p) return false;
    this.cancelGesture();
    this.contextMenu = null;
    this.placing = p;
    this.renderer.setLiveOpacity(0.85);
    this.renderer.invalidateLive();
    this.renderer.invalidateOverlay();
    this.updateCursor();
    this.focus();
    this.markState();
    return true;
  }

  cancelPlacing() {
    if (!this.placing) return;
    this.placing = null;
    this.renderer.setLiveOpacity(1);
    this.renderer.invalidateLive();
    this.renderer.invalidateOverlay();
    this.updateCursor();
    this.markState();
  }

  /** 目前預覽的外接框左上角（世界座標）；指標不在畫布上時為 null */
  private placingTopLeft(alt = this.altDown): Point | null {
    return this.placingSnap(alt)?.tl ?? null;
  }

  /**
   * 放置預覽的吸附：與拖曳移動相同（智慧參考線、等距提示，否則吸附格線；按住 Alt 不吸附）。
   * 依指標、鏡頭、Alt 與文件版本記憶，繪製時可重複呼叫
   */
  private placingSnap(alt = this.altDown): { tl: Point; guides: Guide[] } | null {
    if (!this.placing || !this.pointerInside || !this.lastPointer) return null;
    const cam = this.renderer.camera;
    const viewKey = `${cam.x},${cam.y},${cam.zoom},${this.model.store.version}`;
    const key = `${viewKey},${this.lastPointer.x},${this.lastPointer.y},${alt}`;
    const memo = this.placingSnapMemo;
    if (memo && memo.placing === this.placing && memo.key === key) return memo.result;
    const refs = memo && memo.placing === this.placing && memo.viewKey === viewKey ? memo.refs : this.snapReferences();
    const raw = this.model.placementTopLeft(this.screenToWorld(this.lastPointer), true);
    const b = { x: raw.x, y: raw.y, w: this.placing.bounds.w, h: this.placing.bounds.h };
    const snapped = this.snapMove(b, 0, 0, alt, refs);
    const result = { tl: { x: raw.x + snapped.dx, y: raw.y + snapped.dy }, guides: snapped.guides };
    this.placingSnapMemo = { placing: this.placing, key, viewKey, refs, result };
    return result;
  }
  private placingSnapMemo: { placing: Placement; key: string; viewKey: string; refs: Rect[]; result: { tl: Point; guides: Guide[] } } | null = null;

  private commitPlacing(alt: boolean) {
    const p = this.placing;
    const tl = this.placingTopLeft(alt);
    if (!p || !tl) return;
    this.placing = null;
    this.renderer.setLiveOpacity(1);
    this.model.stopCapturing();
    this.model.commitPlacement(p, tl);
    this.model.stopCapturing();
    this.renderer.invalidateLive();
    this.renderer.invalidateOverlay();
    this.updateCursor();
    this.markState();
  }

  closeContextMenu() {
    this.contextMenu = null;
    this.markState();
  }

  undo() {
    if (this.editing) this.stopEditing();
    this.model.undo();
  }

  redo() {
    if (this.editing) this.stopEditing();
    this.model.redo();
  }

  // =================================================================== text editing

  private editableField(o: BoardObject): EditField | null {
    switch (o.type) {
      case 'shape':
      case 'text':
        return 'text';
      case 'wireframe':
        return wireframeHasText(o.componentKind) ? 'text' : null;
      case 'section':
        return 'title';
      case 'connector':
        return 'label';
      case 'table':
        return 'cell';
      default:
        return null;
    }
  }

  /**
   * 開始編輯。引擎只管理狀態與幾何，不修改內容。seed：使用者選取物件後直接打的第一個字元，
   * 覆蓋層綁定後應以 seed 取代全部內容並把游標放在最後（packages/editor 的 RichTextOverlay 已實作）。
   */
  startEditing(id: string, opts: { field?: EditField; cellKey?: string; seed?: string } = {}) {
    if (this.readOnly) return;
    const o = this.model.store.get(id);
    if (!o || this.model.isLocked(id)) return;
    this.cancelPlacing();
    const field = opts.field ?? this.editableField(o);
    if (!field) return;
    let cellKey = opts.cellKey;
    if (field === 'cell' && !cellKey && o.type === 'table' && o.rows[0] && o.columns[0]) cellKey = `${o.rows[0].id}:${o.columns[0].id}`;
    if (field === 'cell' && !cellKey) return;
    // 切換編輯目標時不把焦點還給畫布（覆蓋層會重新掛上並取得焦點）
    if (this.editing) this.stopEditing({ refocus: false });
    this.model.stopCapturing();
    if (field === 'cell' && cellKey) {
      // 兩個分頁同時增加列與欄時，交叉的儲存格可能不存在；編輯前補上
      this.model.ensureCell(id, cellKey);
      this.model.stopCapturing();
    }
    this.editing = { id, field, cellKey, seed: opts.seed };
    if (!this.model.selection.includes(id)) this.model.setSelection([id]);
    this.invalidateObject(id);
    this.ensureVisible(id);
    this.flushState();
  }

  stopEditing(opts: { refocus?: boolean } = {}) {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    const o = this.model.store.get(e.id);
    if (o && o.type === 'text' && e.field === 'text' && !fragmentToPlain(this.getFragment(e.id, 'text')).trim()) {
      // 空白的自由文字在結束編輯時刪除；剛建立且沒有其他步驟時直接復原建立動作
      const c = this.createdForEditing;
      if (c && c.id === e.id && this.undoManager.undoStack.length === c.stack) {
        this.undoManager.undo();
        this.undoManager.redoStack.pop();
      } else this.model.deleteIds([e.id]);
    }
    this.createdForEditing = null;
    if (o) this.invalidateObject(e.id);
    this.model.stopCapturing();
    if (opts.refocus !== false) this.focus();
    this.flushState();
  }

  /**
   * 編輯表格儲存格時移動到相鄰儲存格（Tab = (1,0)、Shift+Tab = (-1,0)、上下 = (0,±1)）。
   * 在最後一格按 Tab 會在最下方新增一列。web app 的覆蓋層攔截 Tab 時應呼叫它；
   * 若 Tab 事件傳到引擎的根元素，引擎也會自己處理。回傳是否移動。
   */
  moveEditingCell(dx: number, dy: number): boolean {
    const e = this.editing;
    if (!e || e.field !== 'cell' || !e.cellKey) return false;
    const o = this.model.store.get(e.id);
    if (!o || o.type !== 'table') return false;
    let key = this.model.neighborCell(e.id, e.cellKey, dx, dy);
    if (!key && dx > 0 && dy === 0 && !this.readOnly) {
      const lastRow = o.rows[o.rows.length - 1];
      this.model.stopCapturing();
      const rid = lastRow ? this.model.tableInsertRow(e.id, lastRow.id, 'below') : null;
      if (rid && o.columns[0]) key = `${rid}:${o.columns[0].id}`;
    }
    if (!key) return false;
    this.startEditing(e.id, { field: 'cell', cellKey: key });
    return true;
  }

  private getFragment(id: string, field: EditField, cellKey?: string): Y.XmlFragment | null {
    const m = this.model.ymap.get(id);
    if (!m) return null;
    if (field === 'text') {
      const f = m.get('text');
      return f instanceof Y.XmlFragment ? f : null;
    }
    if (field === 'cell' && cellKey) {
      const cells = m.get('cells');
      const f = cells instanceof Y.Map ? cells.get(cellKey) : null;
      return f instanceof Y.XmlFragment ? f : null;
    }
    return null;
  }

  /** 覆蓋層要綁定的 Y.XmlFragment；title 與 label 是純字串欄位，回傳 null（以 updateObject 寫回） */
  getEditingFragment(): Y.XmlFragment | null {
    const e = this.editing;
    return e ? this.getFragment(e.id, e.field, e.cellKey) : null;
  }

  getEditingGeometry(): EditingGeometry | null {
    const e = this.editing;
    if (!e) return null;
    const o = this.model.store.get(e.id);
    if (!o) return null;
    const rc = { ...this.baseRenderContext(), zoom: this.renderer.camera.zoom };
    const box = textBoxOf(o, e.field, e.cellKey, rc);
    if (!box) return null;
    const st = resolveStyle(o);
    const z = this.renderer.camera.zoom;
    const center = rotatePoint(rectCenter(box), rectCenter(o), o.type === 'connector' ? 0 : o.rotation);
    const sc = this.worldToScreen(center);
    const screenRect = { x: sc.x - (box.w * z) / 2, y: sc.y - (box.h * z) / 2, w: box.w * z, h: box.h * z };
    let fontSize = st.fontSize;
    let weight = st.fontWeight;
    let align = st.textAlign;
    let valign = st.verticalAlign;
    if (e.field === 'title') {
      fontSize = 13;
      weight = 700;
      align = 'left';
      valign = 'middle';
    } else if (e.field === 'label') {
      align = 'center';
      valign = 'middle';
    } else if (o.type === 'text') valign = 'top';
    else if (o.type === 'wireframe') {
      const ws = wireframeTextStyle(o);
      if (ws) {
        fontSize = ws.fontSize;
        weight = ws.fontWeight;
        align = ws.textAlign;
        valign = ws.verticalAlign;
      }
    }
    else if (o.type === 'table') {
      valign = 'middle';
      if (o.headerRow && e.cellKey?.split(':')[0] === o.rows[0]?.id) weight = 700;
    }
    return {
      id: e.id,
      field: e.field,
      cellKey: e.cellKey,
      ...screenRect,
      screenRect,
      worldRect: box,
      screenCenter: sc,
      zoom: z,
      rotation: o.type === 'connector' ? 0 : o.rotation,
      fontSize,
      fontWeight: weight,
      fontFamily: FONT_FAMILY,
      lineHeight: TEXT_METRICS.lineHeight,
      color: o.type === 'wireframe' ? (wireframeTextStyle(o)?.color ?? st.textColor) : st.textColor,
      textAlign: align,
      verticalAlign: valign,
      autoWidth: (o.type === 'text' && !o.fixedWidth) || (o.type === 'wireframe' && !wireframeTextStyle(o)?.wrap),
      autoHeight: (o.type === 'shape' && o.autoHeight) || o.type === 'text' || o.type === 'table',
    };
  }

  // =================================================================== clipboard

  serializeSelection(): string | null {
    return this.model.serialize();
  }

  /** 以非同步 Clipboard API 複製（右鍵選單使用；鍵盤 Mod+C 走原生 copy 事件） */
  async copySelectionToClipboard(): Promise<boolean> {
    const data = this.model.serialize();
    if (!data) return false;
    try {
      const CI = (globalThis as any).ClipboardItem;
      if (CI && navigator.clipboard?.write) {
        try {
          await navigator.clipboard.write([
            new CI({
              [CLIPBOARD_MIME]: new Blob([data], { type: CLIPBOARD_MIME }),
              'text/plain': new Blob([data], { type: 'text/plain' }),
            }),
          ]);
          return true;
        } catch {
          /* 不支援自訂格式時退回純文字 */
        }
      }
      await navigator.clipboard.writeText(data);
      return true;
    } catch {
      return false;
    }
  }

  async cutSelectionToClipboard(): Promise<boolean> {
    if (this.readOnly) return false;
    const ok = await this.copySelectionToClipboard();
    if (ok) this.deleteSelection({ sectionMode: 'with-contents' });
    return ok;
  }

  /** 以非同步 Clipboard API 貼上（右鍵選單使用）：自訂格式、圖片或純文字 */
  async pasteFromClipboard(at?: Point): Promise<void> {
    if (this.readOnly || !navigator.clipboard) return;
    const where = at ?? this.pastePoint();
    try {
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes(CLIPBOARD_MIME)) {
            const text = await (await item.getType(CLIPBOARD_MIME)).text();
            if (parsePayload(text)) return this.pasteSerialized(text, at);
          }
          const img = item.types.find((t) => (IMAGE_MIME_TYPES as readonly string[]).includes(t));
          if (img) return this.insertImageFile(await item.getType(img), where);
          if (item.types.includes('text/plain')) {
            const text = await (await item.getType('text/plain')).text();
            if (parsePayload(text)) return this.pasteSerialized(text, at);
            if (text.trim()) {
              this.step(() => this.model.pasteText(text, where));
              return;
            }
          }
        }
        return;
      }
      const text = await navigator.clipboard.readText();
      if (parsePayload(text)) this.pasteSerialized(text, at);
      else if (text.trim()) this.step(() => this.model.pasteText(text, where));
    } catch {
      /* 使用者拒絕剪貼簿權限 */
    }
  }

  pasteSerialized(data: string, at?: Point) {
    if (this.readOnly) return;
    const p = parsePayload(data);
    if (!p) return;
    let target = at;
    if (!target && !this.renderer.isVisible(p.bounds)) target = this.pastePoint();
    this.step(() => this.model.paste(data, target ? { at: target } : {}));
  }

  private pastePoint(): Point {
    const lp = this.lastPointer;
    if (lp && lp.x >= 0 && lp.y >= 0 && lp.x <= this.renderer.cssW && lp.y <= this.renderer.cssH) return this.screenToWorld(lp);
    return this.screenToWorld({ x: this.renderer.cssW / 2, y: this.renderer.cssH / 2 });
  }

  // =================================================================== export / minimap

  private scopeObjects(scope: 'all' | 'selection'): BoardObject[] {
    const s = this.model.store;
    if (scope === 'all') return s.getOrder().map((id) => s.get(id)!).filter(Boolean);
    const ids = new Set<string>();
    for (const u of this.model.selection) {
      ids.add(u);
      for (const d of s.descendants(u)) ids.add(d);
    }
    return s.sortByOrder(Array.from(ids)).map((id) => s.get(id)!).filter(Boolean);
  }

  async exportPng(opts: ExportOptions): Promise<Blob> {
    const objs = this.scopeObjects(opts.scope);
    if (!objs.length) throw new ExportEmptyError();
    const rects = objs.map((o) => (o.type === 'connector' ? this.model.unitBounds(o.id)! : rotatedAabb(o)));
    const b0 = unionRects(rects) ?? { x: 0, y: 0, w: 1, h: 1 };
    const b = inflate(b0, 24);
    const W = Math.ceil(b.w * opts.scale);
    const H = Math.ceil(b.h * opts.scale);
    if (W > MAX_EXPORT_PIXELS || H > MAX_EXPORT_PIXELS) throw new ExportTooLargeError(W, H);
    // 等待字型子集與圖片
    const entries: [string, string][] = [];
    for (const o of objs) {
      const st = resolveStyle(o);
      const texts: string[] = [];
      if ('text' in o && Array.isArray(o.text)) texts.push(o.text.map((bl) => bl.runs.map((r) => r.text).join('')).join('\n'));
      if (o.type === 'section') texts.push(o.title || (o.frameKind ? this.labels.frame[o.frameKind] : ''));
      if (o.type === 'connector') texts.push(o.label);
      if (o.type === 'link_card') texts.push(o.targetTitle || this.labels.untitledLink);
      if (o.type === 'table') for (const c of Object.values(o.cells)) texts.push(c.map((bl) => bl.runs.map((r) => r.text).join('')).join('\n'));
      const t = texts.join('\n');
      if (!t.trim()) continue;
      // 與排版相同的字型：基本字級、標題倍率、標籤 13px，以及行內程式碼與程式碼區塊的等寬字型（0.9em）
      const hs = TEXT_METRICS.headingScale;
      for (const size of new Set([st.fontSize, 13, ...[1, 2, 3].map((l) => Math.round(st.fontSize * (hs[l] ?? 1) * 100) / 100)])) {
        for (const w of [400, 700]) {
          entries.push([fontString(size, w), t]);
          entries.push([fontString(size, w, true), t]);
          const mono = Math.round(size * TEXT_METRICS.codeScale * 100) / 100;
          entries.push([monoFont(mono, w), t]);
          entries.push([monoFont(mono, w, true), t]);
        }
      }
    }
    await this.fonts?.loadAll(entries);
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) await (document as any).fonts.ready;
    this.measurer.clear();
    this.textCache.clear();
    await this.images.ensure(objs.filter((o) => o.type === 'image').map((o) => (o as any).assetId));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    if (opts.background === 'white') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
    }
    const k = opts.scale;
    ctx.setTransform(k, 0, 0, k, -b.x * k, -b.y * k);
    const rc: RenderContext = { ...this.baseRenderContext(), zoom: k, editing: null, exporting: true, canOpenLinks: false };
    drawObjects(ctx, objs, rc);
    this.renderer.invalidateAll();
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png'));
  }

  /** 小地圖：簡化的內容（以快取圖片重用）加上目前視窗範圍。web app 在狀態變更時呼叫（建議節流） */
  renderMinimap(canvas: HTMLCanvasElement) {
    const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
    const cw = canvas.clientWidth || canvas.width;
    const ch = canvas.clientHeight || canvas.height;
    const W = Math.round(cw * dpr);
    const H = Math.round(ch * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d')!;
    const view = this.renderer.viewportWorld();
    const content = this.model.store.contentBounds();
    const bounds = inflate(unionRects(content ? [content, view] : [view])!, 40);
    const scale = Math.min(W / bounds.w, H / bounds.h);
    const ox = (W - bounds.w * scale) / 2;
    const oy = (H - bounds.h * scale) / 2;
    let cache = this.minimapCache;
    const version = this.model.store.version;
    const same = cache && cache.version === version && cache.w === W && cache.h === H && cache.scale === scale && cache.bounds.x === bounds.x && cache.bounds.y === bounds.y;
    if (!same) {
      const c = cache?.canvas ?? document.createElement('canvas');
      c.width = W;
      c.height = H;
      const mctx = c.getContext('2d')!;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, W, H);
      mctx.setTransform(scale, 0, 0, scale, ox - bounds.x * scale, oy - bounds.y * scale);
      const fills = new Map<string, Path2D>();
      for (const o of this.model.store.objects.values()) {
        if (o.type === 'connector' || o.type === 'group') continue;
        const st = resolveStyle(o);
        const color = o.type === 'section' ? '#e3e7eb' : st.fill === '#ffffff' || st.fill === 'transparent' ? '#b8c1ca' : st.fill;
        let p = fills.get(color);
        if (!p) fills.set(color, (p = new Path2D()));
        const r = rotatedAabb(o);
        p.rect(r.x, r.y, Math.max(r.w, 1 / scale), Math.max(r.h, 1 / scale));
      }
      // 區塊先畫
      const entries = Array.from(fills.entries()).sort((a, b) => (a[0] === '#e3e7eb' ? -1 : b[0] === '#e3e7eb' ? 1 : 0));
      for (const [color, p] of entries) {
        mctx.fillStyle = color;
        mctx.fill(p);
      }
      cache = { canvas: c, version, w: W, h: H, bounds, scale };
      this.minimapCache = cache;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(cache!.canvas, 0, 0);
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1.5 * dpr;
    ctx.fillStyle = 'rgba(0,135,220,0.08)';
    const vx = ox + (view.x - bounds.x) * scale;
    const vy = oy + (view.y - bounds.y) * scale;
    ctx.fillRect(vx, vy, view.w * scale, view.h * scale);
    ctx.strokeRect(vx, vy, view.w * scale, view.h * scale);
  }

  /** 小地圖上的點（canvas 的 CSS px，例如 offsetX/offsetY）轉成世界座標；尚未畫過小地圖時回傳 null */
  minimapToWorld(canvas: HTMLCanvasElement, x: number, y: number): Point | null {
    const cache = this.minimapCache;
    if (!cache) return null;
    const dpr = canvas.width / (canvas.clientWidth || canvas.width);
    const ox = (cache.w - cache.bounds.w * cache.scale) / 2;
    const oy = (cache.h - cache.bounds.h * cache.scale) / 2;
    return { x: cache.bounds.x + (x * dpr - ox) / cache.scale, y: cache.bounds.y + (y * dpr - oy) / cache.scale };
  }

  // =================================================================== rendering glue

  private baseRenderContext(): Omit<RenderContext, 'zoom'> {
    return {
      get: this.model.store.getter,
      routes: this.model.routes,
      text: this.textCache,
      images: this.images,
      labels: this.labels,
      editing: this.editing,
      canOpenLinks: !!this.opts.onOpenLink,
      invalidate: (id) => this.invalidateObject(id),
    };
  }

  private invalidateObject(id: string) {
    const b = this.model.store.boundsOf(id);
    if (b) this.renderer.invalidateWorld([b]);
    this.renderer.invalidateOverlay();
  }

  private onFontsLoaded() {
    this.measurer.clear();
    this.textCache.clear();
    this.renderer.invalidateAll();
    this.markState();
  }

  private onImageLoaded(assetId: string) {
    for (const o of this.model.store.objects.values()) if (o.type === 'image' && o.assetId === assetId) this.invalidateObject(o.id);
  }

  /** 拖曳預覽：把物件從靜態層拿出來，改畫在互動層 */
  private lift(ids: Iterable<string>) {
    const s = this.model.store;
    const all = new Set<string>();
    for (const id of ids) {
      all.add(id);
      for (const d of s.descendants(id)) all.add(d);
    }
    for (const id of Array.from(all)) for (const c of s.connectorsAttachedTo(id)) all.add(c);
    const dirty: Rect[] = [];
    for (const id of all) {
      this.renderer.hidden.add(id);
      const b = s.boundsOf(id);
      if (b) dirty.push(b);
    }
    this.renderer.invalidateWorld(dirty);
    this.renderer.invalidateLive();
  }

  /**
   * 縮放、旋轉時，畫在 units 上方、且與 units 目前或原本範圍重疊的物件也抬到即時圖層。
   * 即時圖層畫在畫布快取上方，否則形狀內的物件（或其他疊在上面的物件）會被縮放中的形狀蓋住，放開後才出現
   */
  private liftCovering(units: string[]) {
    const s = this.model.store;
    const hidden = this.renderer.hidden;
    let lowest = Infinity;
    const rects: Rect[] = [];
    for (const u of units) {
      for (const id of [u, ...s.descendants(u)]) {
        lowest = Math.min(lowest, s.orderOf(id));
        const b = s.boundsOf(id);
        if (b) rects.push(b);
        const o = this.overrides.get(id);
        if (o && o.type !== 'connector') rects.push(rotatedAabb(o));
      }
    }
    const area = unionRects(rects);
    if (!area) return;
    const extra: string[] = [];
    for (const it of s.query(area)) {
      if (!hidden.has(it.id) && s.orderOf(it.id) > lowest) extra.push(it.id);
    }
    if (extra.length) this.lift(extra);
  }

  private unlift() {
    if (!this.renderer.hidden.size && !this.overrides.size) return;
    const s = this.model.store;
    const dirty: Rect[] = [];
    for (const id of this.renderer.hidden) {
      const b = s.boundsOf(id);
      if (b) dirty.push(b);
    }
    this.renderer.hidden.clear();
    this.overrides.clear();
    this.liveRoutes.clear();
    this.renderer.invalidateWorld(dirty);
    this.renderer.invalidateLive();
  }

  private setOverrides(plan: Map<string, GeomPatch>) {
    this.overrides.clear();
    this.liveRoutes.clear();
    for (const [id, p] of plan) {
      const o = this.model.store.get(id);
      if (o) this.overrides.set(id, { ...o, ...p } as BoardObject);
    }
    this.renderer.invalidateLive();
    this.renderer.invalidateOverlay();
  }

  private readonly overrideGet = (id: string) => this.overrides.get(id) ?? this.model.store.get(id);

  private liveRoute = (c: ConnectorObject): Route => {
    let r = this.liveRoutes.get(c.id);
    if (!r) {
      r = computeRoute(c, {
        get: this.overrideGet,
        obstaclesIn: (rect) => {
          const out: BoardObject[] = [];
          for (const it of this.model.store.query(rect)) {
            if (it.connector) continue;
            const o = this.overrideGet(it.id);
            if (o) out.push(o);
          }
          return out;
        },
      });
      this.liveRoutes.set(c.id, r);
    }
    return r;
  };

  private paintLive(ctx: CanvasRenderingContext2D, rc: RenderContext) {
    const tl = this.placingTopLeft();
    if (this.placing && tl) {
      const snaps = this.model.placementSnapshots(this.placing, tl);
      const byId = new Map(snaps.map((o) => [o.id, o]));
      const get = (id: string) => byId.get(id);
      const routes = new Map<string, Route>();
      const routeOf = (c: ConnectorObject) => {
        let r = routes.get(c.id);
        if (!r) routes.set(c.id, (r = computeRoute(c, { get, obstaclesIn: () => [] })));
        return r;
      };
      drawObjects(ctx, snaps, { ...rc, get, routeOf, editing: null });
    }
    const created = this.createPreview();
    if (created) drawObjects(ctx, [created], { ...rc, get: this.overrideGet, routeOf: this.liveRoute, editing: null });
    if (!this.renderer.hidden.size) return;
    const s = this.model.store;
    const ids = s.sortByOrder(Array.from(this.renderer.hidden));
    const objs = ids.map((id) => this.overrides.get(id) ?? s.get(id)).filter(Boolean) as BoardObject[];
    drawObjects(ctx, objs, { ...rc, get: this.overrideGet, routeOf: this.liveRoute });
  }

  // =================================================================== overlay

  private selectionFrame(): { box: Rect; rotation: number; single: BoardObject | null } | null {
    const m = this.model;
    const sel = m.selection;
    if (!sel.length) return null;
    if (sel.length === 1) {
      const o = this.overrideGet(sel[0]);
      if (!o) return null;
      if (o.type === 'connector') return null;
      if (o.type !== 'group') return { box: { x: o.x, y: o.y, w: o.w, h: o.h }, rotation: o.rotation, single: o };
    }
    const g = this.gesture;
    if (g.kind === 'resize' && !g.single) return { box: g.to, rotation: 0, single: null };
    const rects = sel.map((id) => {
      const o = this.overrideGet(id);
      if (!o) return null;
      if (o.type === 'connector') return this.overrides.size ? this.liveRoute(o).bounds : m.unitBounds(id);
      if (o.type === 'group' && this.overrides.size) {
        const kids = m.store.descendants(id).map((d) => this.overrideGet(d)).filter((k) => k && k.type !== 'group') as BoardObject[];
        return unionRects(kids.map((k) => rotatedAabb(k)));
      }
      return rotatedAabb(o);
    });
    const b = unionRects(rects.filter(Boolean) as Rect[]);
    return b ? { box: b, rotation: 0, single: null } : null;
  }

  private handles(): Handle[] {
    if (this.readOnly || this.editing) return [];
    const m = this.model;
    const sel = m.selection;
    if (!sel.length || sel.some((id) => m.isLocked(id))) return [];
    if (sel.length === 1) {
      const o = this.overrideGet(sel[0]);
      if (o?.type === 'connector') {
        const [a, b] = resolveEnds(o, this.overrideGet);
        const out: Handle[] = [
          { kind: 'from', p: this.worldToScreen(a.p) },
          { kind: 'to', p: this.worldToScreen(b.p) },
        ];
        // 折線的中間線段（不含接在端點上的頭尾兩段）可以拖曳平移
        if (o.routing === 'orthogonal') {
          const pts = (this.overrides.size ? this.liveRoute(o) : m.routes.get(o)).points;
          for (let i = 1; i < pts.length - 2; i++) {
            const horizontal = Math.abs(pts[i].y - pts[i + 1].y) < 0.01;
            out.push({ kind: 'segment', index: i, horizontal, p: this.worldToScreen({ x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }) });
          }
        }
        return out;
      }
    }
    if (sel.every((id) => m.store.get(id)?.type === 'connector')) return [];
    const f = this.selectionFrame();
    if (!f) return [];
    const { box, rotation } = f;
    const c = rectCenter(box);
    const pt = (u: number, v: number) => this.worldToScreen(rotatePoint({ x: box.x + u * box.w, y: box.y + v * box.h }, c, rotation));
    const out: Handle[] = [];
    const textOnly = f.single?.type === 'text';
    const z = this.renderer.camera.zoom;
    const small = box.w * z < 24 || box.h * z < 24;
    const list: [HandleKind, number, number][] = textOnly
      ? [
          ['w', 0, 0.5],
          ['e', 1, 0.5],
        ]
      : [
          ['nw', 0, 0],
          ['ne', 1, 0],
          ['se', 1, 1],
          ['sw', 0, 1],
          ...(small
            ? []
            : ([
                ['n', 0.5, 0],
                ['e', 1, 0.5],
                ['s', 0.5, 1],
                ['w', 0, 0.5],
              ] as [HandleKind, number, number][])),
        ];
    for (const [k, u, v] of list) out.push({ kind: k, p: pt(u, v) });
    if (m.canRotate()) {
      const top = pt(0.5, 0);
      const dir = rotatePoint({ x: 0, y: -1 }, { x: 0, y: 0 }, rotation);
      out.push({ kind: 'rotate', p: { x: top.x + dir.x * ROTATE_OFFSET, y: top.y + dir.y * ROTATE_OFFSET } });
    }
    return out;
  }

  private showDots(): boolean {
    const g = this.gesture.kind;
    return !this.readOnly && !this.editing && (g === 'none' || g === 'connect') && (this.tool.kind === 'select' || this.tool.kind === 'connector') && !this.spaceDown;
  }

  private paintOverlay(ctx: CanvasRenderingContext2D) {
    const m = this.model;
    const z = this.renderer.camera.zoom;
    ctx.lineJoin = 'round';
    const outline = (o: BoardObject, color: string, width: number, dash: number[] = []) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      if (o.type === 'connector') {
        const r = this.overrides.size ? this.liveRoute(o) : m.routes.get(o);
        const pts = r.points.map((p) => this.worldToScreen(p));
        traceRoute(ctx, { ...r, points: pts });
      } else {
        const corners = objectCorners(o).map((p) => this.worldToScreen(p));
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    // 進入中的群組
    if (m.enteredGroupId) {
      const g = m.store.get(m.enteredGroupId);
      if (g) outline(g, 'rgba(0,135,220,0.6)', 1, [4, 4]);
    }
    // 滑鼠移過
    const g = this.gesture;
    if (this.hoverId && g.kind === 'none' && !m.selection.includes(this.hoverId)) {
      const o = this.overrideGet(this.hoverId);
      if (o && o.type !== 'section') outline(o, SELECTION_COLOR, 1.5);
      else if (o) outline(o, 'rgba(0,135,220,0.7)', 1.5);
    }
    // 選取
    const sel = m.selection;
    for (const id of sel) {
      const o = this.overrideGet(id);
      if (!o) continue;
      if (o.type === 'group' && sel.length === 1) continue;
      outline(o, SELECTION_COLOR, sel.length === 1 || o.type === 'connector' ? 1.5 : 1);
    }
    const f = this.selectionFrame();
    if (f && (sel.length > 1 || m.store.get(sel[0])?.type === 'group')) {
      const corners = objectCorners({ ...f.box, rotation: f.rotation }).map((p) => this.worldToScreen(p));
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();
    }
    if (this.editing) {
      const o = m.store.get(this.editing.id);
      if (o) outline(o, SELECTION_COLOR, 2);
    }
    // 把手
    if (g.kind !== 'move' && g.kind !== 'marquee') {
      for (const h of this.handles()) {
        if (h.kind === 'rotate') {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = SELECTION_COLOR;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(h.p.x, h.p.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (h.kind === 'segment') {
          // 沿線段方向的膠囊
          const [w, hh] = h.horizontal ? [14, 6] : [6, 14];
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = SELECTION_COLOR;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(Math.round(h.p.x - w / 2) + 0.5, Math.round(h.p.y - hh / 2) + 0.5, w, hh, 3);
          ctx.fill();
          ctx.stroke();
        } else if (h.kind === 'from' || h.kind === 'to') {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = SELECTION_COLOR;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(h.p.x, h.p.y, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          const s = HANDLE_SIZE;
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = SELECTION_COLOR;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.rect(Math.round(h.p.x - s / 2) + 0.5, Math.round(h.p.y - s / 2) + 0.5, s, s);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    // 連接點：指標附近外框上的單一圓點；拖曳連線時改為標示目標上的連接點
    const dot = g.kind === 'connect' || g.kind === 'endpoint' ? this.anchorWorld(g.target) : this.showDots() ? (this.hoverDot?.p ?? null) : null;
    if (dot) {
      const sp = this.worldToScreen(dot);
      ctx.setLineDash([]);
      ctx.fillStyle = SELECTION_COLOR;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // 建立連線、拖曳端點、快速選單的預覽
    const preview = (from: ConnectorEnd, to: ConnectorEnd) => {
      const fake = { id: '__preview__', type: 'connector', x: 0, y: 0, w: 1, h: 1, rotation: 0, z: 'zz', parentId: null, locked: false, style: { strokeWidth: NEW_STROKE_WIDTH }, from, to, waypoints: [], label: '', routing: 'orthogonal', startArrow: 'none', endArrow: 'triangle', dashed: false } as ConnectorObject;
      const r = computeRoute(fake, { get: this.model.store.getter, obstaclesIn: () => [] });
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      traceRoute(ctx, { ...r, points: r.points.map((p) => this.worldToScreen(p)) });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (g.kind === 'connect') preview(g.from, g.target ?? { objectId: null, anchor: null, x: g.curWorld.x, y: g.curWorld.y });
    if (this.quickConnect && this.quickConnectAnchor) {
      preview({ objectId: this.quickConnect.fromId, anchor: this.quickConnectAnchor }, { objectId: null, anchor: null, ...this.quickConnect.world });
    }
    // 框選、建立中的矩形（形狀工具改在即時圖層畫出形狀本身）
    if (g.kind === 'marquee' || (g.kind === 'create' && g.tool.kind !== 'shape')) {
      const r = this.worldRectToScreen(normalizeRect(g.startWorld, g.curWorld));
      ctx.fillStyle = g.kind === 'marquee' ? 'rgba(0,135,220,0.08)' : 'rgba(0,135,220,0.05)';
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 1;
      if (g.kind === 'create') ctx.setLineDash([5, 4]);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
      ctx.setLineDash([]);
    }
    this.paintSizeLabel(ctx);
    // 對齊參考線（放置複本時用預覽的吸附結果）
    const guides = this.placing ? (this.placingSnap()?.guides ?? []) : this.guides;
    if (guides.length) {
      ctx.strokeStyle = GUIDE_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const gd of guides) {
        // 等距提示兩端加短橫槓，與對齊線區分
        const cap = gd.gap ? GAP_CAP : 0;
        if (gd.axis === 'x') {
          const a = this.worldToScreen({ x: gd.pos, y: gd.from });
          const b = this.worldToScreen({ x: gd.pos, y: gd.to });
          const x = Math.round(a.x) + 0.5;
          ctx.moveTo(x, a.y);
          ctx.lineTo(x, b.y);
          if (cap) {
            for (const y of [a.y, b.y]) {
              ctx.moveTo(x - cap, Math.round(y) + 0.5);
              ctx.lineTo(x + cap, Math.round(y) + 0.5);
            }
          }
        } else {
          const a = this.worldToScreen({ x: gd.from, y: gd.pos });
          const b = this.worldToScreen({ x: gd.to, y: gd.pos });
          const y = Math.round(a.y) + 0.5;
          ctx.moveTo(a.x, y);
          ctx.lineTo(b.x, y);
          if (cap) {
            for (const x of [a.x, b.x]) {
              ctx.moveTo(Math.round(x) + 0.5, y - cap);
              ctx.lineTo(Math.round(x) + 0.5, y + cap);
            }
          }
        }
      }
      ctx.stroke();
    }
    void z;
    const ptl = this.placingTopLeft();
    if (this.placing && ptl) {
      const r = this.worldRectToScreen({ x: ptl.x, y: ptl.y, w: this.placing.bounds.w, h: this.placing.bounds.h });
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, r.w, r.h);
      ctx.setLineDash([]);
    }
    this.paintScrollbars(ctx);
  }

  private scrollGeometry() {
    const view = this.renderer.viewportWorld();
    const content = this.model.store.contentBounds();
    if (!content) return null;
    const ext = unionRects([inflate(content, 200), view])!;
    const W = this.renderer.cssW;
    const H = this.renderer.cssH;
    const track = { x: 4, y: H - 10, w: W - 18, h: 6 };
    const vtrack = { x: W - 10, y: 4, w: 6, h: H - 18 };
    const out: { axis: 'x' | 'y'; thumb: Rect; scale: number }[] = [];
    if (ext.w > view.w + 1) {
      const w = Math.max(24, (view.w / ext.w) * track.w);
      const x = track.x + ((view.x - ext.x) / (ext.w - view.w)) * (track.w - w);
      out.push({ axis: 'x', thumb: { x, y: track.y, w, h: track.h }, scale: (ext.w - view.w) / (track.w - w) });
    }
    if (ext.h > view.h + 1) {
      const h = Math.max(24, (view.h / ext.h) * vtrack.h);
      const y = vtrack.y + ((view.y - ext.y) / (ext.h - view.h)) * (vtrack.h - h);
      out.push({ axis: 'y', thumb: { x: vtrack.x, y, w: vtrack.w, h }, scale: (ext.h - view.h) / (vtrack.h - h) });
    }
    return out;
  }

  private paintScrollbars(ctx: CanvasRenderingContext2D) {
    const bars = this.scrollGeometry();
    if (!bars) return;
    const active = this.gesture.kind === 'scroll' ? this.gesture.axis : null;
    for (const b of bars) {
      ctx.fillStyle = active === b.axis ? 'rgba(31,41,51,0.45)' : 'rgba(31,41,51,0.22)';
      ctx.beginPath();
      const r = b.thumb;
      const rad = 3;
      ctx.moveTo(r.x + rad, r.y);
      ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
      ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
      ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
      ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
      ctx.fill();
    }
  }

  // =================================================================== hit testing

  private hitAt(screen: Point): { id: string; body: boolean } | null {
    const world = this.screenToWorld(screen);
    const z = this.renderer.camera.zoom;
    const tol = 6 / z;
    const s = this.model.store;
    const items = s.query({ x: world.x - tol, y: world.y - tol, w: tol * 2, h: tol * 2 });
    const ids = s.sortByOrder(items.map((i) => i.id)).reverse();
    const rc = { ...this.baseRenderContext(), zoom: z };
    let body: string | null = null;
    for (const id of ids) {
      const o = s.get(id);
      if (!o || o.type === 'group') continue;
      const r = hitObject(o, world, rc, o.type === 'connector' ? tol : 0);
      if (r === 'body') {
        if (!body) body = id;
        continue;
      }
      if (r) return { id, body: false };
    }
    return body ? { id: body, body: true } : null;
  }

  /** 指標下的折線中間線段（與控制點相同的範圍：不含頭尾兩段）；群組內或鎖定的連線不處理 */
  private segmentAt(id: string, screen: Point): Extract<Handle, { kind: 'segment' }> | null {
    const m = this.model;
    const o = m.store.get(id);
    if (o?.type !== 'connector' || o.routing !== 'orthogonal' || m.isLocked(id) || m.selectionTarget(id) !== id) return null;
    const pts = m.routes.get(o).points.map((p) => this.worldToScreen(p));
    for (let i = 1; i < pts.length - 2; i++) {
      if (distToSegment(screen, pts[i], pts[i + 1]) > SEGMENT_HIT) continue;
      const horizontal = Math.abs(pts[i].y - pts[i + 1].y) < 0.01;
      return { kind: 'segment', index: i, horizontal, p: { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 } };
    }
    return null;
  }

  private handleAt(screen: Point): Handle | null {
    for (const h of this.handles()) if (dist(h.p, screen) <= HANDLE_HIT + (h.kind === 'rotate' ? 2 : 0)) return h;
    return null;
  }

  /**
   * 指標附近的物件外框上離指標最近的點：拖曳端點時為外側 EDGE_OUT、內側 EDGE_IN 像素內，懸停（hover）時為內外 EDGE_HOVER 像素內。
   * 由上層往下找，指標落在某個物件內部但不靠近外框時，下層物件不算。
   * hover 為 true 時只考慮可以直接選取的物件（未進入的群組內的物件不顯示連接點）。
   */
  private edgeAt(screen: Point, exclude: string | null, hover: boolean): EdgeDot | null {
    const world = this.screenToWorld(screen);
    const z = this.renderer.camera.zoom;
    const out = hover ? EDGE_HOVER : EDGE_OUT;
    const inner = hover ? EDGE_HOVER : EDGE_IN;
    const tol = out / z;
    const s = this.model.store;
    const items = s.query({ x: world.x - tol, y: world.y - tol, w: tol * 2, h: tol * 2 });
    const ids = s.sortByOrder(items.filter((i) => !i.connector).map((i) => i.id)).reverse();
    for (const id of ids) {
      const o = s.get(id);
      if (!isConnectable(o)) continue;
      const local = toObjectLocal(o, world);
      const inside = insideOutline(o, local);
      const eligible =
        id !== exclude &&
        !(o.type === 'section' && !o.frameKind) &&
        Math.min(o.w, o.h) * z >= 16 &&
        (!hover || this.tool.kind === 'connector' || this.model.selectionTarget(id) === id);
      if (eligible) {
        const near = nearestOnOutline(o, local);
        if (near.d * z <= (inside ? inner : out)) return { id, ...this.edgeAnchor(o, near.p) };
      }
      if (inside && o.type !== 'section') return null;
    }
    return null;
  }

  /** 外框上的點（物件本地座標）轉成錨點：靠近四邊中點時吸附為該邊，否則為 { u, v } */
  private edgeAnchor(o: BoardObject, local: Point): { anchor: Anchor; p: Point } {
    const z = this.renderer.camera.zoom;
    for (const side of SIDES) {
      const q = sideOnOutline(o, side);
      if (Math.hypot(q.x - local.x, q.y - local.y) * z <= MID_SNAP) return { anchor: side, p: anchorPoint(o, side).p };
    }
    const round = (n: number) => Math.round(n * 1e4) / 1e4;
    const anchor = { u: round(local.x / o.w), v: round(local.y / o.h) };
    return { anchor, p: anchorPoint(o, anchor).p };
  }

  private dotAt(screen: Point): EdgeDot | null {
    return this.showDots() ? this.edgeAt(screen, null, true) : null;
  }

  /** 連線端點固定在物件上的連接點（自動選邊或懸空時為 null） */
  private anchorWorld(end: ConnectorEnd | null): Point | null {
    const o = end?.objectId ? this.model.store.get(end.objectId) : null;
    return o && end?.anchor ? anchorPoint(o, end.anchor).p : null;
  }

  private scrollbarAt(screen: Point) {
    const bars = this.scrollGeometry();
    if (!bars) return null;
    for (const b of bars) if (containsPoint(inflate(b.thumb, 4), screen)) return b;
    return null;
  }

  /** 連線端點的畫布座標：接在物件上時取錨點，沒有指定錨點時取物件中心 */
  private endWorld(end: ConnectorEnd): Point {
    const o = end.objectId ? this.model.store.get(end.objectId) : null;
    if (!o) return { x: end.x ?? 0, y: end.y ?? 0 };
    return end.anchor ? anchorPoint(o, end.anchor).p : rectCenter(o);
  }

  /** 按住 Shift 拖曳連線端點時，角度限制為 0、45、90… 度（相對於另一端） */
  private constrainEnd(g: { origin: Point; constrained?: boolean }, world: Point, screen: Point, shift: boolean): [Point, Point] {
    g.constrained = shift;
    if (!shift) return [world, screen];
    const p = snapAngle(g.origin, world);
    return [p, this.worldToScreen(p)];
  }

  /** 拖曳連線端點時，指標下方的連接目標：靠近外框時固定在該點，放在物件內部時自動選邊 */
  private connectTarget(screen: Point, exclude: string | null): ConnectorEnd | null {
    const edge = this.edgeAt(screen, exclude, false);
    if (edge) return { objectId: edge.id, anchor: edge.anchor };
    const hit = this.hitAt(screen);
    if (!hit) return null;
    const o = this.model.store.get(hit.id);
    if (!isConnectable(o) || o.id === exclude || (o.type === 'section' && hit.body && !o.frameKind)) return null;
    return { objectId: o.id, anchor: null };
  }

  // =================================================================== events

  private attachEvents() {
    const el = this.renderer.root;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as any, opts);
      this.cleanup.push(() => el.removeEventListener(type, fn as any, opts));
    };
    on('pointerdown', (e) => this.onPointerDown(e));
    on('pointermove', (e) => this.onPointerMove(e));
    on('pointerup', (e) => this.onPointerUp(e));
    on('pointercancel', () => this.cancelGesture());
    on('pointerleave', () => {
      this.pointerInside = false;
      if (this.placing) {
        this.renderer.invalidateLive();
        this.renderer.invalidateOverlay();
      }
      if (this.gesture.kind === 'none' && this.hoverId) {
        this.hoverId = null;
        this.renderer.invalidateOverlay();
      }
    });
    on('dblclick', (e) => this.onDoubleClick(e));
    on('wheel', (e) => this.onWheel(e), { passive: false });
    on('keydown', (e) => this.onKeyDown(e));
    on('keyup', (e) => this.onKeyUp(e));
    on('blur', () => {
      this.spaceDown = false;
      this.updateCursor();
    });
    on('contextmenu', (e) => this.onContextMenu(e));
    on('copy', (e) => this.onCopy(e, false));
    on('cut', (e) => this.onCopy(e, true));
    on('paste', (e) => this.onPaste(e));
    // 點過浮動工具列、左側工具列或選單後，焦點停在那些按鈕上，剪貼簿事件不會經過畫布；
    // 在 document 上補聽，焦點不在可輸入的地方時一樣交給畫布處理
    const doc = el.ownerDocument;
    const onDoc = (type: 'copy' | 'cut' | 'paste', fn: (e: ClipboardEvent) => void) => {
      const h = (e: ClipboardEvent) => {
        if (this.clipboardFromOutside(e)) fn(e);
      };
      doc.addEventListener(type, h);
      this.cleanup.push(() => doc.removeEventListener(type, h));
    };
    onDoc('copy', (e) => this.onCopy(e, false));
    onDoc('cut', (e) => this.onCopy(e, true));
    onDoc('paste', (e) => this.onPaste(e));
    on('dragover', (e) => {
      if (!this.readOnly && e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    on('drop', (e) => this.onDrop(e));
    // Safari 的觸控板捏合（不送 ctrlKey 的 wheel，而是 gesture 事件）
    let gestureZoom = 1;
    on('gesturestart' as any, (e: any) => {
      e.preventDefault();
      gestureZoom = this.renderer.camera.zoom;
    });
    on('gesturechange' as any, (e: any) => {
      e.preventDefault();
      this.setZoom(gestureZoom * (e.scale || 1), this.local(e));
    });
    on('gestureend' as any, (e: any) => e.preventDefault());
  }

  private local(e: { clientX: number; clientY: number }): Point {
    const r = this.renderer.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hoverSegment() {
    if (this.readOnly || this.tool.kind !== 'select' || this.gesture.kind !== 'none' || !this.hoverId || !this.lastPointer) return null;
    return this.segmentAt(this.hoverId, this.lastPointer);
  }

  private updateCursor() {
    const el = this.renderer.root;
    let c = 'default';
    const g = this.gesture.kind;
    const seg = this.hoverHandle || this.hoverDot ? null : this.hoverSegment();
    if (this.placing) c = 'copy';
    else if (g === 'pan') c = 'grabbing';
    else if (this.spaceDown || this.tool.kind === 'hand') c = 'grab';
    else if (['shape', 'section', 'frame', 'connector', 'wireframe', 'table'].includes(this.tool.kind)) c = 'crosshair';
    else if (this.tool.kind === 'text') c = 'text';
    else if (this.hoverHandle) {
      const k = this.hoverHandle.kind;
      c = k === 'segment' ? (this.hoverHandle.kind === 'segment' && this.hoverHandle.horizontal ? 'ns-resize' : 'ew-resize') : k === 'rotate' ? 'grab' : k === 'n' || k === 's' ? 'ns-resize' : k === 'e' || k === 'w' ? 'ew-resize' : k === 'nw' || k === 'se' ? 'nwse-resize' : k === 'ne' || k === 'sw' ? 'nesw-resize' : 'move';
    } else if (this.hoverDot) c = 'crosshair';
    else if (seg) c = seg.horizontal ? 'ns-resize' : 'ew-resize';
    else if (this.hoverBorder) c = this.hoverBorder === 'col' ? 'col-resize' : 'row-resize';
    else if (this.hoverLink) c = 'pointer';
    if (el.style.cursor !== c) el.style.cursor = c;
  }
  private hoverLink = false;
  private placing: Placement | null = null;
  /** 正在拖曳物件或線段（超過拖曳門檻才算）；浮動工具列在拖曳期間隱藏 */
  private dragging = false;
  private downScreen: Point | null = null;
  private pointerInside = false;
  private altDown = false;
  private suppressContextMenu = false;
  private hoverBorder: 'col' | 'row' | null = null;

  private onPointerDown(e: PointerEvent) {
    this.downScreen = this.local(e);
    this.dragging = false;
    if (this.placing) {
      // 放置模式：主要按鍵確定位置，其他按鍵取消；不開始框選或拖曳
      e.preventDefault();
      this.lastPointer = this.local(e);
      this.pointerInside = true;
      if (e.button === 0) this.commitPlacing(e.altKey);
      else {
        if (e.button === 2) this.suppressContextMenu = true;
        this.cancelPlacing();
      }
      return;
    }
    if (this.editing) this.stopEditing({ refocus: false });
    this.focus();
    const screen = this.local(e);
    const world = this.screenToWorld(screen);
    this.lastPointer = screen;
    if (this.contextMenu) {
      this.contextMenu = null;
      this.markState();
    }
    if (this.quickConnect) this.cancelQuickConnect();
    if (e.button === 2) return;
    try {
      this.renderer.root.setPointerCapture(e.pointerId);
    } catch {
      /* 測試環境 */
    }
    if (this.editing) this.stopEditing();
    if (e.button === 1 || this.spaceDown || this.tool.kind === 'hand') {
      this.gesture = { kind: 'pan', last: screen };
      this.updateCursor();
      return;
    }
    const bar = this.scrollbarAt(screen);
    if (bar) {
      this.gesture = { kind: 'scroll', axis: bar.axis, last: screen, scale: bar.scale };
      this.renderer.invalidateOverlay();
      return;
    }
    const tool = this.tool;
    if (!this.readOnly && (tool.kind === 'shape' || tool.kind === 'section' || tool.kind === 'frame' || tool.kind === 'wireframe' || tool.kind === 'table' || tool.kind === 'text')) {
      this.gesture = { kind: 'create', tool, startWorld: world, curWorld: world };
      return;
    }
    if (!this.readOnly && tool.kind === 'connector') {
      const t = this.connectTarget(screen, null);
      const from: ConnectorEnd = t ?? { objectId: null, anchor: null, x: snap(world.x, GRID_SIZE), y: snap(world.y, GRID_SIZE) };
      this.gesture = { kind: 'connect', from, fromId: t?.objectId ?? null, fromAnchor: null, startScreen: screen, curWorld: world, target: null, origin: this.endWorld(from) };
      return;
    }
    // 選取工具
    const handle = this.handleAt(screen);
    if (handle && !this.readOnly) {
      this.beginHandleDrag(handle, world);
      return;
    }
    const border = this.tableBorderAt(screen);
    if (border) {
      this.model.stopCapturing();
      this.lift([border.id]);
      this.gesture = { kind: 'tableResize', id: border.id, axis: border.axis, refId: border.refId, start: world, orig: border.size };
      return;
    }
    const dot = this.dotAt(screen);
    if (dot && !this.readOnly) {
      const from: ConnectorEnd = { objectId: dot.id, anchor: dot.anchor };
      this.gesture = { kind: 'connect', from, fromId: dot.id, fromAnchor: dot.anchor, startScreen: screen, curWorld: world, target: null, origin: this.endWorld(from) };
      return;
    }
    const hit = this.hitAt(screen);
    const m = this.model;
    if (hit && m.enteredGroupId && !m.isInsideEnteredGroup(hit.id)) {
      m.enteredGroupId = null;
      this.markState();
    }
    if (!hit && m.enteredGroupId) {
      const eg = m.enteredGroupId;
      m.enteredGroupId = null;
      m.setSelection([eg]);
      this.markState();
    }
    // 連結卡的開啟圖示
    if (hit && !hit.body && this.opts.onOpenLink) {
      const o = m.store.get(hit.id);
      if (o?.type === 'link_card' && containsPoint(linkOpenBox(o), toLocal(o, world))) {
        this.opts.onOpenLink(o.targetFileId);
        return;
      }
    }
    // 在折線的中間線段上按住：不論是否已選取，都直接拖曳該線段（兩端接在物件上的連線無法整條移動）
    const seg = !e.shiftKey && !this.readOnly && hit && !hit.body ? this.segmentAt(hit.id, screen) : null;
    if (seg) {
      m.setSelection([hit!.id]);
      this.beginHandleDrag(seg, world);
      return;
    }
    const target = hit ? m.selectionTarget(hit.id) : null;
    const wasSelected = !!target && m.selection.includes(target);
    if (target && !hit!.body) {
      if (e.shiftKey) {
        m.setSelection(wasSelected ? m.selection.filter((id) => id !== target) : [...m.selection, target]);
      } else if (!wasSelected) m.setSelection([target]);
    }
    this.gesture = {
      kind: 'pending',
      startScreen: screen,
      startWorld: world,
      hitId: hit?.id ?? null,
      target,
      sectionBody: !!hit?.body,
      shift: e.shiftKey,
      wasSelected,
      toggle: this.toggleAt(hit?.id ?? null, wasSelected, e.shiftKey, world),
    };
  }

  private beginHandleDrag(h: Handle, world: Point) {
    const m = this.model;
    const units = m.selection.slice();
    m.stopCapturing();
    if (h.kind === 'from' || h.kind === 'to') {
      const id = units[0];
      this.lift([id]);
      // Shift 限制角度時以另一端在畫面上的位置為基準
      const pts = m.routes.get(m.store.get(id) as ConnectorObject).points;
      const origin = h.kind === 'to' ? pts[0] : pts[pts.length - 1];
      this.gesture = { kind: 'endpoint', connId: id, end: h.kind, curWorld: world, target: null, origin: { ...origin } };
      return;
    }
    if (h.kind === 'segment') {
      const c = m.store.get(units[0]);
      if (c?.type !== 'connector') return;
      this.lift([c.id]);
      this.gesture = { kind: 'segment', connId: c.id, index: h.index, horizontal: h.horizontal, points: m.routes.get(c).points.slice(), route: null };
      return;
    }
    const f = this.selectionFrame();
    if (!f) return;
    if (h.kind === 'rotate') {
      const c = rectCenter(f.box);
      const a = (Math.atan2(world.y - c.y, world.x - c.x) * 180) / Math.PI;
      this.lift(units);
      this.gesture = { kind: 'rotate', units, center: c, startAngle: a, startRotation: f.rotation, delta: 0 };
      return;
    }
    this.lift(units);
    this.gesture = {
      kind: 'resize',
      handle: h.kind,
      units,
      startWorld: world,
      bounds: f.box,
      single: f.single,
      proportional: m.mustScaleProportionally(units),
      plan: new Map(),
      to: f.box,
      snapRefs: null,
    };
  }

  private onPointerMove(e: PointerEvent) {
    const screen = this.local(e);
    const world = this.screenToWorld(screen);
    this.lastPointer = screen;
    this.pointerInside = true;
    if (this.placing) {
      this.altDown = e.altKey;
      this.renderer.invalidateLive();
      this.renderer.invalidateOverlay();
      return;
    }
    const g = this.gesture;
    if (!this.dragging && DRAG_GESTURES.has(g.kind) && this.downScreen && dist(screen, this.downScreen) >= DRAG_THRESHOLD) {
      this.dragging = true;
      this.markState();
    }
    switch (g.kind) {
      case 'none':
        this.updateHover(screen);
        return;
      case 'pan':
        this.panBy(screen.x - g.last.x, screen.y - g.last.y);
        g.last = screen;
        return;
      case 'scroll': {
        const d = g.axis === 'x' ? screen.x - g.last.x : screen.y - g.last.y;
        const z = this.renderer.camera.zoom;
        if (g.axis === 'x') this.panBy(-d * g.scale * z, 0);
        else this.panBy(0, -d * g.scale * z);
        g.last = screen;
        return;
      }
      case 'pending': {
        if (dist(screen, g.startScreen) < DRAG_THRESHOLD) return;
        const m = this.model;
        const movable = g.target && !g.sectionBody && !this.readOnly && m.selection.length > 0 && m.selection.includes(g.target);
        if (movable && m.selection.some((id) => !m.isLocked(id))) {
          const picked = m.selection.filter((id) => !m.isLocked(id));
          // 形狀內的物件跟著形狀一起移動；對齊參考與吸附只以選取的物件計算
          const units = [...picked, ...m.carriedUnits(picked)];
          m.stopCapturing();
          this.lift(units);
          const bounds = unionRects(picked.map((id) => m.unitBounds(id)!).filter(Boolean))!;
          this.gesture = { kind: 'move', units, startWorld: g.startWorld, bounds, dx: 0, dy: 0, snapRefs: null };
          this.onPointerMove(e);
          return;
        }
        if (!g.target || g.sectionBody) {
          if (!g.shift) m.setSelection([]);
          this.gesture = { kind: 'marquee', startWorld: g.startWorld, curWorld: world, base: g.shift ? m.selection.slice() : [] };
          this.onPointerMove(e);
          return;
        }
        this.gesture = { kind: 'none' };
        return;
      }
      case 'marquee': {
        g.curWorld = world;
        const r = normalizeRect(g.startWorld, world);
        const m = this.model;
        const s = m.store;
        const hits = new Set<string>(g.base);
        for (const it of s.query(r)) {
          const o = s.get(it.id);
          if (!o || o.type === 'group') continue;
          const b = o.type === 'connector' ? m.unitBounds(o.id)! : rotatedAabb(o);
          // 完全包含才選取
          if (b.x < r.x || b.y < r.y || b.x + b.w > r.x + r.w || b.y + b.h > r.y + r.h) continue;
          const t = m.selectionTarget(o.id);
          if (m.enteredGroupId && !m.isInsideEnteredGroup(o.id)) continue;
          const tb = m.unitBounds(t);
          if (tb && (tb.x < r.x || tb.y < r.y || tb.x + tb.w > r.x + r.w || tb.y + tb.h > r.y + r.h)) continue;
          hits.add(t);
        }
        m.setSelection(Array.from(hits));
        this.renderer.invalidateOverlay();
        return;
      }
      case 'move': {
        let dx = world.x - g.startWorld.x;
        let dy = world.y - g.startWorld.y;
        g.snapRefs ??= this.snapReferences();
        const snapped = this.snapMove(g.bounds, dx, dy, e.altKey, g.snapRefs);
        dx = snapped.dx;
        dy = snapped.dy;
        g.dx = dx;
        g.dy = dy;
        this.guides = snapped.guides;
        this.setOverrides(this.model.planMove(g.units, dx, dy));
        return;
      }
      case 'resize':
        this.updateResize(g, world, e.shiftKey, e.altKey);
        return;
      case 'rotate': {
        const a = (Math.atan2(world.y - g.center.y, world.x - g.center.x) * 180) / Math.PI;
        let delta = a - g.startAngle;
        if (e.shiftKey) delta = Math.round((g.startRotation + delta) / 15) * 15 - g.startRotation;
        else {
          // 接近 0/90/180/270 度時吸附
          const abs = g.startRotation + delta;
          const near = Math.round(abs / 90) * 90;
          if (Math.abs(abs - near) < 3) delta = near - g.startRotation;
        }
        g.delta = delta;
        this.setOverrides(this.model.planRotate(g.units, delta, g.units.length === 1 && this.model.store.get(g.units[0])?.type !== 'group' ? undefined : g.center));
        this.liftCovering(g.units);
        return;
      }
      case 'create':
        g.curWorld = world;
        if (g.tool.kind === 'shape') this.renderer.invalidateLive();
        this.renderer.invalidateOverlay();
        return;
      case 'tableResize': {
        const o = this.model.store.get(g.id);
        if (!o || o.type !== 'table') return;
        const d = g.axis === 'col' ? world.x - g.start.x : world.y - g.start.y;
        const size = Math.max(g.axis === 'col' ? 40 : 28, e.altKey ? g.orig + d : snap(g.orig + d, GRID_SIZE / 2));
        const patch: GeomPatch =
          g.axis === 'col'
            ? { columns: o.columns.map((c) => (c.id === g.refId ? { ...c, width: size } : c)) }
            : { rows: o.rows.map((r) => (r.id === g.refId ? { ...r, height: size } : r)) };
        if (patch.columns) patch.w = patch.columns.reduce((a, c) => a + c.width, 0);
        if (patch.rows) patch.h = patch.rows.reduce((a, r) => a + r.height, 0);
        this.setOverrides(new Map([[g.id, patch]]));
        return;
      }
      case 'connect': {
        const [w, sc] = this.constrainEnd(g, world, screen, e.shiftKey);
        g.curWorld = w;
        g.target = this.connectTarget(sc, g.fromId);
        this.hoverId = g.target?.objectId ?? null;
        this.renderer.invalidateOverlay();
        return;
      }
      case 'segment': {
        // 垂直於線段方向平移，吸附半格（Alt 不吸附）
        const v = g.horizontal ? world.y : world.x;
        const pos = e.altKey ? v : (alignSegment(g.points, g.index, g.horizontal, v, SEGMENT_ALIGN / this.renderer.camera.zoom) ?? snap(v, GRID_SIZE / 2));
        const pts = g.points.map((p) => ({ ...p }));
        for (const i of [g.index, g.index + 1]) pts[i] = g.horizontal ? { x: pts[i].x, y: pos } : { x: pos, y: pts[i].y };
        g.route = pts;
        this.setOverrides(new Map([[g.connId, { waypoints: pts.slice(1, -1) }]]));
        return;
      }
      case 'endpoint': {
        const [w, sc] = this.constrainEnd(g, world, screen, e.shiftKey);
        g.curWorld = w;
        const c = this.model.store.get(g.connId) as ConnectorObject;
        const other = g.end === 'from' ? c.to.objectId : c.from.objectId;
        g.target = this.connectTarget(sc, other);
        const end: ConnectorEnd = g.target ?? { objectId: null, anchor: null, x: w.x, y: w.y };
        this.setOverrides(new Map([[g.connId, { [g.end]: end } as GeomPatch]]));
        this.hoverId = g.target?.objectId ?? null;
        return;
      }
    }
  }

  private updateHover(screen: Point) {
    const prevId = this.hoverId;
    const prevHandle = this.hoverHandle;
    const prevDot = this.hoverDot;
    this.hoverHandle = this.tool.kind === 'select' ? this.handleAt(screen) : null;
    this.hoverBorder = !this.hoverHandle && this.tool.kind === 'select' ? (this.tableBorderAt(screen)?.axis ?? null) : null;
    this.hoverDot = this.hoverHandle ? null : this.dotAt(screen);
    if (this.hoverDot) {
      // 連接點可能在形狀外側一點點：懸停物件以連接點所在的物件為準
      this.hoverId = this.hoverDot.id;
      this.hoverLink = false;
    } else {
      const hit = this.hitAt(screen);
      this.hoverId = hit ? (hit.body ? hit.id : this.tool.kind === 'connector' ? hit.id : this.model.selectionTarget(hit.id)) : null;
      const o = hit && !hit.body ? this.model.store.get(hit.id) : undefined;
      this.hoverLink = !!o && o.type === 'link_card' && !!this.opts.onOpenLink && containsPoint(linkOpenBox(o), toLocal(o, this.screenToWorld(screen)));
    }
    if (prevId !== this.hoverId || prevHandle?.kind !== this.hoverHandle?.kind || prevDot?.p.x !== this.hoverDot?.p.x || prevDot?.p.y !== this.hoverDot?.p.y) {
      this.renderer.invalidateOverlay();
    }
    this.updateCursor();
  }

  /** 移動時的吸附：智慧參考線（附近物件的邊與中心）、等距提示，否則吸附格線 */
  /** 拖曳開始時收集畫面內可對齊的物件框（選取目標層級，不含被拖曳的物件） */
  private snapReferences(): Rect[] {
    const view = this.renderer.viewportWorld();
    const m = this.model;
    const s = m.store;
    const skip = this.renderer.hidden;
    const others: Rect[] = [];
    for (const it of s.query(view)) {
      if (it.connector || skip.has(it.id)) continue;
      const o = s.get(it.id);
      if (!o) continue;
      if (m.selectionTarget(o.id) !== o.id) continue;
      others.push(rotatedAabb(o));
      if (others.length > 400) break;
    }
    return others;
  }

  private snapMove(b: Rect, dx: number, dy: number, alt: boolean, others: Rect[]): { dx: number; dy: number; guides: Guide[] } {
    if (alt) return { dx, dy, guides: [] };
    const z = this.renderer.camera.zoom;
    const th = SNAP_PX / z;
    const moved = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
    const guides: Guide[] = [];
    let bestX: { d: number; pos: number; ref: Rect } | null = null;
    let bestY: { d: number; pos: number; ref: Rect } | null = null;
    const xs = [moved.x, moved.x + moved.w / 2, moved.x + moved.w];
    const ys = [moved.y, moved.y + moved.h / 2, moved.y + moved.h];
    for (const r of others) {
      for (const cx of [r.x, r.x + r.w / 2, r.x + r.w]) {
        for (const mx of xs) {
          const d = cx - mx;
          if (Math.abs(d) <= th && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, pos: cx, ref: r };
        }
      }
      for (const cy of [r.y, r.y + r.h / 2, r.y + r.h]) {
        for (const my of ys) {
          const d = cy - my;
          if (Math.abs(d) <= th && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, pos: cy, ref: r };
        }
      }
    }
    // 等距（連續等距、位在兩個鄰居正中間）；與邊緣 / 中心對齊都可以吸附時，取較近的一個（相同時對齊優先）
    const pick = (align: number | undefined, space: number | null) => {
      if (align !== undefined && (space === null || Math.abs(align) <= Math.abs(space))) return align;
      return space;
    };
    const ddx = pick(bestX?.d, equalSpacingSnap(moved, others, 'x', th));
    const ddy = pick(bestY?.d, equalSpacingSnap(moved, others, 'y', th));
    const outDx = ddx !== null ? dx + ddx : snap(b.x + dx, GRID_SIZE) - b.x;
    const outDy = ddy !== null ? dy + ddy : snap(b.y + dy, GRID_SIZE) - b.y;
    const fin = { x: b.x + outDx, y: b.y + outDy, w: b.w, h: b.h };
    // 吸附後，左 / 中 / 右（上 / 中 / 下）每一條與其他物件重合的線都畫參考線，不只吸附的那一條；
    // 間距相等的地方另外畫等距提示
    guides.push(...alignGuides(fin, { xs: [fin.x, fin.x + fin.w / 2, fin.x + fin.w], ys: [fin.y, fin.y + fin.h / 2, fin.y + fin.h] }, others));
    guides.push(...spacingGuides(fin, others));
    // 等距提示線被中心對齊線等擋住時，往右（往下）移開
    return { dx: outDx, dy: outDy, guides: avoidAlignOverlap(guides, GAP_OFFSET / z) };
  }

  private updateResize(g: Extract<Gesture, { kind: 'resize' }>, world: Point, shift: boolean, alt: boolean) {
    const m = this.model;
    const h = g.handle;
    const single = g.single;
    const rot = single ? single.rotation : 0;
    const b = g.bounds;
    const c = rectCenter(b);
    // 在未旋轉的座標系中計算
    const p = rot ? rotatePoint(world, c, -rot) : world;
    let x0 = b.x;
    let y0 = b.y;
    let x1 = b.x + b.w;
    let y1 = b.y + b.h;
    // 移動中的邊優先吸到附近物件的邊或中心（智慧參考線），否則吸附格線；旋轉中的物件與 Alt 不吸附
    const smart = !alt && !rot;
    const refs = smart ? (g.snapRefs ??= this.snapReferences()) : [];
    const th = SNAP_PX / this.renderer.camera.zoom;
    const snapV = (v: number, axis: 'x' | 'y') => (smart ? (nearestAlignLine(v, refs, axis, th) ?? snap(v, GRID_SIZE)) : v);
    if (h.includes('w')) x0 = snapV(p.x, 'x');
    if (h.includes('e')) x1 = snapV(p.x, 'x');
    if (h.includes('n')) y0 = snapV(p.y, 'y');
    if (h.includes('s')) y1 = snapV(p.y, 'y');
    const minS = 8;
    if (x1 - x0 < minS) {
      if (h.includes('w')) x0 = x1 - minS;
      else x1 = x0 + minS;
    }
    if (y1 - y0 < minS) {
      if (h.includes('n')) y0 = y1 - minS;
      else y1 = y0 + minS;
    }
    const keep = g.proportional || shift;
    if (keep && b.w > 0 && b.h > 0) {
      const ratio = b.w / b.h;
      const corner = h.length === 2;
      let w = x1 - x0;
      let hh = y1 - y0;
      if (corner) {
        if (w / ratio > hh) hh = w / ratio;
        else w = hh * ratio;
      } else if (h === 'e' || h === 'w') hh = w / ratio;
      else w = hh * ratio;
      if (h.includes('w')) x0 = x1 - w;
      else if (h === 'n' || h === 's') {
        const cx = (b.x + b.x + b.w) / 2;
        x0 = cx - w / 2;
      }
      x1 = x0 + w;
      if (h.includes('n')) y0 = y1 - hh;
      else if (h === 'e' || h === 'w') {
        const cy = (b.y + b.y + b.h) / 2;
        y0 = cy - hh / 2;
      }
      y1 = y0 + hh;
    }
    let to: Rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (rot) {
      // 固定對邊：新框在未旋轉座標的中心，旋轉回世界座標
      const fixedLocal = { x: h.includes('w') ? b.x + b.w : h.includes('e') ? b.x : c.x, y: h.includes('n') ? b.y + b.h : h.includes('s') ? b.y : c.y };
      const fixedWorld = rotatePoint(fixedLocal, c, rot);
      const nc = rectCenter(to);
      const newFixedLocal = { x: h.includes('w') ? to.x + to.w : h.includes('e') ? to.x : nc.x, y: h.includes('n') ? to.y + to.h : h.includes('s') ? to.y : nc.y };
      const v = rotatePoint({ x: nc.x - newFixedLocal.x, y: nc.y - newFixedLocal.y }, { x: 0, y: 0 }, rot);
      const wc = { x: fixedWorld.x + v.x, y: fixedWorld.y + v.y };
      to = { x: wc.x - to.w / 2, y: wc.y - to.h / 2, w: to.w, h: to.h };
    }
    g.to = to;
    // 只為有移動的邊畫參考線（等比縮放時，跟著改變的另一軸也算）
    const moved = (a: number, b0: number) => Math.abs(a - b0) > 1e-6;
    this.guides = smart
      ? alignGuides(
          to,
          {
            xs: [to.x, to.x + to.w].filter((v, i) => moved(v, i ? b.x + b.w : b.x)),
            ys: [to.y, to.y + to.h].filter((v, i) => moved(v, i ? b.y + b.h : b.y)),
          },
          refs,
        )
      : [];
    if (single && single.type !== 'group') {
      const patch: GeomPatch = { x: to.x, y: to.y, w: to.w, h: to.h };
      if (single.type === 'text' && (h === 'e' || h === 'w')) {
        patch.fixedWidth = true;
        patch.h = single.h;
        patch.y = single.y;
      }
      g.plan = new Map([[single.id, patch]]);
    } else {
      g.plan = m.planResize(g.units, b, to);
    }
    this.setOverrides(g.plan);
    this.liftCovering(g.units);
  }

  private onPointerUp(e: PointerEvent) {
    const screen = this.local(e);
    const world = this.screenToWorld(screen);
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    this.dragging = false;
    this.guides = [];
    const m = this.model;
    switch (g.kind) {
      case 'pending':
        if (g.toggle) {
          m.stopCapturing();
          g.toggle();
          m.stopCapturing();
          break;
        }
        if (g.sectionBody && g.target && !g.shift) m.setSelection([g.target]);
        else if (g.sectionBody && g.target && g.shift) m.setSelection(m.selection.includes(g.target) ? m.selection.filter((i) => i !== g.target) : [...m.selection, g.target]);
        else if (!g.target && !g.shift) m.setSelection([]);
        else if (g.target && g.wasSelected && !g.shift && m.selection.length > 1) m.setSelection([g.target]);
        break;
      case 'move':
        if (g.dx || g.dy) {
          m.moveUnits(g.units, g.dx, g.dy);
          m.stopCapturing();
        }
        this.unlift();
        break;
      case 'resize': {
        if (g.plan.size) {
          if (g.single && g.single.type !== 'group') {
            const p = g.plan.get(g.single.id)!;
            const extra: Record<string, unknown> = {};
            if (p.fixedWidth) extra.fixedWidth = true;
            m.setRect(g.single.id, { x: p.x!, y: p.y!, w: p.w!, h: p.h! }, extra);
          } else m.resize(g.bounds, g.to, g.units);
          m.stopCapturing();
        }
        this.unlift();
        break;
      }
      case 'rotate':
        if (g.delta) {
          m.rotate(g.delta, g.units, g.units.length === 1 && m.store.get(g.units[0])?.type !== 'group' ? undefined : g.center);
          m.stopCapturing();
        }
        this.unlift();
        break;
      case 'create':
        this.finishCreate(g, world);
        break;
      case 'connect':
        if (g.constrained) this.finishConnect(g, g.curWorld, this.worldToScreen(g.curWorld));
        else this.finishConnect(g, world, screen);
        break;
      case 'segment': {
        if (g.route) {
          m.stopCapturing();
          m.setRoutePoints(g.connId, g.route);
          m.stopCapturing();
        }
        this.unlift();
        break;
      }
      case 'endpoint': {
        // Shift 限制角度時不吸附格線，否則角度會跑掉
        const p = g.constrained ? g.curWorld : { x: snap(world.x, GRID_SIZE / 2), y: snap(world.y, GRID_SIZE / 2) };
        const end: ConnectorEnd = g.target ?? { objectId: null, anchor: null, x: p.x, y: p.y };
        m.stopCapturing();
        // 重新接上端點時恢復自動路由
        m.updateObject(g.connId, { [g.end]: end, waypoints: [] });
        m.stopCapturing();
        this.unlift();
        break;
      }
      case 'tableResize': {
        const ov = this.overrides.get(g.id);
        if (ov && ov.type === 'table') {
          if (g.axis === 'col') {
            const c = ov.columns.find((x) => x.id === g.refId);
            if (c && c.width !== g.orig) m.setTableColumnWidth(g.id, g.refId, c.width);
          } else {
            const r = ov.rows.find((x) => x.id === g.refId);
            if (r && r.height !== g.orig) m.setTableRowHeight(g.id, g.refId, r.height);
          }
          m.stopCapturing();
        }
        this.unlift();
        break;
      }
      case 'scroll':
      case 'pan':
        break;
    }
    this.renderer.invalidateOverlay();
    this.updateHover(screen);
    this.markState();
  }

  private cancelGesture() {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    if (this.dragging) {
      this.dragging = false;
      this.markState();
    }
    this.guides = [];
    if (g.kind === 'move' || g.kind === 'resize' || g.kind === 'rotate' || g.kind === 'endpoint' || g.kind === 'segment' || g.kind === 'tableResize') this.unlift();
    if (g.kind === 'create') this.renderer.invalidateLive();
    this.renderer.invalidateOverlay();
  }

  /** 拖曳建立或縮放時的尺寸（世界座標的寬高）與標示位置（右下角，畫面座標）；其他時候為 null */
  private sizeLabel(): { w: number; h: number; at: Point } | null {
    const g = this.gesture;
    if (g.kind === 'create') {
      const r = this.createDragRect(g, g.curWorld);
      const input = r && this.defaultInputFor(g.tool, g.startWorld, r);
      if (!input || input.type === 'connector') return null;
      return { w: input.w, h: input.h, at: this.worldToScreen({ x: input.x + input.w, y: input.y + input.h }) };
    }
    if (g.kind === 'resize') {
      const f = this.selectionFrame();
      if (!f) return null;
      const { box, rotation } = f;
      const corner = rotatePoint({ x: box.x + box.w, y: box.y + box.h }, rectCenter(box), rotation);
      return { w: box.w, h: box.h, at: this.worldToScreen(corner) };
    }
    return null;
  }

  private paintSizeLabel(ctx: CanvasRenderingContext2D) {
    const l = this.sizeLabel();
    if (!l) return;
    const text = `${Math.round(l.w)} × ${Math.round(l.h)}`;
    ctx.font = fontString(11, 500);
    const tw = ctx.measureText(text).width;
    const w = tw + 12;
    const h = 18;
    const x = Math.round(l.at.x + 8);
    const y = Math.round(l.at.y + 8);
    ctx.fillStyle = SELECTION_COLOR;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 6, y + h / 2 + 0.5);
  }

  /** 建立工具拖曳出的範圍；拖曳太小（視為單擊）時為 null */
  private createDragRect(g: Extract<Gesture, { kind: 'create' }>, world: Point): Rect | null {
    const r = normalizeRect(g.startWorld, world);
    const z = this.renderer.camera.zoom;
    return r.w * z > 6 && r.h * z > 6 ? r : null;
  }

  /** 以形狀工具拖曳時的預覽：放開後會建立的形狀（與 finishCreate 相同的位置與尺寸），不寫入文件 */
  private createPreview(): ShapeObject | null {
    const g = this.gesture;
    if (g.kind !== 'create' || g.tool.kind !== 'shape') return null;
    const r = this.createDragRect(g, g.curWorld);
    const input = r && this.defaultInputFor(g.tool, g.startWorld, r);
    if (!input) return null;
    return {
      id: '__create__',
      type: 'shape',
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      rotation: 0,
      z: 'zz',
      parentId: null,
      locked: false,
      style: { strokeWidth: NEW_STROKE_WIDTH },
      shapeKind: g.tool.shapeKind,
      icon: null,
      iconPosition: 'top',
      autoHeight: true,
      text: [],
    };
  }

  private finishCreate(g: Extract<Gesture, { kind: 'create' }>, world: Point) {
    const m = this.model;
    const tool = g.tool;
    const input = this.defaultInputFor(tool, g.startWorld, this.createDragRect(g, world));
    this.renderer.invalidateLive();
    this.tool = { kind: 'select' };
    this.updateCursor();
    if (!input) return;
    m.stopCapturing();
    const id = m.insert(input);
    if (tool.kind === 'text') {
      this.createdForEditing = { id, stack: this.undoManager.undoStack.length };
      this.startEditing(id);
    } else m.stopCapturing();
  }

  /** 工具的預設物件：drag 為拖曳出的範圍，null 時以 center 為中心使用預設尺寸 */
  private defaultInputFor(tool: Tool, center: Point, drag: Rect | null): NewObjectInput | null {
    const at = (w: number, h: number): Rect =>
      drag
        ? { x: snap(drag.x, GRID_SIZE), y: snap(drag.y, GRID_SIZE), w: Math.max(GRID_SIZE, snap(drag.w, GRID_SIZE)), h: Math.max(GRID_SIZE, snap(drag.h, GRID_SIZE)) }
        : { x: snap(center.x - w / 2, GRID_SIZE), y: snap(center.y - h / 2, GRID_SIZE), w, h };
    switch (tool.kind) {
      case 'shape': {
        const s = defaultShapeSize(tool.shapeKind);
        return { type: 'shape', ...at(s.w, s.h), shapeKind: tool.shapeKind };
      }
      case 'section':
        return { type: 'section', ...at(640, 400), title: this.labels.sectionTitle };
      case 'frame': {
        const { w, h } = FRAME_SIZES[tool.frameKind];
        return { type: 'section', ...at(w, h), title: this.labels.frame[tool.frameKind], frameKind: tool.frameKind };
      }
      case 'wireframe': {
        const d = wireframeDefaults(tool.componentKind, this.labels.wireframe[tool.componentKind]);
        return { type: 'wireframe', ...at(d.w, d.h), componentKind: tool.componentKind, text: d.text, props: d.props };
      }
      case 'table': {
        const cols = [0, 1, 2].map(() => ({ id: newId(), width: 120 }));
        const rows = [0, 1, 2].map(() => ({ id: newId(), height: 40 }));
        const rr = at(360, 120);
        return { type: 'table', x: rr.x, y: rr.y, w: 360, h: 120, columns: cols, rows, headerRow: true };
      }
      case 'icon':
        return { type: 'icon', ...at(48, 48), iconName: tool.iconName };
      case 'text': {
        const variant = tool.variant ?? 'body';
        const h = variant === 'heading' ? 34 : 20;
        return {
          type: 'text',
          x: snap(drag ? drag.x : center.x, GRID_SIZE / 2),
          y: snap(drag ? drag.y : center.y - h / 2, GRID_SIZE / 2),
          w: drag ? Math.max(40, drag.w) : 24,
          h,
          variant,
          fixedWidth: !!drag,
        };
      }
      default:
        return null;
    }
  }

  private finishConnect(g: Extract<Gesture, { kind: 'connect' }>, world: Point, screen: Point) {
    const m = this.model;
    this.hoverId = null;
    if (this.tool.kind === 'connector') this.tool = { kind: 'select' };
    if (dist(this.worldToScreen(g.curWorld), this.worldToScreen(g.from.objectId ? world : { x: g.from.x ?? 0, y: g.from.y ?? 0 })) < 1 && !g.target && !g.fromId) return;
    const target = g.target;
    if (!target && g.fromId && g.fromAnchor && dist(screen, g.startScreen) < DRAG_THRESHOLD + 3) {
      // 在外框上單擊（沒有拖曳）：當作點選該物件
      m.setSelection([g.fromId]);
      return;
    }
    if (!target && g.fromId && g.fromAnchor) {
      // 放在空白處：顯示快速選單
      this.quickConnect = { screen, world, fromId: g.fromId };
      this.quickConnectAnchor = g.fromAnchor;
      this.markState();
      return;
    }
    const startScreen = g.from.objectId ? null : this.worldToScreen({ x: g.from.x ?? 0, y: g.from.y ?? 0 });
    if (!target && startScreen && dist(startScreen, screen) < 8) return;
    const to: ConnectorEnd = target ?? (g.constrained ? { objectId: null, anchor: null, x: world.x, y: world.y } : { objectId: null, anchor: null, x: snap(world.x, GRID_SIZE), y: snap(world.y, GRID_SIZE) });
    if (to.objectId && to.objectId === g.from.objectId) return;
    m.stopCapturing();
    const id = m.connect(g.from, to);
    m.stopCapturing();
    m.setSelection([id]);
  }

  private onDoubleClick(e: MouseEvent) {
    const screen = this.local(e);
    const world = this.screenToWorld(screen);
    const m = this.model;
    const hit = this.hitAt(screen);
    if (!hit) {
      if (this.readOnly || this.tool.kind !== 'select') return;
      // 空白處雙擊：建立文字
      m.stopCapturing();
      const id = m.insert({ type: 'text', x: snap(world.x, GRID_SIZE / 2), y: snap(world.y - 10, GRID_SIZE / 2), w: 24, h: 20, variant: 'body', fixedWidth: false });
      this.createdForEditing = { id, stack: this.undoManager.undoStack.length };
      this.startEditing(id);
      return;
    }
    const o = m.store.get(hit.id)!;
    if (hit.body) return;
    const target = m.selectionTarget(hit.id);
    if (target !== hit.id && m.store.get(target)?.type === 'group') {
      // 進入群組：一次進入一層
      m.enteredGroupId = target;
      m.setSelection([m.selectionTarget(hit.id)]);
      this.markState();
      return;
    }
    if (o.type === 'link_card') {
      this.opts.onOpenLink?.(o.targetFileId);
      return;
    }
    if (o.type === 'section') {
      this.startEditing(o.id, { field: 'title' });
      return;
    }
    if (o.type === 'table') {
      const key = (o.type === 'table' ? tableCellAt(o, world) : null);
      if (key) this.startEditing(o.id, { field: 'cell', cellKey: key });
      return;
    }
    this.startEditing(o.id);
  }

  /** 已選取物件上的點擊：核取清單的方塊，或線框圖元件可切換的位置。回傳放開滑鼠時要執行的動作 */
  private toggleAt(id: string | null, wasSelected: boolean, shift: boolean, world: Point): (() => void) | null {
    if (!id || !wasSelected || shift || this.readOnly || this.editing) return null;
    const m = this.model;
    const o = m.store.get(id);
    if (!o || m.isLocked(id) || m.selection.length !== 1 || m.selection[0] !== id) return null;
    const task = this.taskAt(o, world);
    if (task) return () => m.toggleTask(id, task.field, task.cellKey, task.ordinal);
    const wf = this.wireframeToggleAt(id, wasSelected, shift, world);
    return wf ? () => m.setWireframeProps(wf.id, wf.patch) : null;
  }

  /** 物件文字中被點到的核取方塊（與渲染器使用相同的排版與文字框） */
  private taskAt(o: BoardObject, world: Point): { field: 'text' | 'cell'; cellKey?: string; ordinal: number } | null {
    const st = resolveStyle(o);
    const p = toLocal(o, world);
    if (o.type === 'shape' || o.type === 'text') {
      if (!o.text.some((b) => b.kind === 'task')) return null;
      const box = o.type === 'shape' ? shapeTextBox(o.shapeKind, o.x, o.y, o.w, o.h, shapeIcon(o, st.fontSize)) : { x: o.x, y: o.y, w: o.w, h: o.h };
      const lay = this.textCache.get(o.id, o.text, o.type === 'shape' ? box.w : o.fixedWidth ? o.w : null, st.fontSize, st.fontWeight);
      const ord = taskAt(lay, box, st.textAlign, o.type === 'text' ? 'top' : st.verticalAlign, p);
      return ord === null ? null : { field: 'text', ordinal: ord };
    }
    if (o.type === 'table') {
      const key = tableCellAt(o, p);
      const blocks = key ? o.cells[key] : null;
      if (!key || !blocks?.some((b) => b.kind === 'task')) return null;
      const box = tableCellTextBox(o, key)!;
      const header = o.headerRow && key.split(':')[0] === o.rows[0]?.id;
      const lay = this.textCache.get(o.id + ':' + key, blocks, box.w, st.fontSize, header ? 700 : st.fontWeight);
      const ord = taskAt(lay, box, st.textAlign === 'center' ? 'center' : st.textAlign, 'middle', p);
      return ord === null ? null : { field: 'cell', cellKey: key, ordinal: ord };
    }
    return null;
  }

  /** 已選取的線框圖元件上的點擊：可切換的位置回傳 props 變更 */
  private wireframeToggleAt(id: string | null, wasSelected: boolean, shift: boolean, world: Point): { id: string; patch: Record<string, unknown> } | null {
    if (!id || !wasSelected || shift || this.readOnly) return null;
    const o = this.model.store.get(id);
    if (!o || o.type !== 'wireframe' || this.model.isLocked(id) || this.model.selection.length !== 1 || this.model.selection[0] !== id) return null;
    const p = toLocal(o, world);
    const patch = wireframeClick(o, { x: p.x - o.x, y: p.y - o.y });
    return patch ? { id, patch } : null;
  }

  /** 選取單一表格時，指標下方的欄或列邊界（可拖曳調整欄寬、列高） */
  private tableBorderAt(screen: Point): { id: string; axis: 'col' | 'row'; refId: string; size: number } | null {
    if (this.readOnly || this.editing || this.model.selection.length !== 1) return null;
    const o = this.model.store.get(this.model.selection[0]);
    if (!o || o.type !== 'table' || this.model.isLocked(o.id)) return null;
    const w = this.screenToWorld(screen);
    const tol = 4 / this.renderer.camera.zoom;
    if (w.x < o.x - tol || w.x > o.x + o.w + tol || w.y < o.y - tol || w.y > o.y + o.h + tol) return null;
    let x = o.x;
    for (const c of o.columns) {
      x += c.width;
      if (Math.abs(w.x - x) <= tol) return { id: o.id, axis: 'col', refId: c.id, size: c.width };
    }
    let y = o.y;
    for (const r of o.rows) {
      y += r.height;
      if (Math.abs(w.y - y) <= tol) return { id: o.id, axis: 'row', refId: r.id, size: r.height };
    }
    return null;
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const screen = this.local(e);
    const mod = isMac ? e.metaKey : e.ctrlKey;
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    } else if (e.deltaMode === 2) {
      dx *= this.renderer.cssW;
      dy *= this.renderer.cssH;
    }
    if (e.ctrlKey || mod) {
      // 觸控板捏合（Chrome/Firefox 以 ctrlKey 的 wheel 事件表示）或 Mod+滾輪
      const pinch = e.ctrlKey && Math.abs(dy) < 50 && e.deltaMode === 0;
      const factor = Math.exp(-clamp(dy, -60, 60) * (pinch ? 0.01 : 0.0025));
      this.setZoom(this.renderer.camera.zoom * factor, screen);
      return;
    }
    if (e.shiftKey && !dx) {
      dx = dy;
      dy = 0;
    }
    this.panBy(-dx, -dy);
  }

  private onContextMenu(e: MouseEvent) {
    e.preventDefault();
    if (this.suppressContextMenu || this.placing) {
      this.suppressContextMenu = false;
      this.cancelPlacing();
      return;
    }
    const screen = this.local(e);
    const hit = this.hitAt(screen);
    const m = this.model;
    let targetId: string | null = null;
    let cellKey: string | undefined;
    if (hit) {
      targetId = m.selectionTarget(hit.id);
      if (!m.selection.includes(targetId)) m.setSelection([targetId]);
      const o = m.store.get(hit.id);
      if (o?.type === 'table') cellKey = tableCellAt(o, this.screenToWorld(screen)) ?? undefined;
    }
    this.contextMenu = cellKey ? { screen, targetId, cellKey } : { screen, targetId };
    this.markState();
  }

  /**
   * document 上的剪貼簿事件是否該由畫布處理：來自畫布本身的已經處理過；
   * 焦點在輸入框、可編輯文字或對話框內，或使用者選取了頁面文字時，維持瀏覽器原本的行為
   */
  private clipboardFromOutside(e: ClipboardEvent): boolean {
    if (e.defaultPrevented) return false;
    const t = e.target instanceof Element ? e.target : null;
    if (t && this.renderer.root.contains(t)) return false;
    if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"]')) return false;
    if (t instanceof HTMLElement && t.isContentEditable) return false;
    if (e.type !== 'paste') {
      const sel = t?.ownerDocument.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return false;
    }
    return true;
  }

  private onCopy(e: ClipboardEvent, cut: boolean) {
    if (this.editing) return;
    const data = this.model.serialize();
    if (!data || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData(CLIPBOARD_MIME, data);
    e.clipboardData.setData('text/plain', data);
    if (cut && !this.readOnly) this.deleteSelection({ sectionMode: 'with-contents' });
  }

  private onPaste(e: ClipboardEvent) {
    if (this.readOnly || this.editing || !e.clipboardData) return;
    const dt = e.clipboardData;
    const files = Array.from(dt.files ?? []).filter((f) => (IMAGE_MIME_TYPES as readonly string[]).includes(f.type));
    const custom = dt.getData(CLIPBOARD_MIME);
    const text = dt.getData('text/plain');
    e.preventDefault();
    const at = this.pastePoint();
    if (custom && parsePayload(custom)) return this.pasteSerialized(custom);
    if (text && parsePayload(text)) return this.pasteSerialized(text);
    if (files.length) {
      let i = 0;
      for (const f of files) void this.insertImageFile(f, { x: at.x + i * 24, y: at.y + i++ * 24 });
      return;
    }
    if (text && text.trim()) this.step(() => this.model.pasteText(text, at));
  }

  private onDrop(e: DragEvent) {
    if (this.readOnly || !e.dataTransfer) return;
    const files = Array.from(e.dataTransfer.files).filter((f) => (IMAGE_MIME_TYPES as readonly string[]).includes(f.type));
    if (!files.length) return;
    e.preventDefault();
    const at = this.screenToWorld(this.local(e));
    let i = 0;
    for (const f of files) void this.insertImageFile(f, { x: at.x + i * 24, y: at.y + i++ * 24 });
  }

  // =================================================================== keyboard

  private onKeyUp(e: KeyboardEvent) {
    if (e.key === 'Alt' && this.placing) {
      this.altDown = false;
      this.renderer.invalidateLive();
      this.renderer.invalidateOverlay();
    }
    if (e.key === ' ' || e.code === 'Space') {
      this.spaceDown = false;
      this.updateCursor();
      this.renderer.invalidateOverlay();
    }
  }

  private ensureVisible(id: string) {
    const b = this.model.unitBounds(id);
    if (!b) return;
    const v = this.renderer.viewportWorld();
    if (b.x >= v.x && b.y >= v.y && b.x + b.w <= v.x + v.w && b.y + b.h <= v.y + v.h) return;
    this.centerOn(rectCenter(b));
  }

  private cycleSelection(back: boolean) {
    const m = this.model;
    const s = m.store;
    const pool = (m.enteredGroupId ? s.children(m.enteredGroupId) : Array.from(s.objects.values()).filter((o) => s.effectiveParent(o) === null || s.get(o.parentId)?.type === 'section').map((o) => o.id))
      .map((id) => s.get(id))
      .filter((o): o is BoardObject => !!o && o.type !== 'connector' && m.selectionTarget(o.id) === o.id);
    if (!pool.length) return;
    pool.sort((a, b) => {
      const ra = rotatedAabb(a);
      const rb = rotatedAabb(b);
      return Math.abs(ra.y - rb.y) > 16 ? ra.y - rb.y : ra.x - rb.x || (a.id < b.id ? -1 : 1);
    });
    const cur = m.selection.length === 1 ? pool.findIndex((o) => o.id === m.selection[0]) : -1;
    const next = cur < 0 ? (back ? pool.length - 1 : 0) : (cur + (back ? -1 : 1) + pool.length) % pool.length;
    m.setSelection([pool[next].id]);
    this.ensureVisible(pool[next].id);
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (this.editing) {
      // 覆蓋層尚未取得焦點時，Escape 仍要能結束編輯
      if (e.key === 'Escape') {
        e.preventDefault();
        this.stopEditing();
      } else if (e.key === 'Tab' && this.editing.field === 'cell') {
        e.preventDefault();
        this.moveEditingCell(e.shiftKey ? -1 : 1, 0);
      }
      return;
    }
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    // 由 web app 處理的全域快捷鍵：不攔截
    if (mod && (lower === 'k' || key === '/')) return;
    if (mod && e.shiftKey && lower === 'e') return;
    // `/` 指令面板、W 線框圖元件庫、I 圖示庫
    if (!mod && !e.altKey && (key === '/' || lower === 'w' || lower === 'i')) return;
    const m = this.model;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (key === ' ' || e.code === 'Space') {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.updateCursor();
        this.renderer.invalidateOverlay();
      }
      handled();
      return;
    }
    if (key === 'Alt' && this.placing) {
      this.altDown = true;
      this.renderer.invalidateLive();
      this.renderer.invalidateOverlay();
      return;
    }
    if (key === 'Escape') {
      handled();
      if (this.placing) return this.cancelPlacing();
      if (this.quickConnect) return this.cancelQuickConnect();
      if (this.contextMenu) return this.closeContextMenu();
      if (this.pendingSectionDelete) return this.cancelSectionDelete();
      if (this.gesture.kind !== 'none') return this.cancelGesture();
      if (this.tool.kind !== 'select') return this.setTool({ kind: 'select' });
      if (m.enteredGroupId) {
        const g = m.enteredGroupId;
        m.enteredGroupId = null;
        m.setSelection([g]);
        this.markState();
        return;
      }
      m.setSelection([]);
      return;
    }
    if (mod) {
      switch (lower) {
        case 'z':
          handled();
          return e.shiftKey ? this.redo() : this.undo();
        case 'y':
          handled();
          return this.redo();
        case 'a':
          handled();
          return this.selectAll();
        case 'd':
          handled();
          return this.duplicateSelection();
        case 'g':
          handled();
          return e.shiftKey ? this.ungroup() : this.group();
        case 'l':
          if (e.shiftKey) {
            handled();
            return this.setLocked(!(m.selection.length > 0 && m.selection.every((id) => m.isLocked(id))));
          }
          return;
        case '=':
        case '+':
          handled();
          return this.zoomIn();
        case '-':
        case '_':
          handled();
          return this.zoomOut();
        case '0':
          handled();
          return this.setZoom(1);
      }
      if (e.altKey && key.startsWith('Arrow')) {
        handled();
        const dir = key.slice(5).toLowerCase() as 'up' | 'down' | 'left' | 'right';
        return this.extend(dir);
      }
      return;
    }
    if (e.shiftKey && (e.code === 'Digit1' || key === '!')) {
      handled();
      return this.zoomToFit();
    }
    if (e.shiftKey && (e.code === 'Digit2' || key === '@')) {
      handled();
      return this.zoomToSelection();
    }
    if (key === 'Tab') {
      handled();
      return this.cycleSelection(e.shiftKey);
    }
    if (key === 'Delete' || key === 'Backspace') {
      handled();
      return this.deleteSelection();
    }
    if (key.startsWith('Arrow')) {
      handled();
      if (this.readOnly || !m.selection.length) {
        const d = e.shiftKey ? 200 : 40;
        const v = { ArrowLeft: [d, 0], ArrowRight: [-d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[key] ?? [0, 0];
        return this.panBy(v[0], v[1]);
      }
      const step = e.shiftKey ? GRID_SIZE : 1;
      const v = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key] ?? [0, 0];
      const picked = m.selection.filter((id) => !m.isLocked(id));
      m.moveUnits([...picked, ...m.carriedUnits(picked)], v[0], v[1]);
      return;
    }
    if (key === 'Enter') {
      handled();
      if (m.selection.length !== 1) return;
      const o = m.store.get(m.selection[0])!;
      if (o.type === 'group') {
        m.enteredGroupId = o.id;
        const kids = m.store.sortedChildren(o.id);
        m.setSelection(kids.length ? [kids[0].id] : []);
        this.markState();
        return;
      }
      return this.startEditing(o.id);
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // 單鍵工具
    const tools: Record<string, Tool> = {
      r: { kind: 'shape', shapeKind: 'rectangle' },
      o: { kind: 'shape', shapeKind: 'ellipse' },
      t: { kind: 'text' },
      l: { kind: 'connector' },
      v: { kind: 'select' },
      h: { kind: 'hand' },
    };
    // 選取單一可編輯物件時直接打字 → 開始編輯，以該字元取代內容
    if (key.length === 1 && m.selection.length === 1 && !this.readOnly) {
      const o = m.store.get(m.selection[0]);
      if (o && (o.type === 'shape' || o.type === 'text' || o.type === 'wireframe') && !m.isLocked(o.id)) {
        handled();
        return this.startEditing(o.id, { seed: key });
      }
    }
    if (key === 'Process' && m.selection.length === 1 && !this.readOnly) {
      // 輸入法組字開始：不取代內容，直接進入編輯讓覆蓋層接手
      const o = m.store.get(m.selection[0]);
      if (o && (o.type === 'shape' || o.type === 'text' || o.type === 'wireframe')) return this.startEditing(o.id);
    }
    const t = tools[lower];
    if (t && !e.shiftKey) {
      handled();
      this.setTool(t);
    }
  }
}

