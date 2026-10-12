import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createObjectMap,
  diffDocs,
  docCanonical,
  docFromState,
  extractAssetIds,
  extractSearchText,
  getObjects,
  localOrigin,
  readObject,
  readRichText,
  restoreFromDoc,
  setPlainText,
  compareZ,
  zBetween,
} from '../src';

function docWith(...inputs: Parameters<typeof createObjectMap>[0][]) {
  const doc = new Y.Doc();
  const objs = getObjects(doc);
  for (const i of inputs) objs.set(i.id!, createObjectMap(i));
  return doc;
}

describe('createObjectMap / readObject', () => {
  it('建立形狀並讀回快照', () => {
    const doc = docWith({ type: 'shape', id: 's1', x: 10, y: 20, w: 100, h: 50, shapeKind: 'diamond', text: '開始\n第二行' });
    const o = readObject(getObjects(doc).get('s1')!);
    expect(o).toMatchObject({ type: 'shape', id: 's1', x: 10, y: 20, shapeKind: 'diamond', parentId: null, rotation: 0 });
    expect(o!.type === 'shape' && o!.text.map((b) => b.runs.map((r) => r.text).join(''))).toEqual(['開始', '第二行']);
  });

  it('建立獨立圖示物件並讀回', () => {
    const doc = docWith({ type: 'icon', id: 'i', x: 0, y: 0, w: 48, h: 48, iconName: 'Database', style: { stroke: '#1f786d' } });
    expect(readObject(getObjects(doc).get('i')!)).toMatchObject({ type: 'icon', iconName: 'Database', style: { stroke: '#1f786d' } });
  });

  it('未知類型回傳 null，不會讓呼叫端崩潰', () => {
    const doc = new Y.Doc();
    const m = new Y.Map();
    getObjects(doc).set('x', m);
    m.set('type', 'sticky_note');
    expect(readObject(m)).toBeNull();
  });

  it('群組與區塊的 rotation 一律為 0', () => {
    const doc = docWith({ type: 'group', id: 'g', x: 0, y: 0, w: 1, h: 1, rotation: 45 });
    expect(readObject(getObjects(doc).get('g')!)!.rotation).toBe(0);
  });

  it('表格以列與欄的 id 建立儲存格', () => {
    const doc = docWith({
      type: 'table',
      id: 't',
      x: 0,
      y: 0,
      w: 200,
      h: 80,
      columns: [{ id: 'c1', width: 100 }, { id: 'c2', width: 100 }],
      rows: [{ id: 'r1', height: 40 }, { id: 'r2', height: 40 }],
      cells: { 'r1:c2': '名稱' },
    });
    const t = readObject(getObjects(doc).get('t')!);
    expect(t!.type).toBe('table');
    if (!t || t.type !== 'table') return;
    expect(Object.keys(t.cells).sort()).toEqual(['r1:c1', 'r1:c2', 'r2:c1', 'r2:c2']);
    expect(t.cells['r1:c2'][0].runs[0].text).toBe('名稱');
  });
});

describe('富文本', () => {
  it('讀出粗體、斜體、連結、標題與列點', () => {
    const doc = new Y.Doc();
    const f = doc.getXmlFragment('f');
    const h = new Y.XmlElement('heading');
    h.setAttribute('level', '2' as any);
    const list = new Y.XmlElement('bulletList');
    f.insert(0, [h, list]);
    const ht = new Y.XmlText();
    h.insert(0, [ht]);
    ht.insert(0, '標題');
    const li = new Y.XmlElement('listItem');
    list.insert(0, [li]);
    const p = new Y.XmlElement('paragraph');
    li.insert(0, [p]);
    const t = new Y.XmlText();
    p.insert(0, [t]);
    t.insert(0, '粗體', { bold: {} });
    t.insert(2, '連結', { link: { href: 'https://example.com' } });
    t.insert(4, '斜', { italic: {} });

    const blocks = readRichText(f);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 2, runs: [{ text: '標題' }] });
    expect(blocks[1].kind).toBe('bullet');
    expect(blocks[1].runs).toEqual([
      { text: '粗體', bold: true },
      { text: '連結', link: 'https://example.com' },
      { text: '斜', italic: true },
    ]);
  });

  it('setPlainText 覆寫內容', () => {
    const doc = new Y.Doc();
    const f = doc.getXmlFragment('f');
    setPlainText(f, 'a\nb');
    setPlainText(f, '甲');
    expect(readRichText(f).map((b) => b.runs.map((r) => r.text).join(''))).toEqual(['甲']);
  });
});

describe('搜尋文字與圖片引用', () => {
  it('抽出形狀、區塊標題、連線標籤、表格儲存格的文字', () => {
    const doc = docWith(
      { type: 'shape', id: 'a', x: 0, y: 0, w: 1, h: 1, text: '流程開始' },
      { type: 'section', id: 's', x: 0, y: 0, w: 1, h: 1, title: '泳道一' },
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, label: '是' },
      {
        type: 'table',
        id: 't',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        columns: [{ id: 'c', width: 1 }],
        rows: [{ id: 'r', height: 1 }],
        cells: { 'r:c': '儲存格' },
      },
    );
    const text = extractSearchText(doc);
    for (const s of ['流程開始', '泳道一', '是', '儲存格']) expect(text).toContain(s);
  });

  it('只抽出 image 物件的合法 assetId', () => {
    const id = '0b7c6c2e-6a8f-4b7e-9f55-0c1d2e3f4a5b';
    const doc = docWith(
      { type: 'image', id: 'i1', x: 0, y: 0, w: 1, h: 1, assetId: id },
      { type: 'image', id: 'i2', x: 0, y: 0, w: 1, h: 1, assetId: id },
      { type: 'image', id: 'i3', x: 0, y: 0, w: 1, h: 1, assetId: 'not-a-uuid' },
    );
    expect(extractAssetIds(doc)).toEqual([id]);
  });
});

describe('z 順序', () => {
  it('相同 z 時以 id 決定先後', () => {
    expect(compareZ({ z: 'a1', id: 'b' }, { z: 'a1', id: 'a' })).toBeGreaterThan(0);
    expect(compareZ({ z: 'a0', id: 'z' }, { z: 'a1', id: 'a' })).toBeLessThan(0);
  });
  it('zBetween 在 key 顛倒時不拋錯', () => {
    expect(zBetween('a2', 'a1') > 'a2').toBe(true);
    const k = zBetween('a0', 'a1');
    expect(k > 'a0' && k < 'a1').toBe(true);
  });
});

describe('版本還原（SPEC 5.5）', () => {
  it('以差異套用，結果與舊版本內容相同，並且一次 undo 就能復原', () => {
    const current = docWith(
      { type: 'shape', id: 'keep', x: 0, y: 0, w: 10, h: 10, text: '不變' },
      { type: 'shape', id: 'mod', x: 0, y: 0, w: 10, h: 10, text: '舊' },
    );
    const oldState = Y.encodeStateAsUpdate(current);

    // 之後的修改：改一個、刪一個、加一個
    const objs = getObjects(current);
    current.transact(() => {
      objs.get('mod')!.set('x', 99);
      objs.delete('keep');
      objs.set('new', createObjectMap({ type: 'shape', id: 'new', x: 1, y: 1, w: 1, h: 1 }));
    }, localOrigin);
    const afterEdits = docCanonical(current);

    const undo = new Y.UndoManager(objs, { trackedOrigins: new Set([localOrigin]), captureTimeout: 0 });
    const target = docFromState(oldState);
    const diff = restoreFromDoc(current, target, localOrigin);
    expect(diff.removed).toEqual(['new']);
    expect(diff.added).toEqual(['keep']);
    expect(diff.changed).toEqual(['mod']);
    expect(docCanonical(current)).toBe(docCanonical(target));

    undo.undo();
    expect(docCanonical(current)).toBe(afterEdits);
  });

  it('還原後另一個副本（另一個分頁）合併後也一致', () => {
    const a = docWith({ type: 'shape', id: 's', x: 0, y: 0, w: 1, h: 1, text: 'v1' });
    const v1 = Y.encodeStateAsUpdate(a);
    const b = new Y.Doc();
    Y.applyUpdate(b, v1);
    getObjects(a).get('s')!.set('x', 50);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    restoreFromDoc(a, docFromState(v1), localOrigin);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    expect(docCanonical(b)).toBe(docCanonical(a));
    expect(diffDocs(a, docFromState(v1)).changed).toEqual([]);
  });
});

describe('富文本：刪除線、行內程式碼、螢光標記、核取清單、程式碼區塊', () => {
  it('讀出新增的 mark 與區塊', () => {
    const doc = new Y.Doc();
    const f = doc.getXmlFragment('f');
    const p = new Y.XmlElement('paragraph');
    const task = new Y.XmlElement('taskList');
    const code = new Y.XmlElement('codeBlock');
    f.insert(0, [p, task, code]);
    const t = new Y.XmlText();
    p.insert(0, [t]);
    t.insert(0, '刪', { strike: {} });
    t.insert(1, 'x()', { code: {} });
    t.insert(4, '亮', { highlight: {} });
    const item = new Y.XmlElement('taskItem');
    item.setAttribute('checked', true as any);
    task.insert(0, [item]);
    const ip = new Y.XmlElement('paragraph');
    item.insert(0, [ip]);
    const it2 = new Y.XmlText();
    ip.insert(0, [it2]);
    it2.insert(0, '完成');
    const ct = new Y.XmlText();
    code.insert(0, [ct]);
    ct.insert(0, 'a = 1\nb = 2');

    const blocks = readRichText(f);
    expect(blocks[0].runs).toEqual([
      { text: '刪', strike: true },
      { text: 'x()', code: true },
      { text: '亮', highlight: true },
    ]);
    expect(blocks[1]).toMatchObject({ kind: 'task', checked: true, depth: 0, runs: [{ text: '完成' }] });
    expect(blocks[2]).toEqual({ kind: 'code', runs: [{ text: 'a = 1\nb = 2' }] });
  });
});
