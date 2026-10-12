import * as Y from 'yjs';
import { generateKeyBetween } from 'fractional-indexing';
import type {
  BoardObject,
  ConnectorEnd,
  ObjectType,
  Style,
  TableColumn,
  TableRow,
  TextBlock,
} from './types';
import { OBJECT_TYPES } from './types';
import { emptyFragment, readRichText } from './richtext';

/** Y.Doc 內存放所有畫布物件的 map 名稱 */
export const OBJECTS_KEY = 'objects';

/**
 * 本分頁使用者操作的 transaction origin。UndoManager 只追蹤它（見 SPEC.md 第 3.5 節）。
 * 每個分頁各自載入一份模組，因此這個物件天然只代表「本分頁」。
 */
export const localOrigin = { name: 'tinycanvas-local' } as const;
/** 系統自動產生的寫入（例如回應遠端變更而重算群組外接框），不進入復原堆疊 */
export const systemOrigin = { name: 'tinycanvas-system' } as const;

export type YObject = Y.Map<any>;
export type YObjects = Y.Map<YObject>;

export function getObjects(doc: Y.Doc): YObjects {
  return doc.getMap<YObject>(OBJECTS_KEY);
}

let idCounter = 0;
/** 產生物件 id：時間 + 隨機，字典序大致依建立順序 */
export function newId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')
      : Math.random().toString(16).slice(2, 18);
  idCounter = (idCounter + 1) % 1296;
  return Date.now().toString(36) + idCounter.toString(36).padStart(2, '0') + rand;
}

export function isKnownType(t: unknown): t is ObjectType {
  return typeof t === 'string' && (OBJECT_TYPES as readonly string[]).includes(t);
}

/** z 分數索引：在 a 與 b 之間產生一個 key（任一可為 null） */
export function zBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    // 兩個分頁同時插入可能產生相同或顛倒的 key，退而產生 a 之後的 key
    return generateKeyBetween(a, null);
  }
  return generateKeyBetween(a, b);
}

/** 比較兩個物件的層級：先比 z，相同時以 id 字典序決定（見 SPEC.md 第 3.3 節） */
export function compareZ(a: { z: string; id: string }, b: { z: string; id: string }): number {
  if (a.z < b.z) return -1;
  if (a.z > b.z) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

function readFragment(m: YObject, key: string): TextBlock[] {
  const f = m.get(key);
  return f instanceof Y.XmlFragment ? readRichText(f) : [];
}

/** 把一個物件 Y.Map 讀成純資料快照。未知類型回傳 null，呼叫端應略過。 */
export function readObject(m: YObject): BoardObject | null {
  const type = m.get('type');
  if (!isKnownType(type)) return null;
  const base = {
    id: str(m.get('id')),
    x: num(m.get('x')),
    y: num(m.get('y')),
    w: num(m.get('w'), 1),
    h: num(m.get('h'), 1),
    rotation: num(m.get('rotation')),
    z: str(m.get('z'), 'a0'),
    parentId: (m.get('parentId') as string | null | undefined) ?? null,
    locked: Boolean(m.get('locked')),
    style: (m.get('style') as Style | undefined) ?? {},
  };
  switch (type) {
    case 'shape':
      return {
        ...base,
        type,
        shapeKind: m.get('shapeKind') ?? 'rectangle',
        icon: m.get('icon') ?? null,
        iconPosition: m.get('iconPosition') ?? 'top',
        autoHeight: m.get('autoHeight') !== false,
        text: readFragment(m, 'text'),
      };
    case 'text':
      return {
        ...base,
        type,
        variant: m.get('variant') === 'heading' ? 'heading' : 'body',
        fixedWidth: Boolean(m.get('fixedWidth')),
        text: readFragment(m, 'text'),
      };
    case 'connector':
      return {
        ...base,
        type,
        from: (m.get('from') as ConnectorEnd) ?? { objectId: null, anchor: null, x: 0, y: 0 },
        to: (m.get('to') as ConnectorEnd) ?? { objectId: null, anchor: null, x: 0, y: 0 },
        waypoints: m.get('waypoints') ?? [],
        label: str(m.get('label')),
        routing: m.get('routing') ?? 'orthogonal',
        startArrow: m.get('startArrow') ?? 'none',
        endArrow: m.get('endArrow') ?? 'arrow',
        dashed: Boolean(m.get('dashed')),
      };
    case 'wireframe': {
      const props = m.get('props');
      return {
        ...base,
        type,
        componentKind: m.get('componentKind') ?? 'button',
        props: props instanceof Y.Map ? props.toJSON() : {},
        text: readFragment(m, 'text'),
      };
    }
    case 'table': {
      const cellsMap = m.get('cells');
      const cells: Record<string, TextBlock[]> = {};
      if (cellsMap instanceof Y.Map) {
        cellsMap.forEach((v, k) => {
          if (v instanceof Y.XmlFragment) cells[k] = readRichText(v);
        });
      }
      const cols = m.get('columns');
      const rows = m.get('rows');
      return {
        ...base,
        type,
        columns: cols instanceof Y.Array ? (cols.toArray() as TableColumn[]) : [],
        rows: rows instanceof Y.Array ? (rows.toArray() as TableRow[]) : [],
        cells,
        headerRow: m.get('headerRow') !== false,
      };
    }
    case 'image':
      return {
        ...base,
        type,
        assetId: str(m.get('assetId')),
        naturalWidth: num(m.get('naturalWidth'), 1),
        naturalHeight: num(m.get('naturalHeight'), 1),
      };
    case 'link_card':
      return { ...base, type, targetFileId: str(m.get('targetFileId')), targetTitle: str(m.get('targetTitle')) };
    case 'section':
      return { ...base, type, title: str(m.get('title')), frameKind: m.get('frameKind') ?? null };
    case 'group':
      return { ...base, type, rotation: 0 };
    case 'icon':
      return { ...base, type, iconName: str(m.get('iconName'), 'Circle') };
  }
}

/** 建立新物件時可傳入的欄位：富文本欄位以純文字傳入，其他欄位與快照相同 */
export type NewObjectInput = {
  type: ObjectType;
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: string;
  rotation?: number;
  parentId?: string | null;
  locked?: boolean;
  style?: Style;
  /** 給有 text 欄位的類型（shape / text / wireframe）用；省略時建立空白段落 */
  text?: string;
  [key: string]: unknown;
};

/**
 * 建立一個尚未整合進文件的物件 Y.Map。呼叫端用 `getObjects(doc).set(id, map)` 放進文件。
 * 富文本欄位（text、table cells）建立成 Y.XmlFragment；wireframe 的 props 建立成 Y.Map；
 * table 的 columns / rows 建立成 Y.Array。
 */
export function createObjectMap(input: NewObjectInput): YObject {
  const id = input.id ?? newId();
  const m = new Y.Map<any>();
  const { text, cells, props, columns, rows, ...rest } = input as NewObjectInput & {
    cells?: Record<string, string>;
    props?: Record<string, unknown>;
    columns?: TableColumn[];
    rows?: TableRow[];
  };
  const fields: Record<string, unknown> = {
    rotation: 0,
    parentId: null,
    locked: false,
    style: {},
    z: 'a0',
    ...rest,
    id,
  };
  if (input.type === 'group' || input.type === 'section' || input.type === 'table' || input.type === 'connector') {
    fields.rotation = 0;
  }
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) m.set(k, v);

  if (input.type === 'shape' || input.type === 'text' || input.type === 'wireframe') {
    m.set('text', text ? fragmentFromPlain(text) : emptyFragment());
  }
  if (input.type === 'wireframe') {
    m.set('props', new Y.Map(Object.entries(props ?? {})));
  }
  if (input.type === 'table') {
    const cols = columns ?? [];
    const rs = rows ?? [];
    m.set('columns', Y.Array.from(cols));
    m.set('rows', Y.Array.from(rs));
    const cellMap = new Y.Map<Y.XmlFragment>();
    for (const r of rs) {
      for (const c of cols) {
        const key = `${r.id}:${c.id}`;
        const t = cells?.[key];
        cellMap.set(key, t ? fragmentFromPlain(t) : emptyFragment());
      }
    }
    m.set('cells', cellMap);
  }
  return m;
}

/** 建立含有純文字的預備 fragment（尚未整合進文件） */
export function fragmentFromPlain(text: string): Y.XmlFragment {
  const f = new Y.XmlFragment();
  const paragraphs = text.split(/\r?\n/).map((line) => {
    const p = new Y.XmlElement('paragraph');
    if (line) p.insert(0, [new Y.XmlText(line)]);
    return p;
  });
  f.insert(0, paragraphs);
  return f;
}

/** 讀出整份文件的所有已知類型物件 */
export function readAllObjects(doc: Y.Doc): BoardObject[] {
  const out: BoardObject[] = [];
  getObjects(doc).forEach((m) => {
    const o = readObject(m);
    if (o) out.push(o);
  });
  return out;
}

/** 以穩定排序的 key 序列化，供比較與雜湊使用 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .filter((k) => (value as any)[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + canonicalJson((value as any)[k]))
      .join(',') +
    '}'
  );
}

/** 單一物件 Y.Map 的正規化 JSON（富文本以 XML 字串表示） */
export function objectCanonical(m: YObject): string {
  return canonicalJson(m.toJSON());
}

/** 整份畫布內容的正規化 JSON；內容相同時結果相同，與 CRDT 歷史無關。用來算 content_hash */
export function docCanonical(doc: Y.Doc): string {
  const objs = getObjects(doc);
  const ids = Array.from(objs.keys()).sort();
  return '[' + ids.map((id) => JSON.stringify(id) + ':' + objectCanonical(objs.get(id)!)).join(',') + ']';
}
