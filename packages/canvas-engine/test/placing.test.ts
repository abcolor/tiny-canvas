import { describe, expect, it } from 'vitest';
import { localOrigin } from '@tinycanvas/shared';
import { countTransactions, makeModel, raw, rect, section } from './helpers';
import { PLACING_PREFIX } from '../src/model';

describe('放置複本（startPlacingDuplicate 的模型部分）', () => {
  const board = () =>
    makeModel([
      rect('a', 0, 0),
      rect('b', 200, 0, { z: 'a1' }),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'a', anchor: 'right' }, to: { objectId: 'b', anchor: 'left' } },
      section('S', 1000, 1000, 600, 400),
    ]);

  it('準備與預覽期間不寫入文件；預覽快照使用暫時 id 並跟著左上角位移', () => {
    const { doc, model } = board();
    model.setSelection(['a', 'b']);
    const tx = countTransactions(doc);
    const p = model.preparePlacement()!;
    const snaps = model.placementSnapshots(p, { x: 500, y: 300 });
    model.placementSnapshots(p, { x: 900, y: 900 });
    tx.stop();
    expect(tx.list).toEqual([]);
    expect(p.bounds).toEqual({ x: 0, y: 0, w: 300, h: 60 });
    expect(snaps.map((o) => o.id)).toEqual([PLACING_PREFIX + 'a', PLACING_PREFIX + 'b', PLACING_PREFIX + 'c']);
    expect(snaps[0]).toMatchObject({ x: 500, y: 300 });
    expect(snaps[1]).toMatchObject({ x: 700, y: 300 });
    expect((snaps[2] as any).from.objectId).toBe(PLACING_PREFIX + 'a');
  });

  it('左上角吸附格線，Alt 時不吸附', () => {
    const { model } = board();
    expect(model.placementTopLeft({ x: 103, y: 45 })).toEqual({ x: 104, y: 48 });
    expect(model.placementTopLeft({ x: 103, y: 45 }, true)).toEqual({ x: 103, y: 45 });
  });

  it('確定位置：一個 localOrigin transaction、一步復原；新 id、連線改接到複本、選取複本', () => {
    const { doc, model } = board();
    model.setSelection(['a', 'b']);
    const p = model.preparePlacement()!;
    model.stopCapturing();
    const before = model.undoManager.undoStack.length;
    const tx = countTransactions(doc);
    const tops = model.commitPlacement(p, { x: 400, y: 200 });
    tx.stop();
    model.stopCapturing();
    expect(tx.list).toEqual([localOrigin]);
    expect(model.undoManager.undoStack.length).toBe(before + 1);
    const copies = tops.map((id) => model.store.get(id)!);
    expect(copies.map((o) => o.type).sort()).toEqual(['connector', 'shape', 'shape']);
    const shapes = copies.filter((o) => o.type === 'shape');
    expect(shapes.map((o) => [o.x, o.y]).sort()).toEqual([
      [400, 200],
      [600, 200],
    ]);
    const conn = copies.find((o) => o.type === 'connector') as any;
    expect(shapes.map((o) => o.id)).toContain(conn.from.objectId);
    expect(shapes.map((o) => o.id)).toContain(conn.to.objectId);
    expect(model.selection.sort()).toEqual(tops.sort());
    model.undo();
    expect(model.store.objects.size).toBe(4);
  });

  it('頂層複本的中心落在區塊內 → 歸屬該區塊', () => {
    const { model } = board();
    model.setSelection(['a']);
    const p = model.preparePlacement()!;
    const [id] = model.commitPlacement(p, { x: 1100, y: 1100 });
    expect(model.store.get(id)!.parentId).toBe('S');
  });

  it('複製區塊（含內容）：子物件仍指向複製出來的區塊', () => {
    const { model } = makeModel([section('S', 0, 0, 400, 300), rect('k', 20, 20, { parentId: 'S' })]);
    model.setSelection(['S']);
    const p = model.preparePlacement()!;
    const tops = model.commitPlacement(p, { x: 1000, y: 0 });
    expect(tops.length).toBe(1);
    const newS = model.store.get(tops[0])!;
    const kids = model.store.children(newS.id).map((id) => model.store.get(id)!);
    expect(kids.length).toBe(1);
    const S = model.store.get('S')!;
    const k = model.store.get('k')!;
    expect(kids[0].x - newS.x).toBe(k.x - S.x);
    expect(kids[0].y - newS.y).toBe(k.y - S.y);
    expect(raw(model.doc, 'k')!.parentId).toBe('S');
  });

  it('群組複本保留結構；文件中原物件不受影響', () => {
    const { model } = makeModel([{ type: 'group', id: 'G', x: 0, y: 0, w: 300, h: 60 }, rect('a', 0, 0, { parentId: 'G' }), rect('b', 200, 0, { parentId: 'G', z: 'a1' })]);
    model.setSelection(['G']);
    const p = model.preparePlacement()!;
    const [g] = model.commitPlacement(p, { x: 0, y: 200 });
    const gObj = model.store.get(g)!;
    expect(gObj.type).toBe('group');
    expect(gObj).toMatchObject({ x: 0, y: 200, w: 300, h: 60 });
    expect(model.store.children(g).length).toBe(2);
    expect(model.store.children('G').length).toBe(2);
  });

  it('沒有選取時無法開始', () => {
    const { model } = board();
    model.setSelection([]);
    expect(model.preparePlacement()).toBeNull();
  });
});
