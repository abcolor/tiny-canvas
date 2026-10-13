import { describe, expect, it } from 'vitest';
import { countTransactions, makeModel, rect, section } from './helpers';

// 形狀內的物件跟著形狀一起移動（SPEC.md 第 3.3 節「形狀內的物件」）
const box = (id: string, x: number, y: number, w: number, h: number, z: string, extra = {}) =>
  rect(id, x, y, { w, h, z, ...extra });

function moveWithCarried(model: ReturnType<typeof makeModel>['model'], ids: string[], dx: number, dy: number) {
  model.moveUnits([...ids, ...model.carriedUnits(ids)], dx, dy);
}

describe('形狀內的物件跟著形狀移動', () => {
  it('完整在範圍內、畫在上方的物件一起移動', () => {
    const { model } = makeModel([box('A', 0, 0, 300, 200, 'a0'), box('B', 20, 20, 60, 40, 'a1'), { type: 'icon', id: 'I', x: 200, y: 100, w: 48, h: 48, z: 'a2', iconName: 'Star' }]);
    expect(model.carriedUnits(['A']).sort()).toEqual(['B', 'I']);
    moveWithCarried(model, ['A'], 100, 50);
    expect(model.store.get('B')).toMatchObject({ x: 120, y: 70 });
    expect(model.store.get('I')).toMatchObject({ x: 300, y: 150 });
  });

  it('只有部分重疊的物件不會被帶走', () => {
    const { model } = makeModel([box('A', 0, 0, 300, 200, 'a0'), box('C', 250, 150, 100, 100, 'a1')]);
    expect(model.carriedUnits(['A'])).toEqual([]);
  });

  it('畫在形狀下方的物件不會被帶走', () => {
    const { model } = makeModel([box('A', 0, 0, 300, 200, 'a1'), box('Under', 20, 20, 60, 40, 'a0')]);
    expect(model.carriedUnits(['A'])).toEqual([]);
  });

  it('多層：形狀裡的形狀，再帶走它裡面的物件', () => {
    const { model } = makeModel([
      box('A', 0, 0, 400, 300, 'a0'),
      box('D', 20, 20, 200, 150, 'a1'),
      box('E', 40, 40, 40, 40, 'a2'),
    ]);
    expect(model.carriedUnits(['A']).sort()).toEqual(['D', 'E']);
    moveWithCarried(model, ['A'], 10, 0);
    expect(model.store.get('E')!.x).toBe(50);
  });

  it('群組以整個群組為單位帶走', () => {
    const { model } = makeModel([
      box('A', 0, 0, 400, 300, 'a0'),
      box('g1', 20, 20, 40, 40, 'a1'),
      box('g2', 100, 20, 40, 40, 'a2'),
    ]);
    model.setSelection(['g1', 'g2']);
    model.group();
    const g = model.selection[0];
    expect(model.carriedUnits(['A'])).toEqual([g]);
    moveWithCarried(model, ['A'], 0, 30);
    expect(model.store.get('g1')!.y).toBe(50);
    expect(model.store.get('g2')!.y).toBe(50);
  });

  it('鎖定的物件、連線、旋轉過的形狀都不帶走', () => {
    const { model } = makeModel([
      box('A', 0, 0, 300, 200, 'a0'),
      box('L', 20, 20, 40, 40, 'a1', { locked: true }),
      box('R', 0, 300, 300, 200, 'a2', { rotation: 30 }),
      box('RIn', 100, 350, 40, 40, 'a3'),
    ]);
    expect(model.carriedUnits(['A'])).toEqual([]);
    expect(model.carriedUnits(['R'])).toEqual([]);
  });

  it('物件本身也在選取中時不會重複移動', () => {
    const { model } = makeModel([box('A', 0, 0, 300, 200, 'a0'), box('B', 20, 20, 60, 40, 'a1')]);
    expect(model.carriedUnits(['A', 'B'])).toEqual([]);
    moveWithCarried(model, ['A', 'B'], 10, 0);
    expect(model.store.get('B')!.x).toBe(30);
  });

  it('區塊內的形狀帶走同一區塊內的物件，整個移動是一次復原步驟', () => {
    const { model } = makeModel([
      section('S', 0, 0, 800, 600),
      box('A', 100, 100, 300, 200, 'a1', { parentId: 'S' }),
      box('B', 120, 120, 60, 40, 'a2', { parentId: 'S' }),
    ]);
    expect(model.carriedUnits(['A'])).toEqual(['B']);
    model.stopCapturing();
    moveWithCarried(model, ['A'], 40, 0);
    expect(model.store.get('B')).toMatchObject({ x: 160, parentId: 'S' });
    model.undo();
    expect(model.store.get('A')!.x).toBe(100);
    expect(model.store.get('B')!.x).toBe(120);
  });
});

// 複製形狀時，形狀內的物件一起複製（DECISIONS.md 2026-10-13）
describe('複製形狀時一起複製形狀內的物件', () => {
  const board = () =>
    makeModel([
      box('A', 0, 0, 400, 300, 'a0'),
      box('D', 20, 20, 200, 150, 'a1'),
      box('E', 40, 40, 40, 40, 'a2'),
      { type: 'icon', id: 'I', x: 300, y: 200, w: 48, h: 48, z: 'a3', iconName: 'Star' },
      box('Out', 600, 0, 50, 50, 'a4'),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'D', anchor: 'right' }, to: { objectId: 'I', anchor: 'left' } },
    ]);

  it('Mod+D：多層的形狀內物件與它們之間的連線都複製，只選取形狀的複本，一步復原', () => {
    const { model } = board();
    model.setSelection(['A']);
    model.stopCapturing();
    const before = model.store.objects.size;
    const tops = model.duplicate();
    model.stopCapturing();
    // A、D、E、I、連線 c 各一份；外面的 Out 不複製
    expect(model.store.objects.size).toBe(before + 5);
    expect(tops).toHaveLength(1);
    expect(model.selection).toEqual(tops);
    const copy = model.store.get(tops[0])!;
    expect(copy).toMatchObject({ type: 'shape', x: 16, y: 16, w: 400, h: 300 });
    // 複本的形狀內物件仍在複本範圍內、畫在上方，之後移動複本時會一起帶走
    expect(model.carriedUnits(tops)).toHaveLength(3);
    const conn = [...model.store.objects.values()].find((o) => o.type === 'connector' && o.id !== 'c') as any;
    expect(conn.from.objectId).not.toBe('D');
    expect(conn.to.objectId).not.toBe('I');
    model.undo();
    expect(model.store.objects.size).toBe(before);
    expect([...model.store.objects.keys()].sort()).toEqual(['A', 'D', 'E', 'I', 'Out', 'c']);
  });

  it('複製到剪貼簿再貼上：形狀內物件一起貼上，只選取形狀的複本', () => {
    const { model } = board();
    const data = model.serialize(['A'])!;
    const payload = JSON.parse(data);
    expect(payload.carried.sort()).toEqual(['D', 'E', 'I', 'c']);
    expect(payload.objects.map((o: any) => o.id).sort()).toEqual(['A', 'D', 'E', 'I', 'c']);
    const tops = model.paste(data, { at: { x: 1000, y: 1000 } });
    expect(tops).toHaveLength(1);
    expect(model.selection).toEqual(tops);
    expect(model.carriedUnits(tops)).toHaveLength(3);
  });

  it('放置複本的預覽也包含形狀內物件', () => {
    const { model } = board();
    model.setSelection(['A']);
    const p = model.preparePlacement()!;
    expect(p.objects.map((o) => o.id).sort()).toEqual(['A', 'D', 'E', 'I', 'c']);
    expect(p.bounds).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it('沒有形狀內物件時，剪貼簿不寫入 carried，貼上後照舊選取全部頂層（含兩端都在複製範圍內的連線）', () => {
    const { model } = board();
    const payload = JSON.parse(model.serialize(['Out', 'I'])!);
    expect(payload.carried).toBeUndefined();
    const tops = model.paste(JSON.stringify(payload), { at: { x: 1000, y: 1000 } });
    expect(tops).toHaveLength(2);
    expect(model.selection.sort()).toEqual(tops.sort());
  });
});

// 刪除形狀時，形狀內的物件一起刪除（DECISIONS.md 2026-10-13）
describe('刪除形狀時一起刪除形狀內的物件', () => {
  it('多層的形狀內物件與接在它們上面的連線都刪除，一個 transaction、一步復原', () => {
    const { doc, model } = makeModel([
      box('A', 0, 0, 400, 300, 'a0'),
      box('D', 20, 20, 200, 150, 'a1'),
      box('E', 40, 40, 40, 40, 'a2'),
      { type: 'icon', id: 'I', x: 300, y: 200, w: 48, h: 48, z: 'a3', iconName: 'Star' },
      box('Out', 600, 0, 50, 50, 'a4'),
      { type: 'connector', id: 'c', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'I', anchor: 'right' }, to: { objectId: 'Out', anchor: 'left' } },
    ]);
    model.setSelection(['A']);
    model.stopCapturing();
    const before = model.undoManager.undoStack.length;
    const tx = countTransactions(doc);
    model.deleteIds(['A']);
    tx.stop();
    model.stopCapturing();
    expect(tx.list).toHaveLength(1);
    expect([...model.store.objects.keys()]).toEqual(['Out']);
    expect(model.selection).toEqual([]);
    expect(model.undoManager.undoStack.length).toBe(before + 1);
    model.undo();
    expect([...model.store.objects.keys()].sort()).toEqual(['A', 'D', 'E', 'I', 'Out', 'c']);
  });

  it('不在範圍內、畫在下方或鎖定的物件不刪除', () => {
    const { model } = makeModel([
      box('A', 0, 0, 300, 200, 'a1'),
      box('Under', 20, 20, 60, 40, 'a0'),
      box('Partial', 250, 150, 100, 100, 'a2'),
      box('Locked', 100, 100, 40, 40, 'a3', { locked: true }),
    ]);
    model.deleteIds(['A']);
    expect([...model.store.objects.keys()].sort()).toEqual(['Locked', 'Partial', 'Under']);
  });
});
