import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getObjects, readRichText, localOrigin } from '@tinycanvas/shared';
import { countTransactions, makeModel, raw, rect, section } from './helpers';
import { EditorModel } from '../src/model';
import { resolveStyle } from '../src/style';

describe('空間索引與視窗裁切', () => {
  it('只回傳與範圍相交的物件；物件移動時增量更新', () => {
    const objs = [];
    for (let i = 0; i < 100; i++) for (let j = 0; j < 100; j++) objs.push(rect(`r${i}_${j}`, i * 200, j * 100));
    const { model } = makeModel(objs);
    const hits = model.store.query({ x: 0, y: 0, w: 450, h: 250 }).map((it) => it.id).sort();
    // x: 0,200,400 → 3 欄；y: 0,100,200 → 3 列
    expect(hits.length).toBe(9);
    model.moveUnits(['r50_50'], -10000 + 100, -5000 + 50);
    const again = model.store.query({ x: 0, y: 0, w: 450, h: 250 }).map((it) => it.id);
    expect(again).toContain('r50_50');
    expect(model.store.query({ x: 10000, y: 5000, w: 1, h: 1 }).map((i) => i.id)).not.toContain('r50_50');
  });

  it('旋轉物件以旋轉後的外接框建立索引', () => {
    const { model } = makeModel([rect('a', 0, 0, { w: 200, h: 20 })]);
    model.rotate(90, ['a']);
    const b = model.store.boundsOf('a')!;
    expect(b.h).toBeCloseTo(200);
    expect(b.w).toBeCloseTo(20);
  });
});

describe('剪貼簿', () => {
  it('序列化後貼上：新 id、parentId 重新對應、連線端點重新對應、保留樣式與富文本', () => {
    const { doc, model } = makeModel([
      section('S', 0, 0, 600, 400),
      { type: 'group', id: 'G', x: 20, y: 20, w: 300, h: 60, parentId: 'S' },
      rect('a', 20, 20, { parentId: 'G', style: { fill: '#abcdef' }, text: '第一行\n第二行' }),
      rect('b', 220, 20, { parentId: 'G', z: 'a1' }),
      rect('outside', 900, 0),
      { type: 'connector', id: 'c1', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'a', anchor: 'right' }, to: { objectId: 'b', anchor: 'left' } },
      { type: 'connector', id: 'c2', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'b', anchor: 'right' }, to: { objectId: 'outside', anchor: 'left' } },
    ]);
    const data = model.serialize(['S'])!;
    // 貼到另一張畫布
    const other = new Y.Doc();
    const m2 = new EditorModel({ doc: other });
    const tops = m2.paste(data, { at: { x: 2000, y: 2000 } });
    expect(tops.length).toBe(2); // 區塊 + 兩端都在內的連線
    const objs = Array.from(m2.store.objects.values());
    expect(objs.length).toBe(5); // S, G, a, b, c1（c2 的另一端不在剪貼簿內，不複製）
    const newS = objs.find((o) => o.type === 'section')!;
    const newG = objs.find((o) => o.type === 'group')!;
    const shapes = objs.filter((o) => o.type === 'shape');
    const conn = objs.find((o) => o.type === 'connector')! as any;
    for (const o of objs) expect(['S', 'G', 'a', 'b', 'c1']).not.toContain(o.id);
    expect(newG.parentId).toBe(newS.id);
    for (const s of shapes) expect(s.parentId).toBe(newG.id);
    expect(shapes.map((s) => s.id)).toContain(conn.from.objectId);
    expect(shapes.map((s) => s.id)).toContain(conn.to.objectId);
    expect(Math.abs(newS.x + newS.w / 2 - 2000)).toBeLessThanOrEqual(4); // 位移吸附格線
    const styled = shapes.find((s) => s.style.fill === '#abcdef')! as any;
    expect(styled.text.map((b: any) => b.runs.map((r: any) => r.text).join(''))).toEqual(['第一行', '第二行']);
    // 原本的畫布不受影響
    expect(raw(doc, 'a')!.parentId).toBe('G');
  });

  it('只複製連線一端時，另一端改為懸空端點並維持位置', () => {
    const { model } = makeModel([
      rect('a', 0, 0),
      rect('b', 400, 0),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'a', anchor: 'right' }, to: { objectId: 'b', anchor: 'left' } },
    ]);
    const data = model.serialize(['a', 'c'])!;
    const tops = model.paste(data, { offset: 0 });
    const conn = tops.map((id) => model.store.get(id)!).find((o) => o.type === 'connector') as any;
    expect(conn.to.objectId).toBeNull();
    expect(conn.to.x).toBe(400 + 16);
    expect(conn.to.y).toBe(30 + 16);
  });

  it('貼上是一個 transaction；連續貼上依次位移', () => {
    const { doc, model } = makeModel([rect('a', 0, 0)]);
    const data = model.serialize(['a'])!;
    const tx = countTransactions(doc);
    const [p1] = model.paste(data);
    const [p2] = model.paste(data);
    tx.stop();
    expect(tx.list).toEqual([localOrigin, localOrigin]);
    expect(model.store.get(p1)!.x).toBe(16);
    expect(model.store.get(p2)!.x).toBe(32);
    expect(model.selection).toEqual([p2]);
  });

  it('貼到區塊內的位置時歸屬該區塊', () => {
    const { model } = makeModel([section('S', 1000, 1000, 400, 400), rect('a', 0, 0)]);
    const [p] = model.paste(model.serialize(['a'])!, { at: { x: 1200, y: 1200 } });
    expect(model.store.get(p)!.parentId).toBe('S');
  });

  it('重複（Mod+D）', () => {
    const { model } = makeModel([rect('a', 0, 0, { text: 'hi' })]);
    const [d] = model.duplicate(['a']);
    expect(d).not.toBe('a');
    expect(model.store.get(d)!.x).toBe(16);
    expect(readRichText(getObjects(model.doc).get(d)!.get('text'))[0].runs[0].text).toBe('hi');
  });
});

describe('extend（Mod+Alt+方向鍵）', () => {
  it('朝方向建立同樣式的形狀並自動連線，一個 transaction，選取新形狀', () => {
    const { doc, model } = makeModel([rect('a', 0, 0, { style: { fill: '#eee' }, shapeKind: 'diamond' })]);
    model.setSelection(['a']);
    const tx = countTransactions(doc);
    const id = model.extend('right')!;
    tx.stop();
    expect(tx.list).toEqual([localOrigin]);
    const n = model.store.get(id)! as any;
    expect(n.shapeKind).toBe('diamond');
    expect(n.style.fill).toBe('#eee');
    expect(n.x).toBeGreaterThan(100);
    expect(n.y).toBe(0);
    const conn = Array.from(model.store.objects.values()).find((o) => o.type === 'connector') as any;
    expect(conn.from).toMatchObject({ objectId: 'a', anchor: 'right' });
    expect(conn.to).toMatchObject({ objectId: id, anchor: 'left' });
    expect(model.selection).toEqual([id]);
    model.undo();
    expect(model.store.objects.size).toBe(1);
  });

  it('目標位置被佔用時往旁邊找空位', () => {
    const { model } = makeModel([rect('a', 0, 0)]);
    model.setSelection(['a']);
    const first = model.extend('down')!;
    model.setSelection(['a']);
    const second = model.extend('down')!;
    const f = model.store.get(first)!;
    const s = model.store.get(second)!;
    expect(f.y).toBe(s.y);
    expect(Math.abs(f.x - s.x)).toBeGreaterThanOrEqual(100);
  });
});

describe('autoLayout', () => {
  it('一個 transaction；左上角維持在原處；由上而下排列', async () => {
    const { doc, model } = makeModel([
      rect('a', 400, 400),
      rect('b', 1000, 0),
      rect('c', 0, 900),
      { type: 'connector', id: 'e1', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'a', anchor: 'right' }, to: { objectId: 'b', anchor: 'left' } },
      { type: 'connector', id: 'e2', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'b', anchor: null }, to: { objectId: 'c', anchor: null } },
    ]);
    model.setSelection(['a', 'b', 'c']);
    const tx = countTransactions(doc);
    await model.autoLayout('down');
    tx.stop();
    expect(tx.list).toEqual([localOrigin]);
    const a = raw(doc, 'a')!;
    const b = raw(doc, 'b')!;
    const c = raw(doc, 'c')!;
    expect(b.y).toBeGreaterThan(a.y + a.h);
    expect(c.y).toBeGreaterThan(b.y + b.h);
    expect(Math.min(a.x, b.x, c.x)).toBe(0);
    expect(Math.min(a.y, b.y, c.y)).toBe(0);
    expect((raw(doc, 'e1') as any).from.anchor).toBe('bottom');
    model.undo();
    expect(raw(doc, 'a')).toMatchObject({ x: 400, y: 400 });
  });
});

describe('表格列與欄（以 id 定位）', () => {
  it('插入與刪除列、欄，一個 transaction，尺寸同步', () => {
    const { doc, model } = makeModel([
      { type: 'table', id: 't', x: 0, y: 0, w: 240, h: 80, columns: [{ id: 'c1', width: 120 }, { id: 'c2', width: 120 }], rows: [{ id: 'r1', height: 40 }, { id: 'r2', height: 40 }], headerRow: true },
    ]);
    const tx = countTransactions(doc);
    const r = model.tableInsertRow('t', 'r1', 'below')!;
    tx.stop();
    expect(tx.list).toEqual([localOrigin]);
    let t = model.store.get('t') as any;
    expect(t.rows.map((x: any) => x.id)).toEqual(['r1', r, 'r2']);
    expect(Object.keys(t.cells).sort()).toContain(`${r}:c1`);
    expect(t.h).toBe(120);
    const c = model.tableInsertColumn('t', 'c1', 'left')!;
    t = model.store.get('t') as any;
    expect(t.columns.map((x: any) => x.id)).toEqual([c, 'c1', 'c2']);
    expect(t.w).toBe(360);
    model.tableDeleteRow('t', 'r1');
    model.tableDeleteColumn('t', 'c2');
    t = model.store.get('t') as any;
    expect(t.rows.length).toBe(2);
    expect(t.columns.length).toBe(2);
    expect(Object.keys(t.cells).length).toBe(4);
  });
});

describe('z key 容錯', () => {
  it('其他用戶端寫入不合法的 z 時，新增物件與調整層級仍可運作', () => {
    const { model } = makeModel([rect('a', 0, 0, { z: 'a000000' }), rect('b', 0, 0, { z: 'not a key' })]);
    const id = model.insert({ type: 'shape', x: 0, y: 0, w: 10, h: 10 });
    expect(model.store.get(id)).toBeTruthy();
    model.bringToFront(['a']);
    model.sendToBack(['b']);
    expect(model.store.getOrder()[0]).toBe('b');
  });
});

describe('連線預設值', () => {
  it('新連線的終點預設為實心箭頭，起點無箭頭', () => {
    const { model } = makeModel([rect('a', 0, 0), rect('b', 300, 0)]);
    const id = model.insert({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'a', anchor: 'right' }, to: { objectId: 'b', anchor: 'left' } });
    expect(model.store.get(id)).toMatchObject({ startArrow: 'none', endArrow: 'triangle' });
  });
});

describe('線條粗細預設值', () => {
  it('新形狀與新連線預設粗細為 3；指定時以指定值為準', () => {
    const { model } = makeModel();
    const a = model.insert({ type: 'shape', x: 0, y: 0, w: 100, h: 60, shapeKind: 'rectangle' });
    const b = model.insert({ type: 'shape', x: 300, y: 0, w: 100, h: 60, shapeKind: 'rectangle', style: { strokeWidth: 1 } });
    const c = model.insert({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a, anchor: 'right' }, to: { objectId: b, anchor: 'left' } });
    expect(resolveStyle(model.store.get(a)!).strokeWidth).toBe(3);
    expect(resolveStyle(model.store.get(b)!).strokeWidth).toBe(1);
    expect(resolveStyle(model.store.get(c)!).strokeWidth).toBe(3);
  });

  it('舊物件（沒有存粗細）維持原本的預設；延伸出的形狀與來源相同', () => {
    const { model } = makeModel([rect('old', 0, 0)]);
    expect(resolveStyle(model.store.get('old')!).strokeWidth).toBe(1.5);
    model.setSelection(['old']);
    const id = model.extend('right')!;
    expect(resolveStyle(model.store.get(id)!).strokeWidth).toBe(1.5);
  });
});
