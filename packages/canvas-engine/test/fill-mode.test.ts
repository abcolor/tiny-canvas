import { describe, expect, it } from 'vitest';
import type { BoardObject, Style } from '@tinycanvas/shared';
import { DEFAULT_PALETTE, mixWithWhite, parseHex, resolveStyle } from '../src/style';
import { makeModel } from './helpers';

const shape = (style: Style): BoardObject => ({
  type: 'shape',
  id: Math.random().toString(36),
  x: 0,
  y: 0,
  w: 100,
  h: 60,
  rotation: 0,
  z: 'a0',
  parentId: null,
  locked: false,
  style,
  shapeKind: 'rectangle',
  icon: null,
  iconPosition: 'top',
  autoHeight: true,
  text: [],
});

describe('形狀外觀（填滿 / 外框 / 虛線外框、透明背景）', () => {
  it('外框（自訂顏色）：非透明時背景為外框色 21% 混 79% 白色的不透明淡色', () => {
    const st = resolveStyle(shape({ fillMode: 'outline', stroke: '#2a9687' }));
    expect(st.fill).toBe(mixWithWhite(parseHex('#2a9687')!, 0.79));
    expect(st.stroke).toBe('#2a9687');
    expect(st.strokeStyle).toBe('solid');
  });

  it('外框、虛線外框：透明時沒有背景', () => {
    expect(resolveStyle(shape({ fillMode: 'outline', stroke: '#2a9687', transparent: true })).fill).toBe('transparent');
    expect(resolveStyle(shape({ fillMode: 'dashed', stroke: '#2a9687', transparent: true })).fill).toBe('transparent');
  });

  it('整個填滿不受透明開關與舊的半透明欄位影響', () => {
    const solidFill = mixWithWhite(parseHex('#2f3a45')!, 0.79);
    expect(resolveStyle(shape({ fillMode: 'solid', stroke: '#2f3a45', transparent: true })).fill).toBe(solidFill);
    expect(resolveStyle(shape({ fillMode: 'solid', stroke: '#2f3a45', translucent: true })).fill).toBe(solidFill);
    expect(resolveStyle(shape({ fillMode: 'outline', stroke: '#2a9687', translucent: true })).fill).toBe(mixWithWhite(parseHex('#2a9687')!, 0.79));
  });

  it('虛線外框使用虛線', () => {
    const st = resolveStyle(shape({ fillMode: 'dashed', stroke: '#4a7fd4' }));
    expect(st.strokeStyle).toBe('dashed');
    expect(st.fill).toBe(mixWithWhite(parseHex('#4a7fd4')!, 0.79));
  });

  it('填滿（自訂顏色）：背景與只有外框時相同、沒有邊緣；文字依背景亮度自動選色', () => {
    const bg = mixWithWhite(parseHex('#2f3a45')!, 0.79);
    expect(resolveStyle(shape({ fillMode: 'solid', stroke: '#2f3a45' }))).toMatchObject({ fill: bg, stroke: bg, textColor: '#1f2933' });
    expect(resolveStyle(shape({ fillMode: 'solid', stroke: '#fcf7d6' })).textColor).not.toBe('#ffffff');
    // 使用者指定的文字色優先
    expect(resolveStyle(shape({ fillMode: 'solid', stroke: '#2f3a45', textColor: '#ff0000' })).textColor).toBe('#ff0000');
  });

  it('未設定外觀的形狀維持原本的 fill / stroke（舊畫布不變）', () => {
    const st = resolveStyle(shape({ fill: '#ffffff', stroke: '#46525e' }));
    expect(st.fill).toBe('#ffffff');
    expect(st.stroke).toBe('#46525e');
  });
});

// 調色盤（使用者指定，DECISIONS.md 2026-10-15）：色塊顯示色、選擇後的外框色與背景色
const TABLE: [string, string, string][] = [
  ['#FFFFFF', '#C6CFD9', '#FFFFFF'],
  ['#D7DDE4', '#C6CFD9', '#F3F5F7'],
  ['#A3ACB5', '#A2ACB9', '#E2E5EB'],
  ['#848E97', '#7C8796', '#D0D8DF'],
  ['#78AADE', '#4685D1', '#D8E6F5'],
  ['#938CF0', '#635BEA', '#E0DEFB'],
  ['#945BCE', '#691ABC', '#E0D0F0'],
  ['#C577DA', '#AF41CC', '#EED8F4'],
  ['#7FC4BD', '#56ACA0', '#D9EEEC'],
  ['#63A09A', '#34786F', '#D0E3E2'],
  ['#ABA391', '#867B62', '#E6E4DF'],
  ['#B99796', '#9B6A68', '#EBE1E1'],
  ['#D5838D', '#C5515E', '#F2DBDE'],
  ['#E5AC7F', '#DA894C', '#F7E7DA'],
  ['#F0D78F', '#E9C764', '#FAF3DE'],
];

describe('調色盤', () => {
  it('15 色的排列與色碼和使用者指定的表格一致', () => {
    expect(DEFAULT_PALETTE.map((p) => [p.color, p.border, p.background].map((c) => c.toUpperCase()))).toEqual(TABLE);
  });

  it('選擇色塊後，形狀的外框與背景使用對應的顏色（只有外框、虛線外框，不透明）', () => {
    for (const [swatch, border, background] of TABLE) {
      for (const fillMode of ['outline', 'dashed'] as const) {
        const st = resolveStyle(shape({ fillMode, stroke: swatch }));
        expect([st.stroke, st.fill].map((c) => c.toUpperCase()), swatch).toEqual([border, background]);
      }
    }
  });

  it('白色與第二格的外框色相同，但背景各自正確', () => {
    expect(resolveStyle(shape({ fillMode: 'outline', stroke: '#ffffff' })).fill).toBe('#ffffff');
    expect(resolveStyle(shape({ fillMode: 'outline', stroke: '#d7dde4' })).fill).toBe('#f3f5f7');
  });

  it('透明時沒有背景，外框照樣對應', () => {
    expect(resolveStyle(shape({ fillMode: 'outline', stroke: '#78aade', transparent: true }))).toMatchObject({ fill: 'transparent', stroke: '#4685d1' });
  });

  it('整個填滿：背景與只有外框時相同，沒有邊緣（邊框與背景同色）', () => {
    for (const [swatch, , background] of TABLE) {
      const st = resolveStyle(shape({ fillMode: 'solid', stroke: swatch }));
      expect([st.fill, st.stroke].map((c) => c.toUpperCase()), swatch).toEqual([background, background]);
    }
  });

  it('新形狀（未指定顏色）使用白色：外框 #C6CFD9、背景 #FFFFFF', () => {
    expect(resolveStyle(shape({ fillMode: 'outline' }))).toMatchObject({ stroke: '#c6cfd9', fill: '#ffffff' });
  });
});

import { roundedRadius, shapeTextBox } from '../src/render/shapes';

describe('圓角矩形的圓角半徑', () => {
  it('W > H 時為 H / 2；H >= W 時為 W / 2', () => {
    expect(roundedRadius(200, 80)).toBe(40);
    expect(roundedRadius(80, 200)).toBe(40);
    expect(roundedRadius(100, 100)).toBe(50);
  });
  it('文字框避開兩端的半圓', () => {
    const wide = shapeTextBox('rounded', 0, 0, 200, 80);
    expect(wide.x).toBeGreaterThanOrEqual(18);
    const tall = shapeTextBox('rounded', 0, 0, 80, 200);
    expect(tall.y).toBeGreaterThanOrEqual(18);
  });
});

// 新形狀預設「只有外框、不透明背景」（DECISIONS.md 2026-10-15）
describe('新形狀的預設外觀', () => {
  it('建立時存入只有外框、不透明背景：預設白色，外框 #C6CFD9、背景 #FFFFFF', () => {
    const { model } = makeModel([]);
    const id = model.insert({ type: 'shape', x: 0, y: 0, w: 100, h: 60 });
    const o = model.store.get(id)!;
    expect(o.style).toMatchObject({ fillMode: 'outline', transparent: false });
    expect(resolveStyle(o)).toMatchObject({ stroke: '#c6cfd9', fill: '#ffffff' });
  });

  it('切換成虛線外框時背景不變', () => {
    const { model } = makeModel([]);
    const id = model.insert({ type: 'shape', x: 0, y: 0, w: 100, h: 60 });
    model.setStyle({ fillMode: 'dashed' }, [id]);
    const o = model.store.get(id)!;
    expect(o.style).toMatchObject({ fillMode: 'dashed', transparent: false });
    expect(resolveStyle(o)).toMatchObject({ fill: '#ffffff', strokeStyle: 'dashed' });
  });

  it('有指定外觀時照指定的；其他物件類型不受影響', () => {
    const { model } = makeModel([]);
    const solid = model.insert({ type: 'shape', x: 0, y: 0, w: 100, h: 60, style: { fillMode: 'solid' } });
    expect(model.store.get(solid)!.style).toEqual({ fillMode: 'solid', strokeWidth: 3 });
    const wf = model.insert({ type: 'wireframe', x: 0, y: 0, w: 100, h: 60, componentKind: 'button' } as any);
    expect(model.store.get(wf)!.style?.fillMode).toBeUndefined();
  });
});
