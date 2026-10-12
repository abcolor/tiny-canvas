import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getObjects, localOrigin, systemOrigin } from '@tinycanvas/shared';
import { countTransactions, makeModel, raw, rect, section, setSectionFrameKind } from './helpers';
import type { FrameKind } from '@tinycanvas/shared';
import { beforeEach } from 'vitest';

// 每條區塊規則同時對一般區塊與各種裝置框（第 4.2 節：裝置框是一種區塊）執行
const KINDS: (FrameKind | null)[] = [null, 'phone', 'tablet', 'browser', 'window'];
describe.each(KINDS)('區塊類型 frameKind=%s', (kind) => {
beforeEach(() => setSectionFrameKind(kind));

describe('3.3 座標系：絕對座標', () => {
  it('移動區塊時，在同一個 transaction 內改寫區塊與所有子孫的 x/y', () => {
    const { doc, model } = makeModel([
      section('S', 0, 0, 600, 400),
      { type: 'group', id: 'G', x: 50, y: 50, w: 250, h: 60, parentId: 'S', z: 'a1' },
      rect('a', 50, 50, { parentId: 'G', z: 'a0' }),
      rect('b', 200, 50, { parentId: 'G', z: 'a1' }),
      rect('c', 300, 200, { parentId: 'S', z: 'a2' }),
    ]);
    const tx = countTransactions(doc);
    model.moveUnits(['S'], 100, 40);
    tx.stop();
    expect(tx.list).toEqual([localOrigin]);
    const s0 = section('S', 0, 0, 600, 400);
    expect(raw(doc, 'S')).toMatchObject({ x: s0.x + 100, y: s0.y + 40 });
    expect(raw(doc, 'G')).toMatchObject({ x: 150, y: 90 });
    expect(raw(doc, 'a')).toMatchObject({ x: 150, y: 90 });
    expect(raw(doc, 'b')).toMatchObject({ x: 300, y: 90 });
    expect(raw(doc, 'c')).toMatchObject({ x: 400, y: 240 });
  });

  it('移動群組時子孫一起移動，群組外接框仍等於子物件聯集', () => {
    const { doc, model } = makeModel([
      { type: 'group', id: 'G', x: 0, y: 0, w: 300, h: 60 },
      rect('a', 0, 0, { parentId: 'G' }),
      rect('b', 200, 0, { parentId: 'G', z: 'a1' }),
    ]);
    model.moveUnits(['G'], 10, 20);
    expect(raw(doc, 'G')).toMatchObject({ x: 10, y: 20, w: 300, h: 60 });
    expect(raw(doc, 'b')).toMatchObject({ x: 210, y: 20 });
  });
});

describe('3.3 歸屬規則', () => {
  it('parentId 指向最近的容器：放進區塊 → 區塊；再群組 → 成員指向群組、群組指向區塊', () => {
    const { doc, model } = makeModel([section('S', 0, 0, 800, 600), rect('a', 900, 0), rect('b', 1100, 0)]);
    model.moveUnits(['a'], -800, 100); // 中心 (150,130) 在 S 內
    model.moveUnits(['b'], -900, 100);
    expect(raw(doc, 'a')!.parentId).toBe('S');
    expect(raw(doc, 'b')!.parentId).toBe('S');
    const g = model.group(['a', 'b'])!;
    expect(raw(doc, 'a')!.parentId).toBe(g);
    expect(raw(doc, 'b')!.parentId).toBe(g);
    expect(raw(doc, g)!.parentId).toBe('S');
  });

  it('區塊不能放進群組：選取含區塊時群組指令停用', () => {
    const { model } = makeModel([section('S', 0, 0, 400, 300), rect('a', 600, 0)]);
    expect(model.canGroup(['S', 'a'])).toBe(false);
    expect(model.group(['S', 'a'])).toBeNull();
    expect(model.store.objects.size).toBe(2);
  });

  it('區塊不能放進另一個區塊：把區塊拖進另一個區塊不會改變 parentId', () => {
    const { doc, model } = makeModel([section('S1', 0, 0, 800, 600), section('S2', 1000, 0, 200, 200, { z: 'a1' })]);
    model.moveUnits(['S2'], -900, 100);
    expect(raw(doc, 'S2')!.parentId).toBeNull();
  });

  it('群組成員 parentId 不同（一部分在區塊內、一部分在頂層）→ 群組 parentId 為 null，成員位置不變', () => {
    const { doc, model } = makeModel([
      section('S', 0, 0, 400, 300),
      rect('a', 20, 20, { parentId: 'S' }),
      rect('b', 600, 20),
    ]);
    const g = model.group(['a', 'b'])!;
    expect(raw(doc, g)!.parentId).toBeNull();
    expect(raw(doc, 'a')).toMatchObject({ x: 20, y: 20, parentId: g });
    expect(raw(doc, 'b')).toMatchObject({ x: 600, y: 20, parentId: g });
  });

  it('群組成員分屬不同區塊 → 群組 parentId 為 null', () => {
    const { doc, model } = makeModel([
      section('S1', 0, 0, 400, 300),
      section('S2', 500, 0, 400, 300, { z: 'a1' }),
      rect('a', 20, 20, { parentId: 'S1' }),
      rect('b', 520, 20, { parentId: 'S2' }),
    ]);
    const g = model.group(['a', 'b'])!;
    expect(raw(doc, g)!.parentId).toBeNull();
  });

  it('群組成員都在同一個區塊 → 群組 parentId 為該區塊', () => {
    const { doc, model } = makeModel([section('S', 0, 0, 800, 300), rect('a', 20, 20, { parentId: 'S' }), rect('b', 300, 20, { parentId: 'S', z: 'a1' })]);
    const g = model.group(['a', 'b'])!;
    expect(raw(doc, g)!.parentId).toBe('S');
  });

  it('連線不屬於任何容器，也不會被放進群組', () => {
    const { doc, model } = makeModel([section('S', 0, 0, 800, 600), rect('a', 20, 20, { parentId: 'S' }), rect('b', 300, 20, { parentId: 'S' })]);
    const c = model.insert({ type: 'connector', x: 0, y: 0, w: 1, h: 1, parentId: 'S', from: { objectId: 'a', anchor: 'right' }, to: { objectId: 'b', anchor: 'left' } });
    expect(raw(doc, c)!.parentId).toBeNull();
    const g = model.group(['a', 'b', c])!;
    expect(raw(doc, c)!.parentId).toBeNull();
    expect(raw(doc, 'a')!.parentId).toBe(g);
    model.updateObject(c, { parentId: 'S' });
    expect(raw(doc, c)!.parentId).toBeNull();
  });
});

describe('3.3 拖入與拖出：以外接框中心點判定', () => {
  it('中心點在區塊內才歸屬；只有部分重疊但中心點在外 → 不歸屬', () => {
    const { doc, model } = makeModel([section('S', 0, 0, 400, 300), rect('a', 600, 0)]);
    // a 寬 100：x=340 時與 S 重疊 60px，中心 390 仍在 S 內
    model.moveUnits(['a'], -260, 0);
    expect(raw(doc, 'a')!.parentId).toBe('S');
    // x=360：中心 410 在 S 外，雖然仍重疊 40px
    model.moveUnits(['a'], 20, 0);
    expect(raw(doc, 'a')!.parentId).toBeNull();
  });

  it('拖出區塊 → parentId 為 null', () => {
    const { doc, model } = makeModel([section('S', 0, 0, 400, 300), rect('a', 20, 20, { parentId: 'S' })]);
    model.moveUnits(['a'], 500, 0);
    expect(raw(doc, 'a')!.parentId).toBeNull();
  });

  it('群組以整體外接框中心判定，子物件仍指向群組', () => {
    const { doc, model } = makeModel([
      section('S', 0, 0, 400, 300),
      { type: 'group', id: 'G', x: 500, y: 0, w: 300, h: 60 },
      rect('a', 500, 0, { parentId: 'G' }),
      rect('b', 700, 0, { parentId: 'G', z: 'a1' }),
    ]);
    model.moveUnits(['G'], -450, 50); // 群組 50..350，中心 200 在 S 內
    expect(raw(doc, 'G')!.parentId).toBe('S');
    expect(raw(doc, 'a')!.parentId).toBe('G');
  });

  it('中心點同時落在多個重疊區塊時，歸屬 z 最高的區塊', () => {
    const { doc, model } = makeModel([
      section('low', 0, 0, 500, 500, { z: 'a5' }),
      section('high', 100, 100, 500, 500, { z: 'a7' }),
      section('mid', 50, 50, 500, 500, { z: 'a6' }),
      rect('a', 1000, 1000),
    ]);
    model.moveUnits(['a'], -800, -800); // 中心 (250,230) 在三個區塊內
    expect(raw(doc, 'a')!.parentId).toBe('high');
  });

  it('z 相同時以 id 字典序決定較高的區塊', () => {
    const { doc, model } = makeModel([section('sA', 0, 0, 500, 500, { z: 'a5' }), section('sB', 0, 0, 500, 500, { z: 'a5' }), rect('a', 1000, 1000)]);
    model.moveUnits(['a'], -900, -900);
    expect(raw(doc, 'a')!.parentId).toBe('sB');
  });

  it('拖曳區塊本身不會吸入它經過或覆蓋的物件', () => {
    const { doc, model } = makeModel([section('S', 0, 0, 300, 300), rect('a', 500, 100)]);
    model.moveUnits(['S'], 400, 0); // 區塊現在完全蓋住 a
    expect(raw(doc, 'a')!.parentId).toBeNull();
    expect(raw(doc, 'a')).toMatchObject({ x: 500, y: 100 });
  });

  it('進入群組後拖曳子物件，子物件仍屬於群組（不個別判定區塊）', () => {
    const { doc, model } = makeModel([
      section('S', 0, 0, 400, 300),
      { type: 'group', id: 'G', x: 500, y: 0, w: 300, h: 60 },
      rect('a', 500, 0, { parentId: 'G' }),
      rect('b', 700, 0, { parentId: 'G', z: 'a1' }),
    ]);
    model.enteredGroupId = 'G';
    model.moveUnits(['a'], -400, 0);
    expect(raw(doc, 'a')!.parentId).toBe('G');
  });
});

describe('3.3 群組：建立與解除', () => {
  it('建立群組是一個 transaction，復原一次即還原', () => {
    const { doc, model } = makeModel([rect('a', 0, 0), rect('b', 200, 0, { z: 'a1' })]);
    const tx = countTransactions(doc);
    const g = model.group(['a', 'b'])!;
    tx.stop();
    expect(tx.list).toEqual([localOrigin]);
    expect(raw(doc, g)).toMatchObject({ type: 'group', x: 0, y: 0, w: 300, h: 60, rotation: 0 });
    expect(model.selection).toEqual([g]);
    model.undo();
    expect(raw(doc, g)).toBeNull();
    expect(raw(doc, 'a')!.parentId).toBeNull();
    expect(raw(doc, 'b')!.parentId).toBeNull();
  });

  it('解除群組：子物件改屬群組原本的容器、位置不變、維持選取、一個 transaction', () => {
    const { doc, model } = makeModel([
      section('S', 0, 0, 800, 600),
      { type: 'group', id: 'G', x: 50, y: 50, w: 300, h: 60, parentId: 'S' },
      rect('a', 50, 50, { parentId: 'G' }),
      rect('b', 250, 50, { parentId: 'G', z: 'a1' }),
    ]);
    model.setSelection(['G']);
    const tx = countTransactions(doc);
    model.ungroup();
    tx.stop();
    expect(tx.list).toEqual([localOrigin]);
    expect(raw(doc, 'G')).toBeNull();
    expect(raw(doc, 'a')).toMatchObject({ parentId: 'S', x: 50, y: 50 });
    expect(raw(doc, 'b')).toMatchObject({ parentId: 'S', x: 250, y: 50 });
    expect(model.selection.sort()).toEqual(['a', 'b']);
    model.undo();
    expect(raw(doc, 'G')).not.toBeNull();
    expect(raw(doc, 'a')!.parentId).toBe('G');
  });

  it('解除群組時子物件維持原本在兄弟之間的層級位置', () => {
    const { doc, model } = makeModel([
      rect('under', 0, 0, { z: 'a0' }),
      { type: 'group', id: 'G', x: 0, y: 0, w: 300, h: 60, z: 'a1' },
      rect('a', 0, 0, { parentId: 'G', z: 'a0' }),
      rect('b', 200, 0, { parentId: 'G', z: 'a1' }),
      rect('over', 0, 0, { z: 'a2' }),
    ]);
    model.ungroup(['G']);
    void doc;
    expect(model.store.getOrder()).toEqual(['under', 'a', 'b', 'over']);
  });

  it('巢狀群組：點選選到最外層，進入後選到內層群組；解除一次只解一層', () => {
    const { doc, model } = makeModel([
      { type: 'group', id: 'outer', x: 0, y: 0, w: 500, h: 60 },
      { type: 'group', id: 'inner', x: 0, y: 0, w: 300, h: 60, parentId: 'outer' },
      rect('a', 0, 0, { parentId: 'inner' }),
      rect('b', 200, 0, { parentId: 'inner', z: 'a1' }),
      rect('c', 400, 0, { parentId: 'outer', z: 'a2' }),
    ]);
    expect(model.selectionTarget('a')).toBe('outer');
    model.enteredGroupId = 'outer';
    expect(model.selectionTarget('a')).toBe('inner');
    expect(model.selectionTarget('c')).toBe('c');
    model.enteredGroupId = 'inner';
    expect(model.selectionTarget('a')).toBe('a');
    model.enteredGroupId = null;
    model.ungroup(['outer']);
    expect(raw(doc, 'outer')).toBeNull();
    expect(raw(doc, 'inner')).toMatchObject({ type: 'group', parentId: null });
    expect(raw(doc, 'a')!.parentId).toBe('inner');
    expect(raw(doc, 'c')!.parentId).toBeNull();
  });

  it('群組可以再放進群組（巢狀建立）', () => {
    const { doc, model } = makeModel([rect('a', 0, 0), rect('b', 200, 0, { z: 'a1' }), rect('c', 400, 0, { z: 'a2' })]);
    const g1 = model.group(['a', 'b'])!;
    const g2 = model.group([g1, 'c'])!;
    expect(raw(doc, g1)!.parentId).toBe(g2);
    expect(raw(doc, 'c')!.parentId).toBe(g2);
    expect(raw(doc, g2)).toMatchObject({ x: 0, y: 0, w: 500, h: 60 });
  });

  it('選取正規化：祖先與子孫同時被選取時只留祖先', () => {
    const { model } = makeModel([{ type: 'group', id: 'G', x: 0, y: 0, w: 100, h: 60 }, rect('a', 0, 0, { parentId: 'G' })]);
    model.setSelection(['a', 'G']);
    expect(model.selection).toEqual(['G']);
  });
});

describe('3.3 群組外接框重算', () => {
  const groupDoc = () =>
    makeModel([
      { type: 'group', id: 'G', x: 0, y: 0, w: 300, h: 60 },
      rect('a', 0, 0, { parentId: 'G' }),
      rect('b', 200, 0, { parentId: 'G', z: 'a1' }),
    ]);

  it('本地操作：在同一個 localOrigin transaction 內重算', () => {
    const { doc, model } = groupDoc();
    model.enteredGroupId = 'G';
    const tx = countTransactions(doc);
    model.moveUnits(['b'], 100, 40);
    tx.stop();
    expect(tx.list).toEqual([localOrigin]);
    expect(raw(doc, 'G')).toMatchObject({ x: 0, y: 0, w: 400, h: 100 });
    model.undo();
    expect(raw(doc, 'G')).toMatchObject({ x: 0, y: 0, w: 300, h: 60 });
    expect(raw(doc, 'b')).toMatchObject({ x: 200, y: 0 });
  });

  it('巢狀群組由內而外重算', () => {
    const { doc, model } = makeModel([
      { type: 'group', id: 'outer', x: 0, y: 0, w: 500, h: 60 },
      { type: 'group', id: 'inner', x: 0, y: 0, w: 300, h: 60, parentId: 'outer' },
      rect('a', 0, 0, { parentId: 'inner' }),
      rect('b', 200, 0, { parentId: 'inner', z: 'a1' }),
      rect('c', 400, 0, { parentId: 'outer', z: 'a2' }),
    ]);
    model.updateObject('a', { y: -100 });
    expect(raw(doc, 'inner')).toMatchObject({ y: -100, h: 160 });
    expect(raw(doc, 'outer')).toMatchObject({ y: -100, h: 160, w: 500 });
  });

  it('遠端變動：以 systemOrigin 寫回，不進入復原堆疊', () => {
    const { doc, model } = groupDoc();
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    // 遠端只移動子物件（模擬舊版用戶端或離線合併，沒有一起更新群組）
    remote.transact(() => getObjects(remote).get('b')!.set('x', 500), 'remote');
    const tx = countTransactions(doc);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)), 'remote-provider');
    tx.stop();
    expect(tx.list).toEqual(['remote-provider', systemOrigin]);
    expect(raw(doc, 'G')).toMatchObject({ x: 0, w: 600 });
    expect(model.undoManager.undoStack.length).toBe(0);
  });

  it('遠端變動但外接框數值相同時不寫入', () => {
    const { doc } = groupDoc();
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.transact(() => getObjects(remote).get('a')!.set('style', { fill: '#000' }), 'remote');
    const tx = countTransactions(doc);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)), 'remote-provider');
    tx.stop();
    expect(tx.list).toEqual(['remote-provider']);
  });

  it('群組的子物件全部刪除後，群組也一併刪除', () => {
    const { doc, model } = groupDoc();
    model.enteredGroupId = 'G';
    model.deleteIds(['a', 'b']);
    expect(raw(doc, 'G')).toBeNull();
  });
});

describe('3.3 區塊', () => {
  it('縮放區塊只改變區塊本身，子物件位置不變（可超出範圍）', () => {
    const { doc, model } = makeModel([section('S', 0, 0, 600, 400), rect('a', 400, 300, { parentId: 'S' })]);
    const s0 = raw(doc, 'S')!;
    model.resize({ x: s0.x, y: s0.y, w: s0.w, h: s0.h }, { x: s0.x, y: s0.y, w: s0.w / 2, h: s0.h / 2 }, ['S']);
    expect(raw(doc, 'S')).toMatchObject({ w: s0.w / 2, h: s0.h / 2 });
    expect(raw(doc, 'a')).toMatchObject({ x: 400, y: 300, w: 100, h: 60, parentId: 'S' });
  });

  it('刪除有內容的區塊需要詢問；只刪區塊 → 子物件改為頂層且位置不變', () => {
    const { doc, model } = makeModel([section('S', 0, 0, 600, 400), rect('a', 20, 20, { parentId: 'S' }), section('empty', 700, 0, 100, 100)]);
    expect(model.sectionsNeedingConfirm(['S', 'empty'])).toEqual(['S']);
    const tx = countTransactions(doc);
    model.deleteIds(['S'], 'section-only');
    tx.stop();
    expect(tx.list.length).toBe(1);
    expect(raw(doc, 'S')).toBeNull();
    expect(raw(doc, 'a')).toMatchObject({ parentId: null, x: 20, y: 20 });
  });

  it('連同內容一起刪除 → 子孫全部刪除，接在子物件上的連線也刪除', () => {
    const { doc, model } = makeModel([
      section('S', 0, 0, 600, 400),
      { type: 'group', id: 'G', x: 20, y: 20, w: 100, h: 60, parentId: 'S' },
      rect('a', 20, 20, { parentId: 'G' }),
      rect('out', 900, 0),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'a', anchor: 'right' }, to: { objectId: 'out', anchor: 'left' } },
    ]);
    model.deleteIds(['S'], 'with-contents');
    expect(raw(doc, 'G')).toBeNull();
    expect(raw(doc, 'a')).toBeNull();
    expect(raw(doc, 'c')).toBeNull();
    expect(raw(doc, 'out')).not.toBeNull();
  });
});

describe('3.3 層級（z 順序）', () => {
  it('子物件一律畫在容器之上（即使子物件的 z 較小），容器內依 (z, id) 排序', () => {
    const { model } = makeModel([
      section('S', 0, 0, 600, 400, { z: 'a5' }),
      rect('k2', 0, 0, { parentId: 'S', z: 'a1' }),
      rect('k1', 0, 0, { parentId: 'S', z: 'a0' }),
      rect('top', 0, 0, { z: 'a9' }),
      rect('bottom', 0, 0, { z: 'a0' }),
    ]);
    expect(model.store.getOrder()).toEqual(['bottom', 'S', 'k1', 'k2', 'top']);
  });

  it('z 相同時以 id 字典序決定先後', () => {
    const { model } = makeModel([rect('b', 0, 0, { z: 'a1' }), rect('a', 0, 0, { z: 'a1' }), rect('c', 0, 0, { z: 'a0' })]);
    expect(model.store.getOrder()).toEqual(['c', 'a', 'b']);
  });

  it('所有連線畫在所有非連線物件之上，連線之間依 z 排序', () => {
    const { model } = makeModel([
      rect('a', 0, 0, { z: 'a1' }),
      { type: 'connector', id: 'c2', x: 0, y: 0, w: 1, h: 1, z: 'a0', from: { objectId: null, anchor: null, x: 0, y: 0 }, to: { objectId: null, anchor: null, x: 10, y: 10 } },
      { type: 'connector', id: 'c1', x: 0, y: 0, w: 1, h: 1, z: 'Zz', from: { objectId: null, anchor: null, x: 0, y: 0 }, to: { objectId: null, anchor: null, x: 10, y: 10 } },
      section('S', 0, 0, 100, 100, { z: 'a9' }),
      rect('k', 0, 0, { parentId: 'S', z: 'a0' }),
    ]);
    expect(model.store.getOrder()).toEqual(['a', 'S', 'k', 'c1', 'c2']);
  });

  it('子物件的層級調整只在同一個容器內移動', () => {
    const { model } = makeModel([
      section('S', 0, 0, 600, 400, { z: 'a1' }),
      rect('k1', 0, 0, { parentId: 'S', z: 'a0' }),
      rect('k2', 0, 0, { parentId: 'S', z: 'a1' }),
      rect('top', 0, 0, { z: 'a5' }),
    ]);
    model.bringToFront(['k1']);
    expect(model.store.getOrder()).toEqual(['S', 'k2', 'k1', 'top']);
    expect(model.store.get('k1')!.parentId).toBe('S');
    model.sendToBack(['k1']);
    expect(model.store.getOrder()).toEqual(['S', 'k1', 'k2', 'top']);
    model.bringForward(['k1']);
    expect(model.store.getOrder()).toEqual(['S', 'k2', 'k1', 'top']);
    model.sendBackward(['k1']);
    expect(model.store.getOrder()).toEqual(['S', 'k1', 'k2', 'top']);
  });

  it('調整群組的層級等於移動整個子樹', () => {
    const { model } = makeModel([
      { type: 'group', id: 'G', x: 0, y: 0, w: 300, h: 60, z: 'a0' },
      rect('a', 0, 0, { parentId: 'G', z: 'a0' }),
      rect('b', 200, 0, { parentId: 'G', z: 'a1' }),
      rect('x', 0, 0, { z: 'a1' }),
      rect('y', 0, 0, { z: 'a2' }),
    ]);
    model.bringForward(['G']);
    expect(model.store.getOrder()).toEqual(['x', 'G', 'a', 'b', 'y']);
    model.bringToFront(['G']);
    expect(model.store.getOrder()).toEqual(['x', 'y', 'G', 'a', 'b']);
  });

  it('連線的層級只在連線之間調整', () => {
    const free = (x: number) => ({ objectId: null, anchor: null, x, y: 0 });
    const { model } = makeModel([
      rect('a', 0, 0, { z: 'a9' }),
      { type: 'connector', id: 'c1', x: 0, y: 0, w: 1, h: 1, z: 'a0', from: free(0), to: free(10) },
      { type: 'connector', id: 'c2', x: 0, y: 0, w: 1, h: 1, z: 'a1', from: free(0), to: free(10) },
    ]);
    model.sendToBack(['c2']);
    expect(model.store.getOrder()).toEqual(['a', 'c2', 'c1']);
  });
});

describe('3.3 連線重新路由', () => {
  it('移動容器會讓接在子物件上的連線重新路由', () => {
    const { model } = makeModel([
      section('S', 0, 0, 400, 300),
      rect('a', 20, 20, { parentId: 'S' }),
      rect('b', 800, 20),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, routing: 'straight', from: { objectId: 'a', anchor: 'right' }, to: { objectId: 'b', anchor: 'left' } },
    ]);
    const before = model.routes.get(model.store.get('c') as any).points[0];
    expect(before).toEqual({ x: 120, y: 50 });
    model.moveUnits(['S'], 0, 100);
    const after = model.routes.get(model.store.get('c') as any).points[0];
    expect(after).toEqual({ x: 120, y: 150 });
    expect(model.store.boundsOf('c')!.y).toBeLessThan(150);
  });
});

});
