import * as Y from 'yjs';
import RBush from 'rbush';
import { compareZ, getObjects, readObject, type BoardObject, type ConnectorObject, type YObjects } from '@tinycanvas/shared';
import { rotatedAabb, type Rect } from './geometry';
import { connectorRegion } from './connectors/ends';
import { sectionBounds } from './frames';

export interface IndexItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
  connector: boolean;
}

export interface StoreChange {
  /** 這次變動（新增、修改、刪除）的物件 id */
  ids: Set<string>;
  /** 受影響的畫面範圍（世界座標）：變動物件的舊範圍與新範圍，以及受牽連而需重新路由的連線 */
  dirty: Rect[];
  /** 父子或 z 有變動，繪製順序需要重算 */
  structural: boolean;
  /** 變動前的 parentId（只含 ids 內原本存在的物件） */
  prevParents: Map<string, string | null>;
  /** 連線路由失效的連線 id */
  reroute: Set<string>;
  /** 每個物件變動的欄位（'*' 表示新增或刪除） */
  keys: Map<string, Set<string>>;
  transaction: Y.Transaction | null;
}

type Listener = (c: StoreChange) => void;

const isContainer = (o: BoardObject | undefined) => !!o && (o.type === 'group' || o.type === 'section');

/**
 * 畫布物件的純資料快照。以 observeDeep 增量更新，渲染迴圈只讀這裡，不讀 Y.Map。
 * 同時維護：父子索引、連線端點索引、R-tree 空間索引、繪製順序。
 */
export class SceneStore {
  readonly objects = new Map<string, BoardObject>();
  readonly ymap: YObjects;
  private readonly childrenOf = new Map<string | null, Set<string>>();
  private readonly connectorsByEnd = new Map<string, Set<string>>();
  readonly index = new RBush<IndexItem>(9);
  private readonly items = new Map<string, IndexItem>();
  private order: string[] = [];
  private orderIndex = new Map<string, number>();
  private orderDirty = true;
  /** 每次變動遞增；快取以它判斷是否過期 */
  version = 0;
  private listeners = new Set<Listener>();
  private readonly observer: (events: Y.YEvent<any>[], tr: Y.Transaction) => void;

  constructor(readonly doc: Y.Doc) {
    this.ymap = getObjects(doc);
    this.ymap.forEach((m, id) => {
      const o = readObject(m);
      if (o) this.objects.set(id, o.id === id ? o : { ...o, id });
    });
    for (const o of this.objects.values()) this.link(o);
    const items: IndexItem[] = [];
    for (const o of this.objects.values()) {
      const it = this.makeItem(o);
      this.items.set(o.id, it);
      items.push(it);
    }
    this.index.load(items);
    this.observer = (events, tr) => this.onEvents(events, tr);
    this.ymap.observeDeep(this.observer);
  }

  destroy() {
    this.ymap.unobserveDeep(this.observer);
    this.listeners.clear();
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  get(id: string | null | undefined): BoardObject | undefined {
    return id ? this.objects.get(id) : undefined;
  }

  readonly getter = (id: string) => this.objects.get(id);

  /** 直接子物件 id（未排序）。parentId 為 null 時回傳頂層物件 */
  children(parentId: string | null): string[] {
    const s = this.childrenOf.get(parentId);
    return s ? Array.from(s) : [];
  }

  /** 依 (z, id) 排序的直接子物件 */
  sortedChildren(parentId: string | null): BoardObject[] {
    const out: BoardObject[] = [];
    for (const id of this.children(parentId)) {
      const o = this.objects.get(id);
      if (o) out.push(o);
    }
    return out.sort(compareZ);
  }

  /** 所有子孫（不含自己），依繪製順序 */
  descendants(id: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of this.children(cur)) {
        if (seen.has(c)) continue;
        seen.add(c);
        out.push(c);
        stack.push(c);
      }
    }
    return out;
  }

  /** 由近到遠的祖先（只含存在的容器） */
  ancestors(id: string): BoardObject[] {
    const out: BoardObject[] = [];
    const seen = new Set<string>([id]);
    let p = this.objects.get(id)?.parentId ?? null;
    while (p && !seen.has(p)) {
      seen.add(p);
      const o = this.objects.get(p);
      if (!o) break;
      out.push(o);
      p = o.parentId;
    }
    return out;
  }

  /** 父物件存在且是容器時回傳它的 id，否則 null（視為頂層） */
  effectiveParent(o: BoardObject): string | null {
    if (o.type === 'connector') return null;
    const p = this.objects.get(o.parentId ?? '');
    return p && isContainer(p) ? p.id : null;
  }

  connectorsAttachedTo(id: string): string[] {
    const s = this.connectorsByEnd.get(id);
    return s ? Array.from(s) : [];
  }

  /** 物件在空間索引中的範圍（世界座標） */
  boundsOf(id: string): Rect | null {
    const it = this.items.get(id);
    return it ? { x: it.minX, y: it.minY, w: it.maxX - it.minX, h: it.maxY - it.minY } : null;
  }

  /** 與 rect 相交的物件 id（未排序） */
  query(rect: Rect): IndexItem[] {
    return this.index.search({ minX: rect.x, minY: rect.y, maxX: rect.x + rect.w, maxY: rect.y + rect.h });
  }

  /** 繪製順序：頂層非連線物件依 (z,id)，容器的子物件緊接在容器之後；所有連線最後依 (z,id) */
  getOrder(): string[] {
    if (this.orderDirty) this.computeOrder();
    return this.order;
  }

  orderOf(id: string): number {
    if (this.orderDirty) this.computeOrder();
    return this.orderIndex.get(id) ?? -1;
  }

  /** 依繪製順序排序（就地） */
  sortByOrder(ids: string[]): string[] {
    if (this.orderDirty) this.computeOrder();
    const oi = this.orderIndex;
    return ids.sort((a, b) => (oi.get(a) ?? 0) - (oi.get(b) ?? 0));
  }

  contentBounds(): Rect | null {
    if (this.objects.size === 0) return null;
    const d = this.index.toJSON() as { minX: number; minY: number; maxX: number; maxY: number };
    if (!Number.isFinite(d.minX)) return null;
    return { x: d.minX, y: d.minY, w: d.maxX - d.minX, h: d.maxY - d.minY };
  }

  private computeOrder() {
    const order: string[] = [];
    const visited = new Set<string>();
    const roots: BoardObject[] = [];
    const connectors: BoardObject[] = [];
    for (const o of this.objects.values()) {
      if (o.type === 'connector') connectors.push(o);
      else if (this.effectiveParent(o) === null) roots.push(o);
    }
    roots.sort(compareZ);
    const visit = (o: BoardObject) => {
      if (visited.has(o.id)) return;
      visited.add(o.id);
      order.push(o.id);
      if (!isContainer(o)) return;
      const kids = this.sortedChildren(o.id).filter((k) => k.type !== 'connector');
      for (const k of kids) visit(k);
    };
    for (const r of roots) visit(r);
    // 循環引用的物件（互為父子）不會從根走到，當作頂層補上
    if (visited.size + connectors.length < this.objects.size) {
      const rest = Array.from(this.objects.values()).filter((o) => o.type !== 'connector' && !visited.has(o.id));
      rest.sort(compareZ);
      for (const o of rest) visit(o);
    }
    connectors.sort(compareZ);
    for (const c of connectors) order.push(c.id);
    this.order = order;
    this.orderIndex = new Map(order.map((id, i) => [id, i]));
    this.orderDirty = false;
  }

  private makeItem(o: BoardObject): IndexItem {
    const r = o.type === 'connector' ? connectorRegion(o as ConnectorObject, this.getter) : o.type === 'section' ? sectionBounds(o) : rotatedAabb(o);
    return { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h, id: o.id, connector: o.type === 'connector' };
  }

  private addTo(map: Map<string | null, Set<string>> | Map<string, Set<string>>, key: any, id: string) {
    let s = map.get(key);
    if (!s) map.set(key, (s = new Set()));
    s.add(id);
  }
  private removeFrom(map: Map<any, Set<string>>, key: any, id: string) {
    const s = map.get(key);
    if (s) {
      s.delete(id);
      if (s.size === 0) map.delete(key);
    }
  }

  private link(o: BoardObject) {
    this.addTo(this.childrenOf, o.type === 'connector' ? null : o.parentId, o.id);
    if (o.type === 'connector') {
      if (o.from.objectId) this.addTo(this.connectorsByEnd, o.from.objectId, o.id);
      if (o.to.objectId) this.addTo(this.connectorsByEnd, o.to.objectId, o.id);
    }
  }
  private unlink(o: BoardObject) {
    this.removeFrom(this.childrenOf, o.type === 'connector' ? null : o.parentId, o.id);
    if (o.type === 'connector') {
      if (o.from.objectId) this.removeFrom(this.connectorsByEnd, o.from.objectId, o.id);
      if (o.to.objectId) this.removeFrom(this.connectorsByEnd, o.to.objectId, o.id);
    }
  }

  private reindex(id: string, dirty: Rect[]) {
    const old = this.items.get(id);
    if (old) {
      this.index.remove(old);
      this.items.delete(id);
      dirty.push({ x: old.minX, y: old.minY, w: old.maxX - old.minX, h: old.maxY - old.minY });
    }
    const o = this.objects.get(id);
    if (o) {
      const it = this.makeItem(o);
      this.items.set(id, it);
      this.index.insert(it);
      dirty.push({ x: it.minX, y: it.minY, w: it.maxX - it.minX, h: it.maxY - it.minY });
    }
  }

  private onEvents(events: Y.YEvent<any>[], tr: Y.Transaction) {
    const ids = new Set<string>();
    const keys = new Map<string, Set<string>>();
    const addKey = (id: string, k: string) => {
      let s = keys.get(id);
      if (!s) keys.set(id, (s = new Set()));
      s.add(k);
    };
    for (const ev of events) {
      if (ev.target === this.ymap) {
        for (const k of ev.changes.keys.keys()) {
          ids.add(k);
          addKey(k, '*');
        }
      } else if (ev.path.length === 0) {
        // 物件 Y.Map 本身的欄位變動（path 為空表示 target 是 objects 的直接子項）
        const id = (ev.target as any)._item?.parentSub;
        if (id) {
          ids.add(id);
          for (const k of (ev as Y.YMapEvent<any>).keysChanged ?? []) addKey(id, k);
        }
      } else {
        const id = String(ev.path[0]);
        ids.add(id);
        if (ev.path.length >= 2) addKey(id, String(ev.path[1]));
        else for (const k of (ev as Y.YMapEvent<any>).keysChanged ?? []) addKey(id, k);
      }
    }
    if (ids.size) this.apply(ids, tr, keys);
  }

  /** 重新讀取指定 id 並更新所有索引（也供測試直接呼叫） */
  apply(ids: Set<string>, tr: Y.Transaction | null = null, keys: Map<string, Set<string>> = new Map()) {
    const dirty: Rect[] = [];
    const prevParents = new Map<string, string | null>();
    const reroute = new Set<string>();
    let structural = false;
    const geomChanged: string[] = [];
    for (const id of ids) {
      const old = this.objects.get(id);
      const m = this.ymap.get(id);
      let next = m ? readObject(m) : null;
      if (next && next.id !== id) next = { ...next, id };
      if (old) prevParents.set(id, old.parentId);
      if (!old && !next) continue;
      if (
        !old ||
        !next ||
        old.parentId !== next.parentId ||
        old.z !== next.z ||
        old.type !== next.type
      )
        structural = true;
      if (old) this.unlink(old);
      if (next) {
        this.objects.set(id, next);
        this.link(next);
      } else this.objects.delete(id);
      if (
        !old ||
        !next ||
        old.x !== next.x ||
        old.y !== next.y ||
        old.w !== next.w ||
        old.h !== next.h ||
        old.rotation !== next.rotation ||
        next.type === 'connector'
      )
        geomChanged.push(id);
      if (next?.type === 'connector') reroute.add(id);
    }
    // 先更新所有非連線物件，再更新連線（連線範圍取決於端點物件）
    const touchedConnectors = new Set<string>();
    for (const id of ids) {
      const o = this.objects.get(id);
      if (o?.type === 'connector' || (!o && this.items.get(id)?.connector)) touchedConnectors.add(id);
      else this.reindex(id, dirty);
    }
    for (const id of geomChanged) {
      for (const c of this.connectorsAttachedTo(id)) touchedConnectors.add(c);
    }
    // 障礙物變動：範圍與變動物件相交的連線需要重新路由（範圍不變，但畫面要重畫）
    if (geomChanged.some((id) => this.objects.get(id)?.type !== 'connector')) {
      const rects = dirty.slice();
      for (const r of rects) {
        for (const it of this.query(r)) {
          if (it.connector && !reroute.has(it.id) && !touchedConnectors.has(it.id)) {
            reroute.add(it.id);
            dirty.push({ x: it.minX, y: it.minY, w: it.maxX - it.minX, h: it.maxY - it.minY });
          }
        }
      }
    }
    for (const c of touchedConnectors) {
      this.reindex(c, dirty);
      reroute.add(c);
    }
    if (structural) this.orderDirty = true;
    this.version++;
    const change: StoreChange = { ids, dirty, structural, prevParents, reroute, keys, transaction: tr };
    for (const l of this.listeners) l(change);
  }
}
