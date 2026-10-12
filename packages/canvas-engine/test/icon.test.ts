import { beforeAll, describe, expect, it } from 'vitest';
import { getObjects, localOrigin, readObject } from '@tinycanvas/shared';
import { countTransactions, makeModel, mockMeasurer, raw } from './helpers';
import { getRenderer, type RenderContext } from '../src/render/draw';
import { TextLayoutCache } from '../src/render/text';
import { ImageCache } from '../src/render/images';
import { DEFAULT_LABELS } from '../src/types';
import type { EditorModel } from '../src/model';

function mockCtx() {
  const calls: string[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k as string];
      return () => calls.push(String(k));
    },
    set(t, k, v) {
      t[k as string] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, target };
}

beforeAll(() => {
  (globalThis as any).Path2D ??= class {
    constructor() {
      return new Proxy(this, { get: (t: any, k) => (k in t ? t[k] : () => {}) });
    }
  };
});

function rc(model: EditorModel, zoom = 1): RenderContext {
  return {
    zoom,
    get: model.store.getter,
    routes: model.routes,
    text: new TextLayoutCache(mockMeasurer, null),
    images: new ImageCache(undefined, () => {}),
    labels: DEFAULT_LABELS,
    editing: null,
    canOpenLinks: false,
    invalidate: () => {},
  };
}

describe('獨立圖示物件', () => {
  it('以 Lucide 路徑描邊繪製，顏色與線寬取自樣式', () => {
    const { model, doc } = makeModel([
      { type: 'icon', id: 'i', x: 0, y: 0, w: 48, h: 48, iconName: 'Database', style: { stroke: '#1f786d', strokeWidth: 1.5 } },
    ]);
    const o = readObject(getObjects(doc).get('i')!)!;
    const { ctx, calls, target } = mockCtx();
    getRenderer('icon').draw(ctx, o, rc(model));
    expect(calls).toContain('stroke');
    expect(target.strokeStyle).toBe('#1f786d');
    expect(target.lineWidth).toBe(1.5);
  });

  it('太小或尚未載入時畫成淡色方塊，不丟出例外', () => {
    const { model, doc } = makeModel([{ type: 'icon', id: 'i', x: 0, y: 0, w: 48, h: 48, iconName: 'NotARealIcon' }]);
    const o = readObject(getObjects(doc).get('i')!)!;
    const { ctx, calls } = mockCtx();
    getRenderer('icon').draw(ctx, o, rc(model, 0.05));
    expect(calls).toContain('fillRect');
  });

  it('只能等比縮放，命中測試以世界座標涵蓋整個方框', () => {
    const { model, doc } = makeModel([{ type: 'icon', id: 'i', x: 200, y: 100, w: 48, h: 48, iconName: 'Star' }]);
    expect(model.mustScaleProportionally(['i'])).toBe(true);
    const o = readObject(getObjects(doc).get('i')!)!;
    const hit = (x: number, y: number, tol = 0) => getRenderer('icon').hitTest!(o, { x, y }, rc(model), tol);
    expect(hit(224, 124)).toBe(true);
    expect(hit(201, 147)).toBe(true);
    expect(hit(10, 10)).toBe(false);
    expect(hit(250, 124)).toBe(false);
    expect(hit(250, 124, 4)).toBe(true);
  });
});

describe('圖示旋轉 90 度按鈕', () => {
  it('每按一次各自繞自身中心旋轉 90 度，多選時一次 transaction、位置不變', () => {
    const { model, doc } = makeModel([
      { type: 'icon', id: 'a', x: 0, y: 0, w: 48, h: 48, iconName: 'Star' },
      { type: 'icon', id: 'b', x: 200, y: 0, w: 48, h: 48, iconName: 'Star', z: 'a1' },
    ]);
    const tx = countTransactions(doc);
    model.rotateEach(90, ['a', 'b']);
    tx.stop();
    expect(tx.list).toEqual([localOrigin]);
    expect(raw(doc, 'a')).toMatchObject({ x: 0, y: 0, rotation: 90 });
    expect(raw(doc, 'b')).toMatchObject({ x: 200, y: 0, rotation: 90 });
    for (let i = 0; i < 3; i++) model.rotateEach(90, ['a']);
    expect(raw(doc, 'a')!.rotation).toBe(0);
  });

  it('鎖定的圖示不旋轉', () => {
    const { model, doc } = makeModel([{ type: 'icon', id: 'a', x: 0, y: 0, w: 48, h: 48, iconName: 'Star', locked: true }]);
    model.rotateEach(90, ['a']);
    expect(raw(doc, 'a')!.rotation).toBe(0);
  });
});
