import { describe, expect, it } from 'vitest';
import type { BoardObject, Style } from '@tinycanvas/shared';
import { mixWithWhite, parseHex, resolveStyle } from '../src/style';
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
  it('外框：非透明時背景為外框色 30% 的不透明淡色', () => {
    const st = resolveStyle(shape({ fillMode: 'outline', stroke: '#2a9687' }));
    expect(st.fill).toBe(mixWithWhite(parseHex('#2a9687')!, 0.7));
    expect(st.fill).toBe('#bfe0db');
    expect(st.strokeStyle).toBe('solid');
  });

  it('外框、虛線外框：透明時沒有背景', () => {
    expect(resolveStyle(shape({ fillMode: 'outline', stroke: '#2a9687', transparent: true })).fill).toBe('transparent');
    expect(resolveStyle(shape({ fillMode: 'dashed', stroke: '#2a9687', transparent: true })).fill).toBe('transparent');
  });

  it('整個填滿不受透明開關與舊的半透明欄位影響', () => {
    expect(resolveStyle(shape({ fillMode: 'solid', stroke: '#2f3a45', transparent: true })).fill).toBe('#2f3a45');
    expect(resolveStyle(shape({ fillMode: 'solid', stroke: '#2f3a45', translucent: true })).fill).toBe('#2f3a45');
    expect(resolveStyle(shape({ fillMode: 'outline', stroke: '#2a9687', translucent: true })).fill).toBe('#bfe0db');
  });

  it('虛線外框使用虛線', () => {
    const st = resolveStyle(shape({ fillMode: 'dashed', stroke: '#4a7fd4' }));
    expect(st.strokeStyle).toBe('dashed');
    expect(st.fill).toBe(mixWithWhite(parseHex('#4a7fd4')!, 0.7));
  });

  it('填滿：背景即外框色，深色時文字自動為白色、淺色時為深色', () => {
    expect(resolveStyle(shape({ fillMode: 'solid', stroke: '#2f3a45' }))).toMatchObject({ fill: '#2f3a45', textColor: '#ffffff' });
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

// 新形狀預設「只有外框＋透明背景」（DECISIONS.md 2026-10-15）
describe('新形狀的預設外觀', () => {
  it('建立時存入只有外框、透明背景；背景確實透明', () => {
    const { model } = makeModel([]);
    const id = model.insert({ type: 'shape', x: 0, y: 0, w: 100, h: 60 });
    const o = model.store.get(id)!;
    expect(o.style).toMatchObject({ fillMode: 'outline', transparent: true });
    expect(resolveStyle(o).fill).toBe('transparent');
  });

  it('切換成虛線外框時維持透明', () => {
    const { model } = makeModel([]);
    const id = model.insert({ type: 'shape', x: 0, y: 0, w: 100, h: 60 });
    model.setStyle({ fillMode: 'dashed' }, [id]);
    const o = model.store.get(id)!;
    expect(o.style).toMatchObject({ fillMode: 'dashed', transparent: true });
    expect(resolveStyle(o).fill).toBe('transparent');
    expect(resolveStyle(o).strokeStyle).toBe('dashed');
  });

  it('有指定外觀時照指定的；其他物件類型不受影響', () => {
    const { model } = makeModel([]);
    const solid = model.insert({ type: 'shape', x: 0, y: 0, w: 100, h: 60, style: { fillMode: 'solid' } });
    expect(model.store.get(solid)!.style).toEqual({ fillMode: 'solid', strokeWidth: 3 });
    const wf = model.insert({ type: 'wireframe', x: 0, y: 0, w: 100, h: 60, componentKind: 'button' } as any);
    expect(model.store.get(wf)!.style?.fillMode).toBeUndefined();
  });
});
