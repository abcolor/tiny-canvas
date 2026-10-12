import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getObjects, localOrigin } from '@tinycanvas/shared';
import { EditorModel } from '../src/model';
import { countTransactions, makeModel, raw, rect, section } from './helpers';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('3.2 旋轉規則', () => {
  it('單一物件繞自身中心旋轉：只改 rotation', () => {
    const { doc, model } = makeModel([rect('a', 0, 0)]);
    model.rotate(30, ['a']);
    expect(raw(doc, 'a')).toMatchObject({ x: 0, y: 0, rotation: 30 });
    model.rotate(-60, ['a']);
    expect(raw(doc, 'a')!.rotation).toBe(330);
  });

  it('旋轉群組：群組 rotation 恆為 0，改寫每個子物件的位置與 rotation（繞群組中心）', () => {
    const { doc, model } = makeModel([
      { type: 'group', id: 'G', x: 0, y: 0, w: 300, h: 60 },
      rect('a', 0, 0, { parentId: 'G' }),
      rect('b', 200, 0, { parentId: 'G', z: 'a1' }),
    ]);
    const tx = countTransactions(doc);
    model.rotate(90, ['G']);
    tx.stop();
    expect(tx.list).toEqual([localOrigin]);
    // 群組中心 (150, 30)。a 的中心 (50,30) 轉 90 度後為 (150,-70)
    const a = raw(doc, 'a')!;
    close(a.x + a.w / 2, 150);
    close(a.y + a.h / 2, -70);
    expect(a.rotation).toBe(90);
    const b = raw(doc, 'b')!;
    close(b.x + b.w / 2, 150);
    close(b.y + b.h / 2, 130);
    const g = raw(doc, 'G')!;
    expect(g.rotation).toBe(0);
    // 外接框改為旋轉後子物件的聯集
    close(g.x, 120);
    close(g.y, -120);
    close(g.w, 60);
    close(g.h, 300);
  });

  it('不可旋轉：線框圖、區塊、表格、連線，以及含有它們的群組', () => {
    const { model } = makeModel([
      section('S', 0, 0, 100, 100),
      { type: 'wireframe', id: 'w', x: 0, y: 0, w: 100, h: 40, componentKind: 'button' },
      { type: 'table', id: 't', x: 0, y: 0, w: 100, h: 40 },
      { type: 'group', id: 'G', x: 0, y: 0, w: 100, h: 40 },
      { type: 'wireframe', id: 'w2', x: 0, y: 0, w: 100, h: 40, componentKind: 'button', parentId: 'G' },
      rect('a', 0, 0),
    ]);
    expect(model.canRotate(['S'])).toBe(false);
    expect(model.canRotate(['w'])).toBe(false);
    expect(model.canRotate(['t'])).toBe(false);
    expect(model.canRotate(['G'])).toBe(false);
    expect(model.canRotate(['a'])).toBe(true);
    model.updateObject('S', { rotation: 45 });
    expect(model.store.get('S')!.rotation).toBe(0);
  });

  it('群組內有任何旋轉過的子物件（含巢狀）時只能等比縮放', () => {
    const { model } = makeModel([
      { type: 'group', id: 'outer', x: 0, y: 0, w: 500, h: 60 },
      { type: 'group', id: 'inner', x: 0, y: 0, w: 300, h: 60, parentId: 'outer' },
      rect('a', 0, 0, { parentId: 'inner' }),
      rect('b', 200, 0, { parentId: 'inner', z: 'a1' }),
      rect('c', 400, 0, { parentId: 'outer', z: 'a2' }),
      { type: 'group', id: 'plain', x: 0, y: 200, w: 100, h: 60 },
      rect('d', 0, 200, { parentId: 'plain' }),
    ]);
    expect(model.mustScaleProportionally(['outer'])).toBe(false);
    model.enteredGroupId = 'inner';
    model.rotate(15, ['a']);
    model.enteredGroupId = null;
    expect(model.mustScaleProportionally(['outer'])).toBe(true);
    expect(model.mustScaleProportionally(['plain'])).toBe(false);
  });

  it('縮放群組時子物件依比例縮放；旋轉過的子物件等比縮放並保持角度', () => {
    const { doc, model } = makeModel([
      { type: 'group', id: 'G', x: 0, y: 0, w: 300, h: 60 },
      rect('a', 0, 0, { parentId: 'G' }),
      rect('b', 200, 0, { parentId: 'G', z: 'a1', rotation: 90 }),
    ]);
    model.resize({ x: 0, y: 0, w: 300, h: 100 }, { x: 0, y: 0, w: 600, h: 200 }, ['G']);
    expect(raw(doc, 'a')).toMatchObject({ x: 0, y: 0, w: 200, h: 120 });
    const b = raw(doc, 'b')!;
    expect(b.rotation).toBe(90);
    close(b.w, 200);
    close(b.h, 120);
    close(b.x + b.w / 2, 500);
    close(b.y + b.h / 2, 60);
  });
});

describe('3.5 復原', () => {
  it('拖曳一段距離 = 一步復原', () => {
    const { doc, model } = makeModel([rect('a', 0, 0), rect('b', 200, 0)]);
    model.stopCapturing();
    model.moveUnits(['a', 'b'], 40, 40);
    model.stopCapturing();
    expect(model.undoManager.undoStack.length).toBe(1);
    model.undo();
    expect(raw(doc, 'a')).toMatchObject({ x: 0, y: 0 });
    expect(raw(doc, 'b')).toMatchObject({ x: 200, y: 0 });
    model.redo();
    expect(raw(doc, 'a')).toMatchObject({ x: 40, y: 40 });
  });

  it('兩次手勢之間 stopCapturing → 兩步', () => {
    const { model } = makeModel([rect('a', 0, 0)]);
    model.moveUnits(['a'], 10, 0);
    model.stopCapturing();
    model.moveUnits(['a'], 10, 0);
    expect(model.undoManager.undoStack.length).toBe(2);
  });

  it('不會復原其他分頁的變更（遠端 origin 不被追蹤）', () => {
    const { doc, model } = makeModel([rect('a', 0, 0), rect('b', 200, 0)]);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    model.moveUnits(['a'], 10, 0);
    model.stopCapturing();
    remote.transact(() => getObjects(remote).get('b')!.set('x', 999), 'remote');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)), 'provider');
    expect(raw(doc, 'b')!.x).toBe(999);
    model.undo();
    expect(raw(doc, 'a')!.x).toBe(0);
    expect(raw(doc, 'b')!.x).toBe(999);
    expect(model.undoManager.undoStack.length).toBe(0);
  });

  it('extraTrackedOrigins（例如 y-prosemirror 的 key）也進入同一個復原堆疊', () => {
    const editorKey = { name: 'ySync' };
    const { doc, model } = makeModel([rect('a', 0, 0, { text: 'x' })], { extraTrackedOrigins: [editorKey] });
    doc.transact(() => {
      const f = getObjects(doc).get('a')!.get('text') as Y.XmlFragment;
      const p = f.get(0) as Y.XmlElement;
      (p.get(0) as Y.XmlText).insert(1, 'yz');
    }, editorKey);
    expect(model.undoManager.undoStack.length).toBe(1);
    model.undo();
    expect(model.store.get('a')!.type === 'shape' && (model.store.get('a') as any).text[0].runs[0].text).toBe('x');
  });

  it('唯讀模式：所有修改指令都沒有作用', () => {
    const { doc } = makeModel([rect('a', 0, 0), rect('b', 200, 0)]);
    const ro = new EditorModel({ doc, readOnly: true });
    ro.moveUnits(['a'], 10, 10);
    expect(ro.group(['a', 'b'])).toBeNull();
    ro.deleteIds(['a']);
    ro.insert({ type: 'shape', x: 0, y: 0, w: 10, h: 10 });
    expect(raw(doc, 'a')).toMatchObject({ x: 0, y: 0 });
    expect(ro.store.objects.size).toBe(2);
  });
});

describe('其他指令', () => {
  it('鎖定的物件不能移動、刪除、修改樣式，但可以選取', () => {
    const { doc, model } = makeModel([rect('a', 0, 0, { locked: true })]);
    model.setSelection(['a']);
    expect(model.selection).toEqual(['a']);
    model.moveUnits(['a'], 50, 0);
    model.deleteIds(['a']);
    model.setStyle({ fill: '#f00' }, ['a']);
    expect(raw(doc, 'a')).toMatchObject({ x: 0, locked: true, style: {} });
    model.setLocked(false, ['a']);
    model.moveUnits(['a'], 50, 0);
    expect(raw(doc, 'a')!.x).toBe(50);
  });

  it('對齊與分佈', () => {
    const { doc, model } = makeModel([rect('a', 0, 0), rect('b', 300, 50), rect('c', 1000, 100)]);
    model.align('top', ['a', 'b', 'c']);
    expect([raw(doc, 'a')!.y, raw(doc, 'b')!.y, raw(doc, 'c')!.y]).toEqual([0, 0, 0]);
    model.distribute('h', ['a', 'b', 'c']);
    expect(raw(doc, 'b')!.x).toBe(500);
    model.align('right', ['a', 'b']);
    expect(raw(doc, 'a')!.x).toBe(500);
  });

  it('樣式複製與貼上', () => {
    const { doc, model } = makeModel([rect('a', 0, 0, { style: { fill: '#123456', stroke: '#000' } }), rect('b', 200, 0)]);
    model.copyStyle('a');
    model.pasteStyle(['b']);
    expect(raw(doc, 'b')!.style).toEqual({ fill: '#123456', stroke: '#000' });
    model.setStyle({ fill: undefined, textColor: '#fff' }, ['b']);
    expect(raw(doc, 'b')!.style).toEqual({ stroke: '#000', textColor: '#fff' });
  });
});
