import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { WIREFRAME_KINDS, getObjects, readObject, richTextToPlain, type WireframeObject } from '@tinycanvas/shared';
import { makeModel, mockMeasurer, rect, section, countTransactions } from './helpers';
import { drawObjects, getRenderer, type RenderContext } from '../src/render/draw';
import { TextLayoutCache } from '../src/render/text';
import { ImageCache } from '../src/render/images';
import { DEFAULT_LABELS } from '../src/types';
import { WIREFRAME_DEFAULTS, wireframeClick, wireframeDefaults, wireframeHasText } from '../src/render/wireframe';
import { tableCellAt, tableCellTextBox } from '../src/render/table';
import { EditorModel } from '../src/model';
import { FRAME_SIZES, sectionContentRect } from '../src/frames';
import { anchorPoint } from '../src/connectors/ends';

/** 什麼都不做、但記錄呼叫的 2D context */
function mockCtx() {
  const calls: string[] = [];
  const target: Record<string, unknown> = { measureText: (t: string) => ({ width: t.length * 7 }) };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k as string];
      return (..._a: unknown[]) => {
        calls.push(String(k));
      };
    },
    set(t, k, v) {
      t[k as string] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

beforeAll(() => {
  // node 沒有 Path2D：圖示與形狀路徑使用的替身
  (globalThis as any).Path2D ??= class {
    constructor() {
      return new Proxy(this, { get: (t: any, k) => (k in t ? t[k] : () => {}) });
    }
  };
});

function renderContext(model: EditorModel, zoom: number, editing: RenderContext['editing'] = null): RenderContext {
  return {
    zoom,
    get: model.store.getter,
    routes: model.routes,
    text: new TextLayoutCache(mockMeasurer, null),
    images: new ImageCache(undefined, () => {}),
    labels: DEFAULT_LABELS,
    editing,
    canOpenLinks: false,
    invalidate: () => {},
  };
}

describe('線框圖元件', () => {
  it('42 種元件都有預設尺寸，並可在各種縮放下繪製而不丟出例外', () => {
    expect(WIREFRAME_KINDS.length).toBe(42);
    const { model } = makeModel([], { measurer: mockMeasurer });
    for (const k of WIREFRAME_KINDS) {
      const d = WIREFRAME_DEFAULTS[k];
      expect(d, k).toBeTruthy();
      expect(d.w).toBeGreaterThan(0);
      expect(d.h).toBeGreaterThan(0);
      model.insert({ type: 'wireframe', componentKind: k, x: 0, y: 0, w: d.w, h: d.h }, { select: false });
    }
    const objs = Array.from(model.store.objects.values());
    expect(objs.length).toBe(42);
    for (const zoom of [1, 0.5, 0.2, 0.05]) {
      const { ctx, calls } = mockCtx();
      expect(() => drawObjects(ctx, objs, renderContext(model, zoom))).not.toThrow();
      expect(calls.length).toBeGreaterThan(0);
    }
  });

  it('插入時套用預設文字與 props；有主要文字的元件可以編輯', () => {
    const { model } = makeModel([]);
    const id = model.insert({ type: 'wireframe', componentKind: 'tabs', x: 0, y: 0, w: 320, h: 40 });
    const o = model.store.get(id) as WireframeObject;
    expect(o.props.items).toEqual(['分頁一', '分頁二', '分頁三']);
    const b = model.insert({ type: 'wireframe', componentKind: 'button', x: 0, y: 0, w: 120, h: 40 });
    expect((model.store.get(b) as WireframeObject).text[0].runs[0].text).toBe('按鈕');
    expect(wireframeHasText('button')).toBe(true);
    expect(wireframeHasText('slider')).toBe(false);
    const rc = renderContext(model, 1);
    expect(getRenderer('wireframe').getTextBox!(model.store.get(b), 'text', undefined, rc)).toEqual({ x: 8, y: 0, w: 104, h: 40 });
    // 預設值是複本，不共用
    wireframeDefaults('tabs').props.items = [];
    expect(WIREFRAME_DEFAULTS.tabs.props.items).toHaveLength(3);
  });

  it('點擊核取方塊切換 checked：一個 transaction、一步復原；點在文字上不切換', () => {
    const { doc, model } = makeModel([]);
    const id = model.insert({ type: 'wireframe', componentKind: 'checkbox', x: 100, y: 100, w: 140, h: 24 });
    model.stopCapturing();
    const o = model.store.get(id) as WireframeObject;
    expect(o.props.checked).toBe(true);
    expect(wireframeClick(o, { x: 60, y: 12 })).toBeNull();
    const patch = wireframeClick(o, { x: 8, y: 12 })!;
    expect(patch).toEqual({ checked: false });
    const tx = countTransactions(doc);
    const before = model.undoManager.undoStack.length;
    model.setWireframeProps(id, patch);
    tx.stop();
    expect(tx.list.length).toBe(1);
    expect((model.store.get(id) as WireframeObject).props.checked).toBe(false);
    expect(model.undoManager.undoStack.length).toBe(before + 1);
    model.undo();
    expect((model.store.get(id) as WireframeObject).props.checked).toBe(true);
  });

  it('分頁、評分、開關、手風琴的點擊', () => {
    const { model } = makeModel([]);
    const tabs = model.store.get(model.insert({ type: 'wireframe', componentKind: 'tabs', x: 0, y: 0, w: 300, h: 40 })) as WireframeObject;
    expect(wireframeClick(tabs, { x: 250, y: 20 })).toEqual({ active: 2 });
    const rating = model.store.get(model.insert({ type: 'wireframe', componentKind: 'rating', x: 0, y: 0, w: 120, h: 24 })) as WireframeObject;
    expect(wireframeClick(rating, { x: 110, y: 12 })).toEqual({ value: 5 });
    const sw = model.store.get(model.insert({ type: 'wireframe', componentKind: 'switch', x: 0, y: 0, w: 120, h: 24 })) as WireframeObject;
    expect(wireframeClick(sw, { x: 18, y: 12 })).toEqual({ checked: false });
    const acc = model.store.get(model.insert({ type: 'wireframe', componentKind: 'accordion', x: 0, y: 0, w: 280, h: 136 })) as WireframeObject;
    expect(wireframeClick(acc, { x: 100, y: 20 })).toEqual({ open: -1 });
  });

  it('線框圖元件不可旋轉', () => {
    const { model } = makeModel([]);
    const id = model.insert({ type: 'wireframe', componentKind: 'button', x: 0, y: 0, w: 120, h: 40 });
    expect(model.canRotate([id])).toBe(false);
  });
});

describe('裝置框', () => {
  it('預設尺寸與內容區；拖入以內容區判定（介面列上方不算）', () => {
    expect(FRAME_SIZES.phone).toEqual({ w: 375, h: 812 });
    expect(FRAME_SIZES.tablet).toEqual({ w: 768, h: 1024 });
    expect(FRAME_SIZES.browser).toEqual({ w: 1280, h: 800 });
    expect(FRAME_SIZES.window).toEqual({ w: 960, h: 640 });
    const { model } = makeModel([{ type: 'section', id: 'F', x: 0, y: 0, w: 1280, h: 800, frameKind: 'browser', title: '首頁' }, rect('a', 2000, 0)]);
    const c = sectionContentRect(model.store.get('F') as any);
    expect(c.y).toBe(76);
    model.moveUnits(['a'], -1900, 10); // 中心 y=40：在網址列上，不在內容區
    expect(model.store.get('a')!.parentId).toBeNull();
    model.moveUnits(['a'], 0, 100);
    expect(model.store.get('a')!.parentId).toBe('F');
  });

  it('裝置框的標題在外框上方，計入空間索引', () => {
    const { model } = makeModel([{ type: 'section', id: 'F', x: 0, y: 0, w: 375, h: 812, frameKind: 'phone', title: '登入頁' }]);
    expect(model.store.boundsOf('F')!.y).toBeLessThan(0);
    const rc = renderContext(model, 1);
    const tb = getRenderer('section').getTextBox!(model.store.get('F'), 'title', undefined, rc)!;
    expect(tb.y).toBeLessThan(0);
    const { ctx } = mockCtx();
    expect(() => drawObjects(ctx, [model.store.get('F')!], rc)).not.toThrow();
  });

  it('Wireflow：從裝置框內的元件連到另一個裝置框', () => {
    const { model } = makeModel([
      { type: 'section', id: 'A', x: 0, y: 0, w: 375, h: 812, frameKind: 'phone', title: 'A' },
      { type: 'section', id: 'B', x: 600, y: 0, w: 375, h: 812, frameKind: 'phone', title: 'B' },
    ]);
    const btn = model.insert({ type: 'wireframe', componentKind: 'button', x: 120, y: 400, w: 120, h: 40 });
    expect(model.store.get(btn)!.parentId).toBe('A');
    const c = model.connect({ objectId: btn, anchor: 'right' }, { objectId: 'B', anchor: 'left' });
    const route = model.routes.get(model.store.get(c) as any);
    expect(route.points[0]).toEqual(anchorPoint(model.store.get(btn)!, 'right').p);
    expect(route.points[route.points.length - 1]).toEqual({ x: 600, y: 406 });
    // 移動目標框：連線重新路由
    model.moveUnits(['B'], 0, 200);
    const r2 = model.routes.get(model.store.get(c) as any);
    expect(r2.points[r2.points.length - 1]).toEqual({ x: 600, y: 606 });
  });
});

describe('表格', () => {
  const table = (extra = {}) => ({
    type: 'table' as const,
    id: 't',
    x: 0,
    y: 0,
    w: 240,
    h: 80,
    columns: [
      { id: 'c1', width: 120 },
      { id: 'c2', width: 120 },
    ],
    rows: [
      { id: 'r1', height: 40 },
      { id: 'r2', height: 40 },
    ],
    cells: { 'r1:c1': '名稱', 'r1:c2': '數量', 'r2:c1': '蘋果', 'r2:c2': '3' },
    headerRow: true,
    ...extra,
  });

  it('兩個分頁同時增加列與欄：合併後一致，儲存格以 id 定位不會錯位，缺少的交叉儲存格可補上', () => {
    const { doc: a, model: ma } = makeModel([table()]);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const mb = new EditorModel({ doc: b });
    const newRow = ma.tableInsertRow('t', 'r1', 'below')!;
    const newCol = mb.tableInsertColumn('t', 'c1', 'right')!;
    mb.tableDeleteRow('t', 'r2');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    const ta = readObject(getObjects(a).get('t')!) as any;
    const tb = readObject(getObjects(b).get('t')!) as any;
    expect(ta.rows).toEqual(tb.rows);
    expect(ta.columns).toEqual(tb.columns);
    expect(ta.rows.map((r: any) => r.id)).toEqual(['r1', newRow]);
    expect(ta.columns.map((c: any) => c.id)).toEqual(['c1', newCol, 'c2']);
    // 原本的內容仍在原本的列與欄
    expect(ta.cells['r1:c1'][0].runs[0].text).toBe('名稱');
    expect(ta.cells['r1:c2'][0].runs[0].text).toBe('數量');
    // 新列 × 新欄的交叉儲存格在兩邊都不存在，編輯前補上
    expect(ta.cells[`${newRow}:${newCol}`]).toBeUndefined();
    expect(ma.ensureCell('t', `${newRow}:${newCol}`)).toBe(true);
    expect(ma.ensureCell('t', `${newRow}:${newCol}`)).toBe(false);
    expect(ma.ensureCell('t', `nope:${newCol}`)).toBe(false);
  });

  it('表頭列切換、欄寬與列高、縮放表格時欄寬列高依比例', () => {
    const { model } = makeModel([table()]);
    model.updateObject('t', { headerRow: false });
    expect((model.store.get('t') as any).headerRow).toBe(false);
    model.setTableColumnWidth('t', 'c1', 200);
    let t = model.store.get('t') as any;
    expect(t.columns[0].width).toBe(200);
    expect(t.w).toBe(320);
    model.setTableColumnWidth('t', 'c2', 5);
    expect((model.store.get('t') as any).columns[1].width).toBe(40);
    model.resize({ x: 0, y: 0, w: 240, h: 80 }, { x: 0, y: 0, w: 480, h: 160 }, ['t']);
    t = model.store.get('t') as any;
    expect(t.columns.map((c: any) => c.width)).toEqual([400, 80]);
    expect(t.rows.map((r: any) => r.height)).toEqual([80, 80]);
    expect(t.w).toBe(480);
    expect(t.h).toBe(160);
  });

  it('列高隨儲存格內容增長（本地文字變動後，與打字同一步復原）', () => {
    const key = { name: 'ySync' };
    const { doc, model } = makeModel([table()], { measurer: mockMeasurer, extraTrackedOrigins: [key] });
    doc.transact(() => {
      const f = (getObjects(doc).get('t')!.get('cells') as Y.Map<Y.XmlFragment>).get('r2:c1')!;
      const t = (f.get(0) as Y.XmlElement).get(0) as Y.XmlText;
      t.insert(2, '這是一段很長很長的文字，會換很多行，所以這一列要長高');
    }, key);
    const t = model.store.get('t') as any;
    expect(t.rows[1].height).toBeGreaterThan(40);
    expect(t.h).toBe(40 + t.rows[1].height);
    model.undo();
    expect((model.store.get('t') as any).rows[1].height).toBe(40);
  });

  it('儲存格的編輯文字框、命中與 Tab 導覽', () => {
    const { model } = makeModel([table({ x: 100, y: 50 })]);
    const o = model.store.get('t') as any;
    expect(tableCellTextBox(o, 'r2:c2')).toEqual({ x: 228, y: 98, w: 104, h: 24 });
    expect(getRenderer('table').getTextBox!(o, 'cell', 'r1:c1', renderContext(model, 1))).toEqual({ x: 108, y: 58, w: 104, h: 24 });
    expect(tableCellAt(o, { x: 250, y: 100 })).toBe('r2:c2');
    expect(model.neighborCell('t', 'r1:c1', 1, 0)).toBe('r1:c2');
    expect(model.neighborCell('t', 'r1:c2', 1, 0)).toBe('r2:c1');
    expect(model.neighborCell('t', 'r2:c1', -1, 0)).toBe('r1:c2');
    expect(model.neighborCell('t', 'r1:c1', -1, 0)).toBeNull();
    expect(model.neighborCell('t', 'r2:c2', 1, 0)).toBeNull();
    expect(model.neighborCell('t', 'r1:c2', 0, 1)).toBe('r2:c2');
  });

  it('表格與內容可以在各縮放下繪製；編輯中的儲存格不畫文字', () => {
    const { model } = makeModel([table()], { measurer: mockMeasurer });
    for (const zoom of [1, 0.1]) {
      const { ctx, calls } = mockCtx();
      drawObjects(ctx, [model.store.get('t')!], renderContext(model, zoom, { id: 't', field: 'cell', cellKey: 'r1:c1' }));
      expect(calls.length).toBeGreaterThan(0);
    }
    const a = mockCtx();
    drawObjects(a.ctx, [model.store.get('t')!], renderContext(model, 1));
    const b = mockCtx();
    drawObjects(b.ctx, [model.store.get('t')!], renderContext(model, 1, { id: 't', field: 'cell', cellKey: 'r1:c1' }));
    expect(b.calls.filter((c) => c === 'fillText').length).toBe(a.calls.filter((c) => c === 'fillText').length - 1);
  });
});

describe('裝置框內的區塊規則（補充）', () => {
  it('移動裝置框時內容一起移動；縮放裝置框不縮放內容', () => {
    const { doc, model } = makeModel([section('S', 0, 0, 400, 300, { frameKind: 'phone' }), rect('a', 20, 100, { parentId: 'S' })]);
    model.moveUnits(['S'], 50, 0);
    expect(readObject(getObjects(doc).get('a')!)!.x).toBe(70);
    const s = model.store.get('S')!;
    model.resize(s, { ...s, w: s.w * 2 }, ['S']);
    expect(model.store.get('a')!.w).toBe(100);
  });
});

describe('線框圖預設內容依介面語系', () => {
  const labels = {
    ...DEFAULT_LABELS,
    wireframe: {
      button: { text: 'Button' },
      tabs: { items: ['One', 'Two', 'Three'] },
      modal: { text: 'Title', body: 'Body', buttons: ['No', 'Yes'] },
    },
  };

  it('wireframeDefaults 以傳入內容覆寫文字與 props，保留其他 props', () => {
    expect(wireframeDefaults('button', { text: 'Go' }).text).toBe('Go');
    const tabs = wireframeDefaults('tabs', { items: ['A', 'B'] });
    expect(tabs.props).toEqual({ items: ['A', 'B'], active: 0 });
    expect(wireframeDefaults('tabs').props.items).toEqual(WIREFRAME_DEFAULTS.tabs.props.items);
  });

  it('覆寫內容是複本，修改不影響來源', () => {
    const content = { items: ['A', 'B'] };
    (wireframeDefaults('tabs', content).props.items as string[]).push('C');
    expect(content.items).toEqual(['A', 'B']);
  });

  it('插入元件時使用 labels.wireframe 的內容；未提供的元件沿用預設', () => {
    const doc = new Y.Doc();
    const model = new EditorModel({ doc, measurer: null, labels });
    const read = (id: string) => readObject(getObjects(doc).get(id)!) as WireframeObject;
    const b = read(model.insert({ type: 'wireframe', componentKind: 'button', x: 0, y: 0, w: 120, h: 40 }));
    expect(richTextToPlain(b.text)).toBe('Button');
    const t = read(model.insert({ type: 'wireframe', componentKind: 'tabs', x: 0, y: 0, w: 320, h: 40 }));
    expect(t.props.items).toEqual(['One', 'Two', 'Three']);
    const m = read(model.insert({ type: 'wireframe', componentKind: 'modal', x: 0, y: 0, w: 360, h: 220 }));
    expect(richTextToPlain(m.text)).toBe('Title');
    expect(m.props).toMatchObject({ body: 'Body', buttons: ['No', 'Yes'] });
    const c = read(model.insert({ type: 'wireframe', componentKind: 'card', x: 0, y: 0, w: 240, h: 200 }));
    expect(richTextToPlain(c.text)).toBe(WIREFRAME_DEFAULTS.card.text);
  });
});
