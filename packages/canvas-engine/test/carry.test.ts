import { describe, expect, it } from 'vitest';
import { makeModel, rect, section } from './helpers';

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
