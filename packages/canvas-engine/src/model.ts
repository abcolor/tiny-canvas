import * as Y from 'yjs';
import { generateNKeysBetween } from 'fractional-indexing';
import {
  GRID_SIZE,
  compareZ,
  createObjectMap,
  localOrigin,
  newId,
  emptyFragment,
  setPlainText,
  systemOrigin,
  zBetween,
  type Anchor,
  type AnchorSide,
  type BoardObject,
  type ConnectorEnd,
  type ConnectorObject,
  type NewObjectInput,
  type Point,
  type SectionObject,
  type ShapeKind,
  type TableObject,
  type WireframeKind,
  type Style,
  type YObject,
} from '@tinycanvas/shared';
import { layoutGraph } from '@tinycanvas/layout';
import { sectionContentRect } from './frames';
import { isTaskChecked, taskItems } from './text/tasks';
import { wireframeDefaults } from './render/wireframe';
import { TABLE_CELL_PAD } from './render/table';
import {
  containsPoint,
  intersects,
  rectCenter,
  rotatePoint,
  rotatedAabb,
  snap,
  unionRects,
  type Rect,
} from './geometry';
import { SceneStore, type StoreChange } from './store';
import { RouteCache, simplify } from './connectors/route';
import { OPPOSITE, SIDE_DIR, anchorPoint, hasManualRoute, isConnectable, resolveEnds } from './connectors/ends';
import { layoutRichText, type Measurer } from './text/layout';
import { NEW_STROKE_WIDTH, resolveStyle, defaultShapeSize } from './style';
import { shapeHeightForText, shapeIcon, shapeTextBox } from './render/shapes';
import {
  CLIPBOARD_MARKER,
  buildObjectMap,
  parsePayload,
  serializeObjectMap,
  type ClipboardPayload,
  type SerializedValue,
} from './clipboard';
import type { AlignKind, EngineLabels } from './types';
import { DEFAULT_LABELS } from './types';

export interface ModelOptions {
  doc: Y.Doc;
  extraTrackedOrigins?: unknown[];
  measurer?: Measurer | null;
  readOnly?: boolean;
  labels?: EngineLabels;
}

export type GeomPatch = Partial<Pick<BoardObject, 'x' | 'y' | 'w' | 'h' | 'rotation'>> & {
  from?: ConnectorEnd;
  to?: ConnectorEnd;
  /** 手動路線的轉折點（見 connectors/route.ts 的 manualPath） */
  waypoints?: Point[];
  fixedWidth?: boolean;
  /** 表格縮放時的欄寬與列高（套用時改寫 Y.Array） */
  columns?: { id: string; width: number }[];
  rows?: { id: string; height: number }[];
};

/** 放置複本時的資料（見 BoardEditor.startPlacingDuplicate） */
export interface Placement {
  data: string;
  /** 原物件的快照（依繪製順序；不在範圍內的連線端點已改為懸空） */
  objects: BoardObject[];
  bounds: Rect;
}

export const PLACING_PREFIX = 'placing:';

export type SectionDeleteMode = 'section-only' | 'with-contents';

export const TABLE_MIN_COL = 40;
export const TABLE_MIN_ROW = 28;

const NON_ROTATABLE = new Set(['wireframe', 'section', 'table', 'connector']);
/** 會影響文字物件或自動增高形狀尺寸的欄位 */
const SIZE_KEYS = new Set(['text', 'w', 'style', 'fixedWidth', 'variant', 'icon', 'shapeKind', 'autoHeight']);

export const isContainerType = (t: string | undefined) => t === 'group' || t === 'section';

function norm360(d: number): number {
  let r = d % 360;
  if (r < 0) r += 360;
  return Math.abs(r) < 1e-9 || Math.abs(r - 360) < 1e-9 ? 0 : r;
}

/**
 * 安全版 zBetween：遇到不合法的 key（其他用戶端或舊資料寫入的）時不丟出例外，
 * 依序退回「只看下界」「只看上界」，最後以字串附加產生一個比 lo 大的 key。
 */
export function safeZBetween(lo: string | null, hi: string | null): string {
  try {
    return zBetween(lo, hi);
  } catch {
    try {
      return zBetween(lo, null);
    } catch {
      try {
        if (hi !== null) return zBetween(null, hi);
      } catch {
        /* 繼續退回 */
      }
      return (lo ?? 'a0') + 'V';
    }
  }
}

/** 在 (lo, hi) 之間產生 n 個遞增的 z key；lo >= hi 時改為 lo 之後 */
export function zKeysBetween(lo: string | null, hi: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (lo !== null && hi !== null && lo >= hi) hi = null;
  try {
    return generateNKeysBetween(lo, hi, n);
  } catch {
    const out: string[] = [];
    let prev = lo;
    for (let i = 0; i < n; i++) out.push((prev = safeZBetween(prev, hi)));
    return out;
  }
}

/**
 * 不依賴 DOM 的編輯器核心：Yjs 文件、快照、UndoManager、選取狀態與所有修改指令。
 * BoardEditor 在其上加上渲染與輸入處理；單元測試直接使用它。
 */
export class EditorModel {
  readonly doc: Y.Doc;
  readonly store: SceneStore;
  readonly undoManager: Y.UndoManager;
  readonly routes: RouteCache;
  readonly trackedOrigins: Set<unknown>;
  measurer: Measurer | null;
  readOnly: boolean;
  labels: EngineLabels;

  selection: string[] = [];
  enteredGroupId: string | null = null;
  private selectionListeners = new Set<() => void>();
  private styleClipboard: Style | null = null;
  private pasteCount = 0;
  /** 貼上與放置複本時不重新計算文字尺寸（複本沿用來源的尺寸），確保是單一 transaction */
  private pasting = false;
  private lastPasteKey = '';
  private unsub: () => void;

  constructor(opts: ModelOptions) {
    this.doc = opts.doc;
    this.readOnly = !!opts.readOnly;
    this.measurer = opts.measurer ?? null;
    this.labels = opts.labels ?? DEFAULT_LABELS;
    this.store = new SceneStore(this.doc);
    this.trackedOrigins = new Set<unknown>([localOrigin, ...(opts.extraTrackedOrigins ?? [])]);
    this.undoManager = new Y.UndoManager(this.store.ymap, {
      trackedOrigins: this.trackedOrigins,
      captureTimeout: 300,
    });
    this.routes = new RouteCache({
      get: this.store.getter,
      obstaclesIn: (r) => {
        const out: BoardObject[] = [];
        for (const it of this.store.query(r)) {
          if (it.connector) continue;
          const o = this.store.get(it.id);
          if (o) out.push(o);
        }
        return out;
      },
    });
    this.unsub = this.store.onChange((c) => this.onStoreChange(c));
  }

  destroy() {
    this.unsub();
    this.undoManager.destroy();
    this.store.destroy();
    this.selectionListeners.clear();
  }

  get ymap() {
    return this.store.ymap;
  }

  // ------------------------------------------------------------------ transactions

  /**
   * 本地使用者動作：一個 transaction，origin 為 localOrigin。
   * 結束前（同一個 transaction 內）重新計算受影響群組的外接框（見 SPEC.md 第 3.3 節）。
   */
  transact(fn: () => void): void {
    if (this.readOnly) return;
    this.doc.transact((tr) => {
      fn();
      this.fixGroupsInTransaction(tr);
    }, localOrigin);
  }

  private touchedIds(tr: Y.Transaction): Set<string> {
    const touched = new Set<string>();
    const ymap = this.ymap;
    tr.changed.forEach((keys, type) => {
      if (type === (ymap as unknown)) {
        keys.forEach((k) => k && touched.add(k));
        return;
      }
      let t: any = type;
      let guard = 0;
      while (t && t._item && t._item.parent !== ymap && guard++ < 64) t = t._item.parent;
      if (t && t._item && t._item.parent === ymap && t._item.parentSub) touched.add(t._item.parentSub);
    });
    return touched;
  }

  private fixGroupsInTransaction(tr: Y.Transaction) {
    const touched = this.touchedIds(tr);
    if (touched.size) this.fixGroups(touched, (id) => this.store.get(id)?.parentId ?? null, false);
  }

  /**
   * 重新計算群組外接框（讀取目前的 Y 狀態）。由深到淺處理；沒有子物件的群組會被刪除。
   * dryRun 時不寫入，只回傳是否需要修改。
   */
  fixGroups(touched: Iterable<string>, prevParent: (id: string) => string | null, dryRun: boolean): boolean {
    const ymap = this.ymap;
    const groups = new Set<string>();
    const touchedSet = new Set(touched);
    const addChain = (pid: string | null) => {
      let guard = 0;
      while (pid && guard++ < 64) {
        const m = ymap.get(pid);
        if (!m) {
          pid = this.store.get(pid)?.parentId ?? null;
          continue;
        }
        if (m.get('type') === 'group') groups.add(pid);
        pid = (m.get('parentId') as string | null) ?? null;
      }
    };
    for (const id of touchedSet) {
      const m = ymap.get(id);
      if (m && m.get('type') === 'group') groups.add(id);
      addChain((m?.get('parentId') as string | null) ?? null);
      addChain(prevParent(id));
    }
    if (!groups.size) return false;
    const depth = (id: string) => {
      let d = 0;
      let p = ymap.get(id)?.get('parentId') as string | null;
      while (p && d < 64) {
        d++;
        p = ymap.get(p)?.get('parentId') ?? null;
      }
      return d;
    };
    const sorted = Array.from(groups).sort((a, b) => depth(b) - depth(a));
    let changed = false;
    const removed = new Set<string>();
    for (const g of sorted) {
      const gm = ymap.get(g);
      if (!gm || gm.get('type') !== 'group') continue;
      const kids = new Set<string>([...this.store.children(g), ...touchedSet]);
      const rects: Rect[] = [];
      for (const k of kids) {
        if (k === g || removed.has(k)) continue;
        const km = ymap.get(k);
        if (!km || km.get('parentId') !== g || km.get('type') === 'connector') continue;
        rects.push(
          rotatedAabb({
            x: num(km.get('x')),
            y: num(km.get('y')),
            w: num(km.get('w'), 1),
            h: num(km.get('h'), 1),
            rotation: km.get('type') === 'group' ? 0 : num(km.get('rotation')),
          }),
        );
      }
      if (!rects.length) {
        changed = true;
        if (!dryRun) {
          ymap.delete(g);
          removed.add(g);
        }
        continue;
      }
      const b = unionRects(rects)!;
      const cur = { x: num(gm.get('x')), y: num(gm.get('y')), w: num(gm.get('w'), 1), h: num(gm.get('h'), 1) };
      const eq = (a: number, c: number) => Math.abs(a - c) < 1e-6;
      if (!eq(cur.x, b.x) || !eq(cur.y, b.y) || !eq(cur.w, b.w) || !eq(cur.h, b.h) || num(gm.get('rotation')) !== 0) {
        changed = true;
        if (!dryRun) {
          if (!eq(cur.x, b.x)) gm.set('x', b.x);
          if (!eq(cur.y, b.y)) gm.set('y', b.y);
          if (!eq(cur.w, b.w)) gm.set('w', b.w);
          if (!eq(cur.h, b.h)) gm.set('h', b.h);
          if (num(gm.get('rotation')) !== 0) gm.set('rotation', 0);
        }
      }
    }
    return changed;
  }

  private onStoreChange(c: StoreChange) {
    for (const id of c.reroute) this.routes.invalidate(id);
    // 刪除的物件從選取中移除
    if (this.selection.some((id) => !this.store.get(id))) {
      this.setSelection(this.selection.filter((id) => this.store.get(id)));
    }
    if (this.enteredGroupId && !this.store.get(this.enteredGroupId)) this.enteredGroupId = null;
    const tr = c.transaction;
    if (!tr || this.readOnly) return;
    const origin = tr.origin;
    // 其他分頁、離線合併或復原造成的變動：以 systemOrigin 補算群組外接框，數值相同時不寫入
    if (origin !== localOrigin && origin !== systemOrigin) {
      const prev = (id: string) => c.prevParents.get(id) ?? null;
      if (this.fixGroups(c.ids, prev, true)) {
        this.doc.transact(() => this.fixGroups(c.ids, prev, false), systemOrigin);
      }
    }
    // 本地文字變動後重新計算尺寸（自動增高的形狀、自動寬度的文字），origin 為 localOrigin
    if (tr.local && this.trackedOrigins.has(origin) && origin !== this.undoManager && this.measurer && !this.pasting) {
      const ids: string[] = [];
      for (const id of c.ids) {
        const o = this.store.get(id);
        if (!o || (o.type !== 'shape' && o.type !== 'text')) continue;
        const keys = c.keys.get(id);
        if (!keys || keys.has('*') || Array.from(keys).some((k) => SIZE_KEYS.has(k))) ids.push(id);
      }
      const tables: string[] = [];
      for (const id of c.ids) {
        if (this.store.get(id)?.type !== 'table') continue;
        const keys = c.keys.get(id);
        if (!keys || keys.has('*') || keys.has('cells') || keys.has('columns') || keys.has('style')) tables.push(id);
      }
      const rowFix = tables.length ? this.computeTableRowHeights(tables) : new Map<string, Map<string, number>>();
      if (ids.length || rowFix.size) {
        const patches = this.computeAutoSize(ids);
        if (patches.size || rowFix.size) {
          this.transact(() => {
            for (const [id, p] of patches) this.setFields(id, p);
            for (const [id, rows] of rowFix) this.setTableDims(id, null, rows);
          });
        }
      }
    }
  }

  // ------------------------------------------------------------------ text sizing

  /** 計算文字物件（自動寬度或固定寬度）與自動增高形狀需要的尺寸；只回傳需要變更的 */
  computeAutoSize(ids: string[]): Map<string, Record<string, number>> {
    const out = new Map<string, Record<string, number>>();
    if (!this.measurer) return out;
    for (const id of ids) {
      const o = this.store.get(id);
      if (!o) continue;
      const st = resolveStyle(o);
      if (o.type === 'text') {
        const lay = layoutRichText(
          o.text,
          { maxWidth: o.fixedWidth ? Math.max(8, o.w) : null, fontSize: st.fontSize, fontWeight: st.fontWeight },
          this.measurer,
        );
        const p: Record<string, number> = {};
        const h = Math.max(lay.height, st.fontSize * 1.4);
        if (!o.fixedWidth) {
          const w = Math.max(Math.ceil(lay.width) + 4, 16);
          if (Math.abs(w - o.w) > 0.5) p.w = w;
        }
        if (Math.abs(h - o.h) > 0.5) p.h = h;
        if (Object.keys(p).length) out.set(id, p);
      } else if (o.type === 'shape' && o.autoHeight) {
        const box = textBoxWidth(o);
        const lay = layoutRichText(o.text, { maxWidth: box, fontSize: st.fontSize, fontWeight: st.fontWeight }, this.measurer);
        const need = shapeHeightForText(o.shapeKind, o.w, lay.height, shapeIcon(o, st.fontSize));
        if (need > o.h + 0.5) out.set(id, { h: Math.ceil(need / GRID_SIZE) * GRID_SIZE });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ selection

  onSelectionChange(l: () => void): () => void {
    this.selectionListeners.add(l);
    return () => this.selectionListeners.delete(l);
  }

  setSelection(ids: string[]) {
    const next = this.normalizeUnits(ids);
    const same = next.length === this.selection.length && next.every((id, i) => id === this.selection[i]);
    if (same) return;
    this.selection = next;
    for (const l of this.selectionListeners) l();
  }

  /** 去除不存在的 id、重複，以及祖先也在選取中的子孫；依繪製順序排序 */
  normalizeUnits(ids: string[]): string[] {
    const set = new Set(ids.filter((id) => this.store.get(id)));
    const out: string[] = [];
    for (const id of set) {
      if (this.store.ancestors(id).some((a) => set.has(a.id))) continue;
      out.push(id);
    }
    return this.store.sortByOrder(out);
  }

  /** 選取的「單位」：在群組外點選時選到的是最外層（進入的群組以下）的群組 */
  selectionTarget(id: string): string {
    let cur = this.store.get(id);
    if (!cur) return id;
    let target = cur.id;
    let guard = 0;
    while (cur && guard++ < 64) {
      const p = this.store.get(cur.parentId);
      if (!p || p.type !== 'group' || p.id === this.enteredGroupId) break;
      target = p.id;
      cur = p;
    }
    return target;
  }

  isInsideEnteredGroup(id: string): boolean {
    if (!this.enteredGroupId) return false;
    return this.store.ancestors(id).some((a) => a.id === this.enteredGroupId);
  }

  isLocked(id: string): boolean {
    const o = this.store.get(id);
    if (!o) return false;
    if (o.locked) return true;
    return this.store.ancestors(id).some((a) => a.locked);
  }

  /** 物件（含群組外接框）的軸對齊範圍 */
  unitBounds(id: string): Rect | null {
    const o = this.store.get(id);
    if (!o) return null;
    if (o.type === 'connector') {
      const r = this.routes.get(o as ConnectorObject);
      return r.bounds;
    }
    return rotatedAabb(o);
  }

  /**
   * 移動形狀時一起帶走的物件（見 SPEC.md 第 3.3 節「形狀內的物件」）：與形狀在同一層容器、
   * 完整位在形狀範圍內、且畫在形狀上方的物件（群組以整個群組為單位；連線、區塊、鎖定的物件除外）。
   * 被帶走的形狀會再帶走它範圍內的物件（可多層）。旋轉過的形狀不帶走任何物件。
   * 回傳不含 units 本身的額外單位。
   */
  carriedUnits(units: string[]): string[] {
    const taken = new Set(units);
    for (const u of units) for (const d of this.store.descendants(u)) taken.add(d);
    const result: string[] = [];
    const queue = units.filter((id) => this.store.get(id)?.type === 'shape');
    while (queue.length) {
      const shape = this.store.get(queue.shift()!);
      if (!shape || shape.rotation !== 0) continue;
      const level = this.store.effectiveParent(shape);
      const box = { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
      for (const it of this.store.query(box)) {
        if (it.connector) continue;
        const unitId = this.unitAtLevel(it.id, level);
        if (!unitId || taken.has(unitId)) continue;
        const u = this.store.get(unitId)!;
        if (u.type === 'connector' || u.type === 'section' || this.isLocked(unitId)) continue;
        if (compareZ(u, shape) <= 0) continue;
        const b = this.unitBounds(unitId);
        if (!b || b.x < box.x || b.y < box.y || b.x + b.w > box.x + box.w || b.y + b.h > box.y + box.h) continue;
        taken.add(unitId);
        for (const d of this.store.descendants(unitId)) taken.add(d);
        result.push(unitId);
        if (u.type === 'shape') queue.push(unitId);
      }
    }
    return result;
  }

  /** 物件在指定容器層級的單位：往上找到 effectiveParent 等於 level 的祖先（或自己）；找不到回傳 null */
  private unitAtLevel(id: string, level: string | null): string | null {
    let o = this.store.get(id);
    let guard = 0;
    while (o && guard++ < 64) {
      const p = this.store.effectiveParent(o);
      if (p === level) return o.id;
      if (p === null) return null;
      o = this.store.get(p);
    }
    return null;
  }

  selectionBounds(ids = this.selection): Rect | null {
    return unionRects(ids.map((id) => this.unitBounds(id)).filter(Boolean) as Rect[]);
  }

  // ------------------------------------------------------------------ helpers

  private ym(id: string): YObject | undefined {
    return this.ymap.get(id);
  }

  setFields(id: string, patch: Record<string, unknown>) {
    const m = this.ym(id);
    if (!m) return;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      const cur = m.get(k);
      if (cur === v) continue;
      if (typeof v === 'object' && v !== null && !(v instanceof Y.AbstractType) && JSON.stringify(cur) === JSON.stringify(v)) continue;
      m.set(k, v);
    }
  }

  /** 同一個容器內的兄弟物件（連線之間互為兄弟），依 (z, id) 排序 */
  siblingsOf(o: BoardObject): BoardObject[] {
    if (o.type === 'connector') return this.store.sortedChildren(null).filter((s) => s.type === 'connector');
    const p = this.store.effectiveParent(o);
    return this.siblingsIn(p);
  }

  siblingsIn(parentId: string | null): BoardObject[] {
    const kids = this.store.sortedChildren(parentId).filter((s) => s.type !== 'connector');
    if (parentId === null) {
      // 指向不存在容器的物件也視為頂層
      const extra: BoardObject[] = [];
      for (const o of this.store.objects.values()) {
        if (o.type !== 'connector' && o.parentId !== null && this.store.effectiveParent(o) === null) extra.push(o);
      }
      if (extra.length) return [...kids, ...extra].sort(compareZ);
    }
    return kids;
  }

  private topZ(parentId: string | null, exclude?: Set<string>, connectors = false): string | null {
    const list = connectors
      ? this.store.sortedChildren(null).filter((s) => s.type === 'connector')
      : this.siblingsIn(parentId);
    for (let i = list.length - 1; i >= 0; i--) if (!exclude?.has(list[i].id)) return list[i].z;
    return null;
  }

  /** 中心點所在、z 最高的區塊（排除 exclude） */
  sectionAt(p: Point, exclude: Set<string> = new Set(), offsets?: Map<string, Point>): BoardObject | null {
    let best: BoardObject | null = null;
    for (const o of this.store.objects.values()) {
      if (o.type !== 'section' || exclude.has(o.id)) continue;
      const off = offsets?.get(o.id);
      // 裝置框以內容區判定（不含外框與介面列）
      const c = sectionContentRect(o as SectionObject);
      const r = off ? { x: c.x + off.x, y: c.y + off.y, w: c.w, h: c.h } : c;
      if (!containsPoint(r, p)) continue;
      if (!best || compareZ(best, o) < 0) best = o;
    }
    return best;
  }

  // ------------------------------------------------------------------ insert

  /** 新增物件；沒有指定 parentId 時依中心點決定是否放進區塊。回傳 id */
  insert(input: NewObjectInput, opts: { select?: boolean } = {}): string {
    if (this.readOnly) return '';
    const id = input.id ?? newId();
    this.transact(() => {
      this.insertInTx({ ...input, id });
    });
    if (opts.select !== false) this.setSelection([id]);
    return id;
  }

  insertInTx(input: NewObjectInput): string {
    const id = input.id ?? newId();
    let parentId = input.parentId ?? null;
    if (input.type === 'connector' || input.type === 'section') parentId = null;
    else if (input.parentId === undefined) {
      const c = { x: input.x + input.w / 2, y: input.y + input.h / 2 };
      parentId = this.sectionAt(c)?.id ?? null;
    }
    const z = input.z ?? safeZBetween(this.topZ(parentId, undefined, input.type === 'connector'), null);
    const full: NewObjectInput = { ...input, id, parentId, z };
    // 新形狀與連線的線條粗細預設為 NEW_STROKE_WIDTH（存進文件；舊物件維持原本的預設粗細）
    if ((full.type === 'shape' || full.type === 'connector') && full.style?.strokeWidth === undefined) {
      full.style = { ...full.style, strokeWidth: NEW_STROKE_WIDTH };
    }
    if (full.type === 'shape') {
      full.shapeKind ??= 'rectangle';
      full.icon ??= null;
      full.iconPosition ??= 'top';
      full.autoHeight ??= true;
    }
    if (full.type === 'text') {
      full.variant ??= 'body';
      full.fixedWidth ??= false;
    }
    if (full.type === 'connector') {
      full.waypoints ??= [];
      full.label ??= '';
      full.routing ??= 'orthogonal';
      full.startArrow ??= 'none';
      full.endArrow ??= 'triangle';
      full.dashed ??= false;
    }
    if (full.type === 'wireframe') {
      const kind = (full.componentKind as WireframeKind) ?? 'button';
      const d = wireframeDefaults(kind, this.labels.wireframe[kind]);
      full.componentKind ??= 'button';
      full.props ??= d.props;
      if (full.text === undefined) full.text = d.text;
    }
    if (full.type === 'section') {
      full.title ??= this.labels.sectionTitle;
      full.frameKind ??= null;
    }
    this.ymap.set(id, createObjectMap(full));
    return id;
  }

  // ------------------------------------------------------------------ move / reparent

  /** 移動選取單位會改變的欄位：單位與所有子孫的 x/y；連線的懸空端點 */
  planMove(units: string[], dx: number, dy: number): Map<string, GeomPatch> {
    const out = new Map<string, GeomPatch>();
    for (const u of units) {
      const o = this.store.get(u);
      if (!o || this.isLocked(u)) continue;
      if (o.type === 'connector') {
        const p: GeomPatch = {};
        if (!o.from.objectId || !this.store.get(o.from.objectId)) p.from = { ...o.from, objectId: null, x: (o.from.x ?? 0) + dx, y: (o.from.y ?? 0) + dy };
        if (!o.to.objectId || !this.store.get(o.to.objectId)) p.to = { ...o.to, objectId: null, x: (o.to.x ?? 0) + dx, y: (o.to.y ?? 0) + dy };
        if (p.from || p.to) out.set(u, p);
        continue;
      }
      for (const id of [u, ...this.store.descendants(u)]) {
        const d = this.store.get(id);
        if (!d || d.type === 'connector' || out.has(id)) continue;
        out.set(id, { x: d.x + dx, y: d.y + dy });
      }
    }
    this.planMoveWaypoints(out, units, dx, dy);
    return out;
  }

  /** 兩端都跟著移動的連線，手動路線的轉折點一起平移；只有一端移動時保持不動（頭尾段會自動調整） */
  private planMoveWaypoints(out: Map<string, GeomPatch>, units: string[], dx: number, dy: number) {
    const unitSet = new Set(units);
    const seen = new Set<string>();
    const consider = (cid: string) => {
      if (seen.has(cid)) return;
      seen.add(cid);
      const c = this.store.get(cid);
      if (!c || c.type !== 'connector' || !hasManualRoute(c) || this.isLocked(cid)) return;
      const moves = (e: ConnectorEnd) => (e.objectId && this.store.get(e.objectId) ? out.has(e.objectId) : unitSet.has(cid));
      if (!moves(c.from) || !moves(c.to)) return;
      out.set(cid, { ...out.get(cid), waypoints: c.waypoints.map((w) => ({ x: w.x + dx, y: w.y + dy })) });
    };
    for (const u of units) if (this.store.get(u)?.type === 'connector') consider(u);
    for (const id of Array.from(out.keys())) for (const cid of this.store.connectorsAttachedTo(id)) consider(cid);
  }

  /** 移動並依中心點判定拖入、拖出區塊（見 SPEC.md 第 3.3 節）。一個 transaction */
  moveUnits(ids: string[], dx: number, dy: number, opts: { reparent?: boolean } = {}) {
    const units = this.normalizeUnits(ids);
    const plan = this.planMove(units, dx, dy);
    if (!plan.size) return;
    this.transact(() => {
      this.applyPlan(plan);
      if (opts.reparent !== false) this.reparentUnits(units, plan);
    });
  }

  applyPlan(plan: Map<string, GeomPatch>) {
    for (const [id, p] of plan) {
      const { columns, rows, ...rest } = p;
      if (columns || rows) {
        this.setTableDims(id, columns ? new Map(columns.map((c) => [c.id, c.width])) : null, rows ? new Map(rows.map((r) => [r.id, r.height])) : null);
        delete rest.w;
        delete rest.h;
      }
      this.setFields(id, rest as Record<string, unknown>);
    }
  }

  /** 依新位置的中心點重新決定單位的歸屬區塊。plan 是尚未反映到快照的位置變更 */
  reparentUnits(units: string[], plan: Map<string, GeomPatch>) {
    const movedSections = new Map<string, Point>();
    for (const [id, p] of plan) {
      const o = this.store.get(id);
      if (o?.type === 'section' && p.x !== undefined) movedSections.set(id, { x: p.x - o.x, y: (p.y ?? o.y) - o.y });
    }
    for (const u of units) {
      const o = this.store.get(u);
      if (!o || o.type === 'connector' || o.type === 'section' || this.isLocked(u)) continue;
      const parent = this.store.get(o.parentId);
      // 群組內的子物件跟著群組，不個別判定
      if (parent && parent.type === 'group') continue;
      const p = plan.get(u);
      const nx = p?.x ?? o.x;
      const ny = p?.y ?? o.y;
      const r = rotatedAabb({ x: nx, y: ny, w: p?.w ?? o.w, h: p?.h ?? o.h, rotation: p?.rotation ?? o.rotation });
      const c = rectCenter(r);
      const target = this.sectionAt(c, new Set([u]), movedSections);
      const newParent = target ? target.id : null;
      const curParent = this.store.effectiveParent(o);
      if (newParent !== curParent || o.parentId !== curParent) {
        const z = safeZBetween(this.topZ(newParent, new Set([u])), null);
        this.setFields(u, { parentId: newParent, z });
      }
    }
  }

  // ------------------------------------------------------------------ groups

  canGroup(ids = this.selection): boolean {
    const units = this.normalizeUnits(ids).map((id) => this.store.get(id)!);
    const members = units.filter((o) => o.type !== 'connector');
    if (members.length < 2) return false;
    return !members.some((o) => o.type === 'section');
  }

  canUngroup(ids = this.selection): boolean {
    return this.normalizeUnits(ids).some((id) => this.store.get(id)?.type === 'group' && !this.isLocked(id));
  }

  /** 建立群組（見 SPEC.md 第 3.3 節）。回傳新群組 id；不允許時回傳 null */
  group(ids = this.selection): string | null {
    if (this.readOnly || !this.canGroup(ids)) return null;
    const units = this.normalizeUnits(ids)
      .map((id) => this.store.get(id)!)
      .filter((o) => o.type !== 'connector');
    const parents = new Set(units.map((o) => this.store.effectiveParent(o)));
    const parentId = parents.size === 1 ? [...parents][0] : null;
    const memberIds = new Set(units.map((o) => o.id));
    let gz: string;
    if (parents.size === 1) {
      // 群組取代最上層成員在兄弟中的位置
      const sib = this.siblingsIn(parentId);
      const top = [...sib].reverse().find((s) => memberIds.has(s.id))!;
      gz = top.z;
    } else {
      gz = safeZBetween(this.topZ(null, memberIds), null);
    }
    const keys = zKeysBetween(null, null, units.length);
    const ordered = this.store.sortByOrder(units.map((o) => o.id));
    const b = unionRects(units.map((o) => rotatedAabb(o)))!;
    const gid = newId();
    this.transact(() => {
      this.ymap.set(gid, createObjectMap({ type: 'group', id: gid, x: b.x, y: b.y, w: b.w, h: b.h, parentId, z: gz }));
      ordered.forEach((id, i) => this.setFields(id, { parentId: gid, z: keys[i] }));
    });
    this.enteredGroupId = this.enteredGroupId && memberIds.has(this.enteredGroupId) ? null : this.enteredGroupId;
    this.setSelection([gid]);
    return gid;
  }

  /** 解除群組（一次一層）：子物件改屬群組原本的容器，位置不變並維持選取 */
  ungroup(ids = this.selection): string[] {
    if (this.readOnly) return [];
    const groups = this.normalizeUnits(ids).filter((id) => this.store.get(id)?.type === 'group' && !this.isLocked(id));
    if (!groups.length) return [];
    const keep = this.normalizeUnits(ids).filter((id) => !groups.includes(id));
    const freed: string[] = [];
    this.transact(() => {
      for (const g of groups) {
        const go = this.store.get(g)!;
        const parentId = this.store.effectiveParent(go);
        const sib = this.siblingsIn(parentId);
        const i = sib.findIndex((s) => s.id === g);
        const lo = i > 0 ? sib[i - 1].z : null;
        const hi = i >= 0 && i < sib.length - 1 ? sib[i + 1].z : null;
        const kids = this.store.sortedChildren(g).filter((k) => k.type !== 'connector');
        const keys = zKeysBetween(lo, hi, kids.length);
        kids.forEach((k, j) => this.setFields(k.id, { parentId, z: keys[j] }));
        this.ymap.delete(g);
        freed.push(...kids.map((k) => k.id));
      }
    });
    if (this.enteredGroupId && groups.includes(this.enteredGroupId)) this.enteredGroupId = null;
    this.setSelection([...keep, ...freed]);
    return freed;
  }

  // ------------------------------------------------------------------ z order

  private reorder(ids: string[], mode: 'forward' | 'backward' | 'front' | 'back') {
    if (this.readOnly) return;
    const units = this.normalizeUnits(ids).filter((id) => !this.isLocked(id));
    if (!units.length) return;
    // 依容器分組；連線自成一組
    const buckets = new Map<string, BoardObject[]>();
    for (const id of units) {
      const o = this.store.get(id)!;
      const key = o.type === 'connector' ? '\u0000connectors' : (this.store.effectiveParent(o) ?? '\u0000root');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(o);
    }
    this.transact(() => {
      for (const [, sel] of buckets) {
        const sib = this.siblingsOf(sel[0]);
        const selected = new Set(sel.map((o) => o.id));
        let arr = sib.slice();
        if (mode === 'front') arr = [...arr.filter((o) => !selected.has(o.id)), ...arr.filter((o) => selected.has(o.id))];
        else if (mode === 'back') arr = [...arr.filter((o) => selected.has(o.id)), ...arr.filter((o) => !selected.has(o.id))];
        else if (mode === 'forward') {
          for (let i = arr.length - 2; i >= 0; i--) {
            if (selected.has(arr[i].id) && !selected.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
          }
        } else {
          for (let i = 1; i < arr.length; i++) {
            if (selected.has(arr[i].id) && !selected.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
          }
        }
        // 只改選取物件的 z：放在新位置的前一個物件與下一個未選取物件之間
        let prevZ: string | null = null;
        for (let i = 0; i < arr.length; i++) {
          const o = arr[i];
          if (!selected.has(o.id)) {
            prevZ = o.z;
            continue;
          }
          let hi: string | null = null;
          for (let j = i + 1; j < arr.length; j++)
            if (!selected.has(arr[j].id)) {
              hi = arr[j].z;
              break;
            }
          const z = safeZBetween(prevZ, hi);
          this.setFields(o.id, { z });
          prevZ = z;
        }
      }
    });
  }

  bringForward(ids = this.selection) {
    this.reorder(ids, 'forward');
  }
  sendBackward(ids = this.selection) {
    this.reorder(ids, 'backward');
  }
  bringToFront(ids = this.selection) {
    this.reorder(ids, 'front');
  }
  sendToBack(ids = this.selection) {
    this.reorder(ids, 'back');
  }

  // ------------------------------------------------------------------ delete

  /** 選取範圍內「有子物件」的區塊；刪除前需要詢問使用者 */
  sectionsNeedingConfirm(ids = this.selection): string[] {
    return this.normalizeUnits(ids).filter((id) => {
      const o = this.store.get(id);
      return o?.type === 'section' && !this.isLocked(id) && this.store.children(id).length > 0;
    });
  }

  /**
   * 刪除。區塊預設為 'with-contents'；'section-only' 時子物件改為頂層，位置不變。
   * 接在被刪物件上的連線一併刪除。鎖定的物件不刪。一個 transaction
   */
  deleteIds(ids = this.selection, sectionMode: SectionDeleteMode = 'with-contents') {
    if (this.readOnly) return;
    const units = this.normalizeUnits(ids).filter((id) => !this.isLocked(id));
    if (!units.length) return;
    const doomed = new Set<string>();
    const release: { section: BoardObject; kids: BoardObject[] }[] = [];
    for (const u of units) {
      const o = this.store.get(u)!;
      doomed.add(u);
      if (o.type === 'section' && sectionMode === 'section-only') {
        release.push({ section: o, kids: this.store.sortedChildren(u).filter((k) => k.type !== 'connector') });
      } else {
        for (const d of this.store.descendants(u)) doomed.add(d);
      }
    }
    for (const id of Array.from(doomed)) for (const c of this.store.connectorsAttachedTo(id)) doomed.add(c);
    this.transact(() => {
      for (const { section, kids } of release) {
        const sib = this.siblingsIn(null);
        const i = sib.findIndex((s) => s.id === section.id);
        const hi = i >= 0 && i < sib.length - 1 ? sib[i + 1].z : null;
        const keys = zKeysBetween(section.z, hi, kids.length);
        kids.forEach((k, j) => {
          if (!doomed.has(k.id)) this.setFields(k.id, { parentId: null, z: keys[j] });
        });
      }
      for (const id of doomed) this.ymap.delete(id);
    });
    this.setSelection(this.selection.filter((id) => !doomed.has(id)));
  }

  // ------------------------------------------------------------------ style / props / lock

  setLocked(locked: boolean, ids = this.selection) {
    const units = this.normalizeUnits(ids);
    this.transact(() => {
      for (const id of units) this.setFields(id, { locked });
    });
  }

  setStyle(patch: Partial<Style>, ids = this.selection) {
    const targets = new Set<string>();
    for (const u of this.normalizeUnits(ids)) {
      if (this.isLocked(u)) continue;
      const o = this.store.get(u)!;
      if (o.type === 'group') for (const d of this.store.descendants(u)) targets.add(d);
      else targets.add(u);
    }
    this.transact(() => {
      for (const id of targets) {
        const o = this.store.get(id);
        if (!o || o.type === 'group') continue;
        const next: Record<string, unknown> = { ...o.style };
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === null) delete next[k];
          else next[k] = v;
        }
        this.setFields(id, { style: next });
      }
    });
  }

  copyStyle(id = this.selection[0]) {
    const o = this.store.get(id);
    if (o) this.styleClipboard = { ...o.style };
  }

  pasteStyle(ids = this.selection) {
    if (!this.styleClipboard) return;
    const s = this.styleClipboard;
    const targets = new Set<string>();
    for (const u of this.normalizeUnits(ids)) {
      if (this.isLocked(u)) continue;
      const o = this.store.get(u)!;
      if (o.type === 'group') for (const d of this.store.descendants(u)) targets.add(d);
      else targets.add(u);
    }
    this.transact(() => {
      for (const id of targets) if (this.store.get(id)?.type !== 'group') this.setFields(id, { style: { ...s } });
    });
  }

  hasStyleClipboard() {
    return this.styleClipboard !== null;
  }

  /** 修改任意欄位。`text` 傳入字串時以純文字覆寫富文本 */
  updateObject(id: string, patch: Record<string, unknown>) {
    const o = this.store.get(id);
    if (!o) return;
    const onlyLock = Object.keys(patch).every((k) => k === 'locked');
    if (this.isLocked(id) && !onlyLock) return;
    this.transact(() => {
      const m = this.ym(id)!;
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'id' || k === 'type') continue;
        if (k === 'text' && typeof v === 'string') {
          const f = m.get('text');
          if (f instanceof Y.XmlFragment) setPlainText(f, v);
          continue;
        }
        if (k === 'rotation' && NON_ROTATABLE.has(o.type)) continue;
        if (k === 'parentId' && o.type === 'connector') continue;
        rest[k] = v;
      }
      this.setFields(id, rest);
    });
  }

  /**
   * 以完整路線（含頭尾端點）設定連線的手動路線：移除重複與共線的點後記下中間的轉折點；
   * 少於兩個轉折點（沒有中間線段）時改回自動路由
   */
  setRoutePoints(id: string, points: Point[]) {
    const c = this.store.get(id);
    if (!c || c.type !== 'connector') return;
    const w = simplify(points).slice(1, -1);
    this.updateObject(id, { waypoints: w.length >= 2 ? w : [] });
  }

  /** 移除手動路線，恢復自動路由 */
  resetRoute(id: string) {
    const c = this.store.get(id);
    if (c?.type === 'connector' && c.waypoints.length) this.updateObject(id, { waypoints: [] });
  }

  // ------------------------------------------------------------------ align / distribute

  private movableUnits(ids: string[]): BoardObject[] {
    return this.normalizeUnits(ids)
      .map((id) => this.store.get(id)!)
      .filter((o) => o.type !== 'connector' && !this.isLocked(o.id));
  }

  align(kind: AlignKind, ids = this.selection) {
    const units = this.movableUnits(ids);
    if (units.length < 2) return;
    const rects = units.map((o) => rotatedAabb(o));
    const b = unionRects(rects)!;
    const plan = new Map<string, GeomPatch>();
    units.forEach((o, i) => {
      const r = rects[i];
      let dx = 0;
      let dy = 0;
      if (kind === 'left') dx = b.x - r.x;
      if (kind === 'right') dx = b.x + b.w - (r.x + r.w);
      if (kind === 'hcenter') dx = b.x + b.w / 2 - (r.x + r.w / 2);
      if (kind === 'top') dy = b.y - r.y;
      if (kind === 'bottom') dy = b.y + b.h - (r.y + r.h);
      if (kind === 'vcenter') dy = b.y + b.h / 2 - (r.y + r.h / 2);
      if (dx || dy) for (const [k, v] of this.planMove([o.id], dx, dy)) plan.set(k, v);
    });
    if (plan.size) this.transact(() => this.applyPlan(plan));
  }

  distribute(axis: 'h' | 'v', ids = this.selection) {
    const units = this.movableUnits(ids);
    if (units.length < 3) return;
    const items = units.map((o) => ({ o, r: rotatedAabb(o) }));
    const pos = (r: Rect) => (axis === 'h' ? r.x : r.y);
    const size = (r: Rect) => (axis === 'h' ? r.w : r.h);
    items.sort((a, b) => pos(a.r) + size(a.r) / 2 - (pos(b.r) + size(b.r) / 2));
    const first = items[0].r;
    const last = items[items.length - 1].r;
    const span = pos(last) + size(last) - pos(first);
    const total = items.reduce((s, it) => s + size(it.r), 0);
    const gap = (span - total) / (items.length - 1);
    let cursor = pos(first);
    const plan = new Map<string, GeomPatch>();
    for (const it of items) {
      const d = cursor - pos(it.r);
      if (Math.abs(d) > 1e-6) for (const [k, v] of this.planMove([it.o.id], axis === 'h' ? d : 0, axis === 'v' ? d : 0)) plan.set(k, v);
      cursor += size(it.r) + gap;
    }
    if (plan.size) this.transact(() => this.applyPlan(plan));
  }

  // ------------------------------------------------------------------ rotate / resize

  /** 可旋轉：單位與所有子孫都不是線框圖、區塊、表格、連線 */
  canRotate(ids = this.selection): boolean {
    const units = this.normalizeUnits(ids);
    if (!units.length) return false;
    for (const u of units) {
      if (this.isLocked(u)) return false;
      for (const id of [u, ...this.store.descendants(u)]) {
        const o = this.store.get(id);
        if (o && NON_ROTATABLE.has(o.type)) return false;
      }
    }
    return true;
  }

  /** 群組或多選內有任何旋轉過的物件（含巢狀）時，只能等比縮放 */
  mustScaleProportionally(ids = this.selection): boolean {
    const units = this.normalizeUnits(ids);
    if (units.length === 1) {
      const o = this.store.get(units[0])!;
      if (o.type !== 'group') return o.type === 'image' || o.type === 'icon';
    }
    for (const u of units) {
      for (const id of [u, ...this.store.descendants(u)]) {
        const o = this.store.get(id);
        if (o && o.type !== 'group' && o.rotation !== 0) return true;
      }
    }
    return false;
  }

  /**
   * 旋轉單位（角度增量）。單一非群組物件繞自身中心；群組或多選時繞整體中心，
   * 直接改寫每個子孫物件的位置與 rotation（群組本身 rotation 恆為 0）。
   */
  planRotate(ids: string[], delta: number, center?: Point): Map<string, GeomPatch> {
    const out = new Map<string, GeomPatch>();
    const units = this.normalizeUnits(ids).filter((id) => !this.isLocked(id));
    if (!units.length || !this.canRotate(units)) return out;
    if (units.length === 1 && this.store.get(units[0])!.type !== 'group') {
      const o = this.store.get(units[0])!;
      out.set(o.id, { rotation: norm360(o.rotation + delta) });
      return out;
    }
    const c = center ?? rectCenter(this.selectionBounds(units)!);
    for (const u of units) {
      for (const id of [u, ...this.store.descendants(u)]) {
        const o = this.store.get(id)!;
        if (o.type === 'group' || o.type === 'connector') continue;
        const oc = rotatePoint(rectCenter(o), c, delta);
        out.set(id, { x: oc.x - o.w / 2, y: oc.y - o.h / 2, rotation: norm360(o.rotation + delta) });
      }
    }
    return out;
  }

  rotate(delta: number, ids = this.selection, center?: Point) {
    const plan = this.planRotate(ids, delta, center);
    if (plan.size) this.transact(() => this.applyPlan(plan));
  }

  /** 每個單位各自繞自身中心旋轉（例如圖示的「旋轉 90 度」按鈕），全部在同一個 transaction 內 */
  rotateEach(delta: number, ids = this.selection) {
    const plan = new Map<string, GeomPatch>();
    for (const u of this.normalizeUnits(ids)) for (const [id, p] of this.planRotate([u], delta)) plan.set(id, p);
    if (plan.size) this.transact(() => this.applyPlan(plan));
  }

  /**
   * 把選取從 from 框縮放到 to 框。群組：子孫依比例縮放；區塊：只改區塊本身；
   * 旋轉過的物件只做等比縮放（呼叫端須保證 sx = sy，見 mustScaleProportionally）。
   */
  planResize(ids: string[], from: Rect, to: Rect): Map<string, GeomPatch> {
    const out = new Map<string, GeomPatch>();
    const units = this.normalizeUnits(ids).filter((id) => !this.isLocked(id));
    const sx = from.w > 0 ? to.w / from.w : 1;
    const sy = from.h > 0 ? to.h / from.h : 1;
    const mapX = (x: number) => to.x + (x - from.x) * sx;
    const mapY = (y: number) => to.y + (y - from.y) * sy;
    const mapLeaf = (o: BoardObject) => {
      if (o.type === 'connector') return;
      if (o.rotation) {
        const s = Math.sqrt(Math.abs(sx * sy));
        const c = rectCenter(o);
        const nc = { x: mapX(c.x), y: mapY(c.y) };
        out.set(o.id, { x: nc.x - (o.w * s) / 2, y: nc.y - (o.h * s) / 2, w: o.w * s, h: o.h * s });
        return;
      }
      const p: GeomPatch = { x: mapX(o.x), y: mapY(o.y), w: Math.max(1, o.w * sx), h: Math.max(1, o.h * sy) };
      if (o.type === 'text' && Math.abs(sx - 1) > 1e-6) p.fixedWidth = true;
      if (o.type === 'table') {
        p.columns = o.columns.map((c) => ({ ...c, width: Math.max(TABLE_MIN_COL, c.width * sx) }));
        p.rows = o.rows.map((r) => ({ ...r, height: Math.max(TABLE_MIN_ROW, r.height * sy) }));
        p.w = p.columns.reduce((a, c) => a + c.width, 0);
        p.h = p.rows.reduce((a, r) => a + r.height, 0);
      }
      out.set(o.id, p);
    };
    for (const u of units) {
      const o = this.store.get(u)!;
      if (o.type === 'connector') {
        const p: GeomPatch = {};
        if (!o.from.objectId) p.from = { ...o.from, x: mapX(o.from.x ?? 0), y: mapY(o.from.y ?? 0) };
        if (!o.to.objectId) p.to = { ...o.to, x: mapX(o.to.x ?? 0), y: mapY(o.to.y ?? 0) };
        if (p.from || p.to) out.set(u, p);
      } else if (o.type === 'group') {
        for (const d of this.store.descendants(u)) {
          const dob = this.store.get(d)!;
          if (dob.type !== 'group') mapLeaf(dob);
        }
      } else {
        // 區塊只改自己；其他物件依比例
        mapLeaf(o);
      }
    }
    return out;
  }

  resize(from: Rect, to: Rect, ids = this.selection) {
    const plan = this.planResize(ids, from, to);
    if (plan.size) this.transact(() => this.applyPlan(plan));
  }

  /** 直接設定單一物件的框（互動縮放單一物件時使用） */
  setRect(id: string, r: Rect, extra: Record<string, unknown> = {}) {
    if (this.isLocked(id)) return;
    this.transact(() => this.setFields(id, { x: r.x, y: r.y, w: r.w, h: r.h, ...extra }));
  }

  // ------------------------------------------------------------------ connectors

  /** 建立連線 */
  connect(from: ConnectorEnd, to: ConnectorEnd, extra: Partial<NewObjectInput> = {}): string {
    const pts = [from, to].map((e) => {
      const o = e.objectId ? this.store.get(e.objectId) : undefined;
      return o ? rectCenter(o) : { x: e.x ?? 0, y: e.y ?? 0 };
    });
    const b = unionRects(pts.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!;
    return this.insert({ type: 'connector', x: b.x, y: b.y, w: Math.max(1, b.w), h: Math.max(1, b.h), from, to, ...extra }, { select: false });
  }

  /** 以來源物件的樣式與尺寸建立新形狀並連線；方向決定位置。一個 transaction。回傳新形狀 id */
  createConnectedShape(fromId: string, side: AnchorSide, kind: ShapeKind | null, at?: Point, fromAnchor: Anchor = side): string | null {
    const src = this.store.get(fromId);
    if (!src || this.readOnly) return null;
    const shapeKind: ShapeKind = kind ?? (src.type === 'shape' ? src.shapeKind : 'rectangle');
    const size = kind && (src.type !== 'shape' || src.shapeKind !== kind) ? defaultShapeSize(kind) : { w: src.w, h: src.h };
    // 延伸出的形狀與來源外觀相同（含舊形狀沒有存線條粗細時的實際粗細）
    const style = src.type === 'shape' ? { ...src.style, strokeWidth: resolveStyle(src).strokeWidth } : {};
    let x: number;
    let y: number;
    if (at) {
      // 讓新形狀面對來源的那一邊落在 at
      const d = SIDE_DIR[side];
      x = at.x - size.w / 2 + (d.x * size.w) / 2;
      y = at.y - size.h / 2 + (d.y * size.h) / 2;
    } else {
      const gap = 80;
      const sb = rotatedAabb(src);
      const d = SIDE_DIR[side];
      const cx = sb.x + sb.w / 2 + d.x * (sb.w / 2 + gap + size.w / 2);
      const cy = sb.y + sb.h / 2 + d.y * (sb.h / 2 + gap + size.h / 2);
      x = cx - size.w / 2;
      y = cy - size.h / 2;
      // 被佔用時往垂直方向找空位
      const step = d.x !== 0 ? size.h + 40 : size.w + 40;
      for (let i = 1; i <= 12; i++) {
        const r = { x, y, w: size.w, h: size.h };
        const hit = this.store.query(r).some((it) => {
          if (it.connector) return false;
          const o = this.store.get(it.id);
          return !!o && o.type !== 'section' && o.type !== 'group' && intersects(rotatedAabb(o), r);
        });
        if (!hit) break;
        const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
        x = cx - size.w / 2 + (d.x === 0 ? k * step : 0);
        y = cy - size.h / 2 + (d.y === 0 ? k * step : 0);
      }
    }
    x = snap(x, GRID_SIZE);
    y = snap(y, GRID_SIZE);
    const id = newId();
    this.transact(() => {
      this.insertInTx({ type: 'shape', id, x, y, w: size.w, h: size.h, shapeKind, style });
      const pts = [rectCenter(src), { x: x + size.w / 2, y: y + size.h / 2 }];
      const b = unionRects(pts.map((p) => ({ ...p, w: 0, h: 0 })))!;
      this.insertInTx({
        type: 'connector',
        x: b.x,
        y: b.y,
        w: Math.max(1, b.w),
        h: Math.max(1, b.h),
        from: { objectId: fromId, anchor: fromAnchor },
        to: { objectId: id, anchor: OPPOSITE[side] },
      });
    });
    this.setSelection([id]);
    return id;
  }

  /** Mod+Alt+方向鍵：從單一選取的物件朝該方向延伸並自動連線（見 SPEC.md 第 3.7 節） */
  extend(direction: 'up' | 'down' | 'left' | 'right'): string | null {
    if (this.selection.length !== 1) return null;
    const src = this.store.get(this.selection[0]);
    if (!src || !isConnectable(src) || src.type === 'section') return null;
    const side: AnchorSide = direction === 'up' ? 'top' : direction === 'down' ? 'bottom' : direction;
    return this.createConnectedShape(src.id, side, null);
  }

  // ------------------------------------------------------------------ auto layout

  /** 以 ELK 排列選取的物件（與它們之間的連線），左上角維持在原處。一個 transaction */
  async autoLayout(direction: 'down' | 'right', ids = this.selection): Promise<void> {
    if (this.readOnly) return;
    const units = this.movableUnits(ids).filter((o) => o.type !== 'section');
    if (units.length < 2) return;
    const unitSet = new Set(units.map((o) => o.id));
    // 連線端點可能是單位的子孫，對應回單位
    const unitOf = new Map<string, string>();
    for (const u of units) for (const d of [u.id, ...this.store.descendants(u.id)]) unitOf.set(d, u.id);
    const edges: { id: string; from: string; to: string }[] = [];
    const edgeConns: ConnectorObject[] = [];
    for (const o of this.store.objects.values()) {
      if (o.type !== 'connector') continue;
      const a = o.from.objectId ? unitOf.get(o.from.objectId) : undefined;
      const b = o.to.objectId ? unitOf.get(o.to.objectId) : undefined;
      if (a && b && a !== b) {
        edges.push({ id: o.id, from: a, to: b });
        edgeConns.push(o);
      }
    }
    const rects = new Map(units.map((o) => [o.id, rotatedAabb(o)]));
    const origin = unionRects(rects.values())!;
    const { positions } = await layoutGraph({
      nodes: units.map((o) => ({ id: o.id, w: rects.get(o.id)!.w, h: rects.get(o.id)!.h })),
      edges,
      direction,
    });
    const plan = new Map<string, GeomPatch>();
    for (const o of units) {
      const p = positions[o.id];
      if (!p || !unitSet.has(o.id)) continue;
      const r = rects.get(o.id)!;
      const dx = snap(origin.x + p.x, GRID_SIZE) - r.x;
      const dy = snap(origin.y + p.y, GRID_SIZE) - r.y;
      for (const [k, v] of this.planMove([o.id], dx, dy)) plan.set(k, v);
    }
    const fromSide: AnchorSide = direction === 'down' ? 'bottom' : 'right';
    this.transact(() => {
      this.applyPlan(plan);
      for (const c of edgeConns) {
        if (!this.ymap.get(c.id)) continue;
        this.setFields(c.id, {
          from: { ...c.from, anchor: fromSide },
          to: { ...c.to, anchor: OPPOSITE[fromSide] },
        });
      }
    });
  }

  // ------------------------------------------------------------------ clipboard

  /** 序列化選取（含子孫，以及兩端都在選取內的連線）。沒有可複製的物件時回傳 null */
  /** 複製的範圍：單位、所有子孫，以及兩端都在範圍內的連線。依繪製順序 */
  copySet(ids = this.selection): string[] {
    const units = this.normalizeUnits(ids);
    const set = new Set<string>();
    for (const u of units) {
      set.add(u);
      for (const d of this.store.descendants(u)) set.add(d);
    }
    for (const o of this.store.objects.values()) {
      if (o.type !== 'connector' || set.has(o.id)) continue;
      if (o.from.objectId && o.to.objectId && set.has(o.from.objectId) && set.has(o.to.objectId)) set.add(o.id);
    }
    return this.store.sortByOrder(Array.from(set));
  }

  /** 序列化選取，形狀內一起移動的物件（carriedUnits）也一併帶上，複本才會保留形狀裡的內容 */
  serialize(ids = this.selection): string | null {
    const units = this.normalizeUnits(ids);
    if (!units.length) return null;
    const carried = this.carriedUnits(units);
    const ordered = this.copySet([...units, ...carried]);
    // 兩端都在形狀內物件上的連線也屬於「一起帶上」的內容，貼上後同樣不選取
    const inside = new Set(carried.flatMap((u) => [u, ...this.store.descendants(u)]));
    for (const id of ordered) {
      const o = this.store.get(id);
      if (o?.type === 'connector' && o.from.objectId && o.to.objectId && inside.has(o.from.objectId) && inside.has(o.to.objectId)) carried.push(id);
    }
    const set = new Set(ordered);
    const objects: Record<string, SerializedValue>[] = [];
    for (const id of ordered) {
      const m = this.ym(id);
      const o = this.store.get(id);
      if (!m || !o) continue;
      const s = serializeObjectMap(m);
      s.id = id;
      if (o.type === 'connector') {
        // 端點物件不在剪貼簿內時，改成懸空端點（保留目前的位置）
        const [a, b] = resolveEnds(o, this.store.getter);
        if (o.from.objectId && !set.has(o.from.objectId)) s.from = { objectId: null, anchor: null, x: a.p.x, y: a.p.y };
        if (o.to.objectId && !set.has(o.to.objectId)) s.to = { objectId: null, anchor: null, x: b.p.x, y: b.p.y };
      }
      objects.push(s);
    }
    const bounds = this.selectionBounds(units) ?? { x: 0, y: 0, w: 0, h: 0 };
    const payload: ClipboardPayload = { kind: CLIPBOARD_MARKER, sourceDoc: String(this.doc.guid), objects, bounds, ...(carried.length ? { carried } : {}) };
    return JSON.stringify(payload);
  }

  /**
   * 貼上：所有物件取得新 id，parentId 與連線端點重新對應；不在剪貼簿內的容器改為頂層（再依中心點判定區塊）。
   * at：貼上後外接框的中心；省略時貼在原處並依連續貼上次數位移 16px。
   * 回傳並選取新的頂層 id（一起帶上的形狀內物件除外）
   */
  paste(data: string, opts: { at?: Point; offset?: number; delta?: Point } = {}): string[] {
    if (this.readOnly) return [];
    const payload = parsePayload(data);
    if (!payload || !payload.objects.length) return [];
    const key = data.length + ':' + data.slice(0, 200);
    if (key === this.lastPasteKey) this.pasteCount++;
    else {
      this.lastPasteKey = key;
      this.pasteCount = 1;
    }
    let dx: number;
    let dy: number;
    if (opts.delta) {
      dx = opts.delta.x;
      dy = opts.delta.y;
    } else if (opts.at) {
      dx = opts.at.x - (payload.bounds.x + payload.bounds.w / 2);
      dy = opts.at.y - (payload.bounds.y + payload.bounds.h / 2);
    } else {
      const off = opts.offset ?? 16 * this.pasteCount;
      dx = off;
      dy = off;
    }
    if (!opts.delta) {
      dx = snap(dx, GRID_SIZE) || (opts.at ? 0 : GRID_SIZE * 2);
      dy = snap(dy, GRID_SIZE) || (opts.at ? 0 : GRID_SIZE * 2);
    }
    const idMap = new Map<string, string>();
    for (const s of payload.objects) idMap.set(String(s.id), newId());
    const tops: string[] = [];
    // 每個容器內依原順序重新產生 z
    const byParent = new Map<string, Record<string, SerializedValue>[]>();
    const prepared: Record<string, SerializedValue>[] = [];
    for (const src of payload.objects) {
      const s: Record<string, SerializedValue> = { ...src };
      const newIdv = idMap.get(String(src.id))!;
      s.id = newIdv;
      const oldParent = typeof src.parentId === 'string' ? src.parentId : null;
      s.parentId = oldParent && idMap.has(oldParent) ? idMap.get(oldParent)! : null;
      if (s.type === 'connector') {
        s.parentId = null;
        for (const k of ['from', 'to'] as const) {
          const e = { ...(src[k] as any) } as ConnectorEnd;
          if (e.objectId && idMap.has(e.objectId)) e.objectId = idMap.get(e.objectId)!;
          else {
            e.objectId = null;
            e.x = (e.x ?? 0) + dx;
            e.y = (e.y ?? 0) + dy;
          }
          s[k] = e as unknown as SerializedValue;
        }
        // 手動路線跟著平移
        if (Array.isArray(src.waypoints)) s.waypoints = (src.waypoints as unknown as Point[]).map((w) => ({ x: w.x + dx, y: w.y + dy })) as unknown as SerializedValue;
      } else {
        s.x = num(src.x) + dx;
        s.y = num(src.y) + dy;
      }
      if (s.parentId === null) tops.push(newIdv);
      const pkey = s.type === 'connector' ? '\u0000c' : String(s.parentId ?? '\u0000root');
      if (!byParent.has(pkey)) byParent.set(pkey, []);
      byParent.get(pkey)!.push(s);
      prepared.push(s);
    }
    this.pasting = true;
    try {
      this.transact(() => {
        for (const [pkey, list] of byParent) {
          const isNew = pkey !== '\u0000c' && pkey !== '\u0000root';
          const lo = isNew ? null : pkey === '\u0000c' ? this.topZ(null, undefined, true) : this.topZ(null);
          const keys = zKeysBetween(lo, null, list.length);
          list.forEach((s, i) => (s.z = keys[i]));
        }
        for (const s of prepared) this.ymap.set(String(s.id), buildObjectMap(s));
        // 頂層物件依中心點判定是否落在區塊內
        for (const id of tops) {
          const m = this.ym(id)!;
          const t = m.get('type');
          if (t === 'connector' || t === 'section') continue;
          const r = rotatedAabb({ x: num(m.get('x')), y: num(m.get('y')), w: num(m.get('w'), 1), h: num(m.get('h'), 1), rotation: num(m.get('rotation')) });
          const sec = this.sectionAt(rectCenter(r));
          if (sec) m.set('parentId', sec.id);
        }
      });
    } finally {
      this.pasting = false;
    }
    const carried = new Set((payload.carried ?? []).map((id) => idMap.get(String(id))));
    const result = tops.filter((id) => !carried.has(id));
    this.setSelection(result);
    return result;
  }

  // ------------------------------------------------------------------ 放置複本（startPlacingDuplicate）

  /** 準備放置複本：序列化選取並記下目前的快照與外接框。不寫入文件。沒有可複製的物件時回傳 null */
  preparePlacement(ids = this.selection): Placement | null {
    const data = this.serialize(ids);
    if (!data) return null;
    const payload = parsePayload(data)!;
    const order = payload.objects.map((o) => String(o.id));
    const set = new Set(order);
    const objects: BoardObject[] = [];
    for (const id of order) {
      const o = this.store.get(id);
      if (!o) continue;
      if (o.type === 'connector') {
        // 端點不在複製範圍內：改成懸空端點（與 serialize 相同）
        const [a, b] = resolveEnds(o, this.store.getter);
        const from = o.from.objectId && !set.has(o.from.objectId) ? { objectId: null, anchor: null, x: a.p.x, y: a.p.y } : o.from;
        const to = o.to.objectId && !set.has(o.to.objectId) ? { objectId: null, anchor: null, x: b.p.x, y: b.p.y } : o.to;
        objects.push({ ...o, from, to });
      } else objects.push(o);
    }
    return { data, objects, bounds: payload.bounds };
  }

  /** 指標位置（世界座標）→ 複本外接框的左上角：吸附格線，alt 時不吸附 */
  placementTopLeft(pointer: Point, alt = false): Point {
    return alt ? { x: pointer.x, y: pointer.y } : { x: snap(pointer.x, GRID_SIZE), y: snap(pointer.y, GRID_SIZE) };
  }

  /** 外接框左上角放在 topLeft 時的預覽快照（暫時 id，parentId 與連線端點對應到暫時 id） */
  placementSnapshots(p: Placement, topLeft: Point): BoardObject[] {
    const dx = topLeft.x - p.bounds.x;
    const dy = topLeft.y - p.bounds.y;
    const ids = new Set(p.objects.map((o) => o.id));
    const tmp = (id: string) => PLACING_PREFIX + id;
    return p.objects.map((o) => {
      if (o.type === 'connector') {
        const end = (e: ConnectorEnd): ConnectorEnd =>
          e.objectId && ids.has(e.objectId) ? { ...e, objectId: tmp(e.objectId) } : { ...e, objectId: null, x: (e.x ?? 0) + dx, y: (e.y ?? 0) + dy };
        return { ...o, id: tmp(o.id), parentId: null, from: end(o.from), to: end(o.to), waypoints: o.waypoints.map((w) => ({ x: w.x + dx, y: w.y + dy })) };
      }
      return { ...o, id: tmp(o.id), x: o.x + dx, y: o.y + dy, parentId: o.parentId && ids.has(o.parentId) ? tmp(o.parentId) : null } as BoardObject;
    });
  }

  /** 把複本放在 topLeft（外接框左上角）。一個 transaction；頂層單位依中心點判定區塊；選取新的頂層物件 */
  commitPlacement(p: Placement, topLeft: Point): string[] {
    return this.paste(p.data, { delta: { x: topLeft.x - p.bounds.x, y: topLeft.y - p.bounds.y } });
  }

  duplicate(ids = this.selection): string[] {
    const data = this.serialize(ids);
    if (!data) return [];
    return this.paste(data, { offset: 16 });
  }

  /** 外部純文字貼上：建立文字物件 */
  pasteText(text: string, at: Point): string {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const longest = Math.max(...lines.map((l) => l.length));
    const w = Math.min(480, Math.max(40, longest * 8));
    const id = this.insert({
      type: 'text',
      x: snap(at.x - w / 2, GRID_SIZE),
      y: snap(at.y - 12, GRID_SIZE),
      w,
      h: 20 * lines.length,
      text: lines.join('\n'),
      fixedWidth: longest > 60,
    });
    return id;
  }

  // ------------------------------------------------------------------ wireframe

  /** 修改線框圖元件的 props（例如 checked、active），一個 transaction */
  setWireframeProps(id: string, patch: Record<string, unknown>) {
    const m = this.ym(id);
    if (!m || m.get('type') !== 'wireframe' || this.isLocked(id)) return;
    this.transact(() => {
      let props = m.get('props');
      if (!(props instanceof Y.Map)) {
        props = new Y.Map();
        m.set('props', props);
      }
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) props.delete(k);
        else props.set(k, v);
      }
    });
  }

  // ------------------------------------------------------------------ table（以 id 定位列與欄，見 SPEC.md 第 8.2 節）

  private tableParts(id: string) {
    const m = this.ym(id);
    if (!m || m.get('type') !== 'table' || this.isLocked(id)) return null;
    const cols = m.get('columns');
    const rows = m.get('rows');
    const cells = m.get('cells');
    if (!(cols instanceof Y.Array) || !(rows instanceof Y.Array) || !(cells instanceof Y.Map)) return null;
    return { m, cols: cols as Y.Array<{ id: string; width: number }>, rows: rows as Y.Array<{ id: string; height: number }>, cells: cells as Y.Map<Y.XmlFragment> };
  }

  private syncTableSize(t: NonNullable<ReturnType<EditorModel['tableParts']>>) {
    const w = t.cols.toArray().reduce((s, c) => s + c.width, 0);
    const h = t.rows.toArray().reduce((s, r) => s + r.height, 0);
    t.m.set('w', Math.max(1, w));
    t.m.set('h', Math.max(1, h));
  }

  /** 在 refRowId 的上方或下方插入一列；回傳新列 id */
  tableInsertRow(id: string, refRowId: string, where: 'above' | 'below'): string | null {
    const t = this.tableParts(id);
    if (!t) return null;
    const rows = t.rows.toArray();
    const i = rows.findIndex((r) => r.id === refRowId);
    const at = i < 0 ? rows.length : where === 'above' ? i : i + 1;
    const rid = newId();
    const height = rows[i]?.height ?? 40;
    this.transact(() => {
      t.rows.insert(at, [{ id: rid, height }]);
      for (const c of t.cols.toArray()) t.cells.set(`${rid}:${c.id}`, emptyFragment());
      this.syncTableSize(t);
    });
    return rid;
  }

  tableInsertColumn(id: string, refColId: string, where: 'left' | 'right'): string | null {
    const t = this.tableParts(id);
    if (!t) return null;
    const cols = t.cols.toArray();
    const i = cols.findIndex((c) => c.id === refColId);
    const at = i < 0 ? cols.length : where === 'left' ? i : i + 1;
    const cid = newId();
    const width = cols[i]?.width ?? 120;
    this.transact(() => {
      t.cols.insert(at, [{ id: cid, width }]);
      for (const r of t.rows.toArray()) t.cells.set(`${r.id}:${cid}`, emptyFragment());
      this.syncTableSize(t);
    });
    return cid;
  }

  tableDeleteRow(id: string, rowId: string) {
    const t = this.tableParts(id);
    if (!t || t.rows.length <= 1) return;
    const i = t.rows.toArray().findIndex((r) => r.id === rowId);
    if (i < 0) return;
    this.transact(() => {
      t.rows.delete(i, 1);
      for (const c of t.cols.toArray()) t.cells.delete(`${rowId}:${c.id}`);
      this.syncTableSize(t);
    });
  }

  tableDeleteColumn(id: string, colId: string) {
    const t = this.tableParts(id);
    if (!t || t.cols.length <= 1) return;
    const i = t.cols.toArray().findIndex((c) => c.id === colId);
    if (i < 0) return;
    this.transact(() => {
      t.cols.delete(i, 1);
      for (const r of t.rows.toArray()) t.cells.delete(`${r.id}:${colId}`);
      this.syncTableSize(t);
    });
  }

  /** 只在需要時替換 Y.Array 內的元素（欄寬、列高），並同步表格的 w/h。呼叫端負責 transaction */
  setTableDims(id: string, colWidths: Map<string, number> | null, rowHeights: Map<string, number> | null) {
    const t = this.tableParts(id);
    if (!t) return;
    const replace = <T extends { id: string }>(arr: Y.Array<T>, map: Map<string, number> | null, key: 'width' | 'height') => {
      if (!map) return;
      const list = arr.toArray();
      list.forEach((item, i) => {
        const v = map.get(item.id);
        if (v === undefined || Math.abs((item as any)[key] - v) < 0.01) return;
        arr.delete(i, 1);
        arr.insert(i, [{ ...item, [key]: v }]);
      });
    };
    replace(t.cols, colWidths, 'width');
    replace(t.rows, rowHeights, 'height');
    this.syncTableSize(t);
  }

  setTableColumnWidth(id: string, colId: string, width: number) {
    this.transact(() => this.setTableDims(id, new Map([[colId, Math.max(TABLE_MIN_COL, width)]]), null));
  }

  setTableRowHeight(id: string, rowId: string, height: number) {
    const need = this.computeTableRowHeights([id], true).get(id)?.get(rowId) ?? 0;
    this.transact(() => this.setTableDims(id, null, new Map([[rowId, Math.max(TABLE_MIN_ROW, need, height)]])));
  }

  /** 儲存格不存在時建立（兩個分頁同時增加列與欄後可能缺少交叉的儲存格）。回傳是否建立 */
  ensureCell(id: string, cellKey: string): boolean {
    const t = this.tableParts(id);
    if (!t || t.cells.get(cellKey) instanceof Y.XmlFragment) return false;
    const [r, c] = cellKey.split(':');
    if (!t.rows.toArray().some((x) => x.id === r) || !t.cols.toArray().some((x) => x.id === c)) return false;
    this.transact(() => t.cells.set(cellKey, emptyFragment()));
    return true;
  }

  /**
   * 列高隨內容增長：每列取該列儲存格文字需要的最大高度。
   * all=false 時只回傳需要變大的列；all=true 時回傳每列的最小需要高度。
   */
  computeTableRowHeights(ids: string[], all = false): Map<string, Map<string, number>> {
    const out = new Map<string, Map<string, number>>();
    if (!this.measurer) return out;
    for (const id of ids) {
      const o = this.store.get(id) as TableObject | undefined;
      if (!o || o.type !== 'table') continue;
      const st = resolveStyle(o);
      const rows = new Map<string, number>();
      o.rows.forEach((r, ri) => {
        let need = TABLE_MIN_ROW;
        for (const c of o.columns) {
          const blocks = o.cells[`${r.id}:${c.id}`];
          if (!blocks) continue;
          const lay = layoutRichText(blocks, { maxWidth: Math.max(1, c.width - 2 * TABLE_CELL_PAD), fontSize: st.fontSize, fontWeight: o.headerRow && ri === 0 ? 700 : st.fontWeight }, this.measurer!);
          need = Math.max(need, Math.ceil(lay.height + 2 * TABLE_CELL_PAD));
        }
        if (all || need > r.height + 0.5) rows.set(r.id, need);
      });
      if (rows.size) out.set(id, rows);
    }
    return out;
  }

  /** 表格中相對於 cellKey 移動 (dx, dy) 的儲存格；超出邊界時換行（Tab 的行為）。最後一格之後回傳 null */
  neighborCell(id: string, cellKey: string, dx: number, dy: number): string | null {
    const o = this.store.get(id) as TableObject | undefined;
    if (!o || o.type !== 'table' || !o.rows.length || !o.columns.length) return null;
    const [r, c] = cellKey.split(':');
    let ri = Math.max(0, o.rows.findIndex((x) => x.id === r));
    let ci = Math.max(0, o.columns.findIndex((x) => x.id === c));
    const nc = o.columns.length;
    let idx = ri * nc + ci + dx + dy * nc;
    if (idx < 0 || idx >= o.rows.length * nc) return null;
    ri = Math.floor(idx / nc);
    ci = idx - ri * nc;
    idx = 0;
    return `${o.rows[ri].id}:${o.columns[ci].id}`;
  }

  // ------------------------------------------------------------------ 核取清單

  /** 物件的富文本 fragment：field 'text'（形狀、文字、線框圖）或 'cell'（表格儲存格） */
  richFragment(id: string, field: 'text' | 'cell', cellKey?: string): Y.XmlFragment | null {
    const m = this.ym(id);
    if (!m) return null;
    if (field === 'text') {
      const f = m.get('text');
      return f instanceof Y.XmlFragment ? f : null;
    }
    const cells = m.get('cells');
    const f = cellKey && cells instanceof Y.Map ? cells.get(cellKey) : null;
    return f instanceof Y.XmlFragment ? f : null;
  }

  /** 切換第 ordinal 個核取清單項目（taskItem 的 checked 屬性），一個 localOrigin transaction。回傳新的狀態 */
  toggleTask(id: string, field: 'text' | 'cell', cellKey: string | undefined, ordinal: number): boolean | null {
    if (this.readOnly || this.isLocked(id)) return null;
    const f = this.richFragment(id, field, cellKey);
    const item = f ? taskItems(f)[ordinal] : undefined;
    if (!item) return null;
    const next = !isTaskChecked(item);
    this.transact(() => item.setAttribute('checked', next as any));
    return next;
  }

  // ------------------------------------------------------------------ undo

  undo() {
    if (this.readOnly) return;
    this.undoManager.undo();
  }
  redo() {
    if (this.readOnly) return;
    this.undoManager.redo();
  }

  /** 方便呼叫端在手勢開始與結束時切斷合併（拖曳 = 一步） */
  stopCapturing() {
    this.undoManager.stopCapturing();
  }

  /** 連線可用的錨點（四邊中點） */
  anchorPoints(id: string) {
    const o = this.store.get(id);
    if (!isConnectable(o)) return [];
    return (['top', 'right', 'bottom', 'left'] as AnchorSide[]).map((s) => anchorPoint(o, s));
  }
}

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function textBoxWidth(o: BoardObject): number {
  if (o.type !== 'shape') return o.w;
  return shapeTextBox(o.shapeKind, 0, 0, o.w, o.h, shapeIcon(o, resolveStyle(o).fontSize)).w;
}
