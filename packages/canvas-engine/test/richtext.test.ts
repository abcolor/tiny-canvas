import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { RICH_TEXT_STYLE, getObjects, readObject, type TextBlock } from '@tinycanvas/shared';
import { layoutRichText, taskCheckboxRect } from '../src/text/layout';
import { drawTextLayout, taskAt, TextLayoutCache } from '../src/render/text';
import { taskItems } from '../src/text/tasks';
import { drawObjects, type RenderContext } from '../src/render/draw';
import { ImageCache } from '../src/render/images';
import { DEFAULT_LABELS } from '../src/types';
import type { EditorModel } from '../src/model';
import { countTransactions, makeModel, mockMeasurer, rect } from './helpers';

const L = (blocks: TextBlock[], maxWidth: number | null = 400, fontSize = 14) => layoutRichText(blocks, { maxWidth, fontSize, fontWeight: 400 }, mockMeasurer);

function mockCtx() {
  const calls: { op: string; args: unknown[]; fillStyle?: unknown; font?: unknown }[] = [];
  const target: Record<string, unknown> = { measureText: (t: string) => ({ width: t.length * 7 }) };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k as string];
      return (...args: unknown[]) => calls.push({ op: String(k), args, fillStyle: t.fillStyle, font: t.font });
    },
    set(t, k, v) {
      t[k as string] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

beforeAll(() => {
  (globalThis as any).Path2D ??= class {
    constructor() {
      return new Proxy(this, { get: (t: any, k) => (k in t ? t[k] : () => {}) });
    }
  };
});

function taskFrag(items: [string, boolean][]): Y.XmlFragment {
  const f = new Y.XmlFragment();
  f.insert(0, [taskListEl(items)]);
  return f;
}

function taskListEl(items: [string, boolean][]): Y.XmlElement {
  const list = new Y.XmlElement('taskList');
  list.insert(
    0,
    items.map(([t, c]) => {
      const it = new Y.XmlElement('taskItem');
      it.setAttribute('checked', c as any);
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText(t)]);
      it.insert(0, [p]);
      return it;
    }),
  );
  return list;
}

describe('行內標記的排版', () => {
  it('刪除線、螢光、行內程式碼各自成段；程式碼用等寬字型 0.9em，前後各 2px 內距', () => {
    const lay = L([
      {
        kind: 'paragraph',
        runs: [{ text: 'ab' }, { text: 'cd', strike: true }, { text: 'ef', highlight: true }, { text: 'gh', highlight: '#ff0000' }, { text: 'ij', code: true }],
      },
    ]);
    const segs = lay.lines[0].segments;
    expect(segs.map((s) => s.text)).toEqual(['ab', 'cd', 'ef', 'gh', 'ij']);
    expect(segs[1].strike).toBe(true);
    expect(segs[2].highlight).toBe(RICH_TEXT_STYLE.highlight);
    expect(segs[3].highlight).toBe('#ff0000');
    const code = segs[4];
    expect(code.code).toBe(true);
    expect(code.font).toContain(RICH_TEXT_STYLE.monoFamily);
    expect(code.font).toContain('12.6px');
    // 前面 4 段每段 2 字 × 7px = 56；程式碼文字起點多 2px 內距，寬度含左右內距
    expect(code.x).toBe(58);
    expect(code.width).toBeCloseTo(2 * 6.3 + 4);
    expect(lay.lines[0].width).toBeCloseTo(56 + 12.6 + 4);
  });

  it('標題使用 RICH_TEXT_STYLE.headingScale', () => {
    const lay = L([1, 2, 3].map((level) => ({ kind: 'heading' as const, level, runs: [{ text: 'H' }] })), 400, 20);
    expect(lay.lines.map((l) => l.fontSize)).toEqual([32, 27, 23]);
  });
});

describe('核取清單', () => {
  it('縮排與項目符號相同（每層 1.3em），方塊 0.9em 置於符號欄中央、第一行垂直置中', () => {
    const lay = L([
      { kind: 'task', depth: 0, checked: true, runs: [{ text: '買牛奶' }] },
      { kind: 'task', depth: 1, checked: false, runs: [{ text: '低脂' }] },
      { kind: 'bullet', depth: 0, runs: [{ text: '一般項目' }] },
    ]);
    const [a, b, c] = lay.lines;
    expect(a.task).toEqual({ ordinal: 0, checked: true });
    expect(b.task).toEqual({ ordinal: 1, checked: false });
    expect(c.task).toBeNull();
    expect(a.indent).toBeCloseTo(c.indent);
    expect(a.indent).toBeCloseTo(18.2);
    expect(b.indent).toBeCloseTo(36.4);
    const r = taskCheckboxRect(a);
    expect(r.size).toBeCloseTo(12.6);
    expect(r.x).toBeCloseTo((18.2 - 12.6) / 2);
    expect(r.y).toBeCloseTo((19.6 - 12.6) / 2);
    expect(taskCheckboxRect(b).x).toBeCloseTo(18.2 + (18.2 - 12.6) / 2);
  });

  it('命中測試考慮對齊與垂直置中', () => {
    const lay = L([{ kind: 'task', checked: false, runs: [{ text: 'x' }] }], 200);
    const box = { x: 100, y: 100, w: 200, h: 100 };
    // 置中對齊：行寬 = 縮排 18.2 + 7 = 25.2 → 左緣 100 + (200 - 25.2) / 2
    const left = 100 + (200 - 25.2) / 2;
    const top = 100 + (100 - 19.6) / 2;
    const r = taskCheckboxRect(lay.lines[0]);
    expect(taskAt(lay, box, 'center', 'middle', { x: left + r.x + 5, y: top + r.y + 5 })).toBe(0);
    expect(taskAt(lay, box, 'center', 'middle', { x: left + 30, y: top + 5 })).toBeNull();
  });

  it('點擊切換 taskItem 的 checked：一個 localOrigin transaction、一步復原', () => {
    const { doc, model } = makeModel([rect('a', 0, 0, { w: 200, h: 100 })]);
    getObjects(doc).get('a')!.set('text', taskFrag([['一', false], ['二', true]]));
    model.stopCapturing();
    expect((model.store.get('a') as any).text.map((b: TextBlock) => b.checked)).toEqual([false, true]);
    const tx = countTransactions(doc);
    const before = model.undoManager.undoStack.length;
    expect(model.toggleTask('a', 'text', undefined, 0)).toBe(true);
    tx.stop();
    expect(tx.list.length).toBe(1);
    expect(model.undoManager.undoStack.length).toBe(before + 1);
    expect((model.store.get('a') as any).text.map((b: TextBlock) => b.checked)).toEqual([true, true]);
    model.undo();
    expect((model.store.get('a') as any).text.map((b: TextBlock) => b.checked)).toEqual([false, true]);
    expect(model.toggleTask('a', 'text', undefined, 5)).toBeNull();
  });

  it('表格儲存格內的核取清單也可以切換', () => {
    const { doc, model } = makeModel([
      { type: 'table', id: 't', x: 0, y: 0, w: 240, h: 40, columns: [{ id: 'c1', width: 240 }], rows: [{ id: 'r1', height: 40 }], headerRow: false },
    ]);
    (getObjects(doc).get('t')!.get('cells') as Y.Map<Y.XmlFragment>).set('r1:c1', taskFrag([['待辦', false]]));
    model.stopCapturing();
    expect(model.toggleTask('t', 'cell', 'r1:c1', 0)).toBe(true);
    expect((readObject(getObjects(doc).get('t')!) as any).cells['r1:c1'][0].checked).toBe(true);
    model.undo();
    expect((readObject(getObjects(doc).get('t')!) as any).cells['r1:c1'][0].checked).toBe(false);
  });

  it('taskItems 的順序與 readRichText 的 task 區塊一致（含巢狀與非 task 清單）', () => {
    const f = new Y.XmlFragment();
    const doc = new Y.Doc();
    doc.getMap('x').set('f', f);
    const clone = taskListEl([['a', false]]);
    f.insert(0, [clone]);
    (clone.get(0) as Y.XmlElement).insert(1, [taskListEl([['b', true]])]);
    const bullet = new Y.XmlElement('bulletList');
    const li = new Y.XmlElement('listItem');
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('c')]);
    li.insert(0, [p]);
    bullet.insert(0, [li]);
    f.insert(1, [bullet]);
    const items = taskItems(f);
    expect(items.length).toBe(2);
    expect(items.map((i) => i.getAttribute('checked'))).toEqual([false, true]);
  });
});

describe('程式碼區塊', () => {
  it('保留空白與換行；過長的行逐字換行；四周 8px 內距', () => {
    const lay = L([{ kind: 'code', runs: [{ text: 'if (a) {\n    return  b;\n}' }] }], null);
    const texts = lay.lines.map((l) => l.segments.map((s) => s.text).join(''));
    expect(texts).toEqual(['if (a) {', '    return  b;', '}']);
    const size = 12.6;
    expect(lay.lines[0].indent).toBe(8);
    expect(lay.lines[0].y).toBe(8);
    const cb = lay.codeBlocks![0];
    expect(cb.y).toBe(0);
    expect(cb.height).toBeCloseTo(16 + 3 * size * 1.4);
    expect(cb.width).toBeCloseTo(14 * 6.3 + 16);
    expect(lay.lines[0].segments[0].font).toContain(RICH_TEXT_STYLE.monoFamily);
    // 寬度限制：可用 50 - 16 = 34px，每字 6.3px → 每行 5 字，不在空白處斷
    const wrapped = L([{ kind: 'code', runs: [{ text: 'abc defghij' }] }], 50);
    expect(wrapped.lines.map((l) => l.segments.map((s) => s.text).join(''))).toEqual(['abc d', 'efghi', 'j']);
  });

  it('與段落混合時依序堆疊，Tab 視為 4 個空白', () => {
    const lay = L([
      { kind: 'paragraph', runs: [{ text: 'x' }] },
      { kind: 'code', runs: [{ text: '\ty' }] },
      { kind: 'paragraph', runs: [{ text: 'z' }] },
    ]);
    expect(lay.codeBlocks![0].y).toBeCloseTo(19.6);
    expect(lay.lines[1].segments[0].text).toBe('    y');
    expect(lay.lines[2].y).toBeCloseTo(19.6 + 16 + 12.6 * 1.4);
  });
});

describe('繪製', () => {
  const blocks: TextBlock[] = [
    { kind: 'heading', level: 1, runs: [{ text: '標題' }] },
    { kind: 'paragraph', runs: [{ text: 'a', strike: true }, { text: 'b', code: true }, { text: 'c', highlight: true }] },
    { kind: 'task', depth: 0, checked: true, runs: [{ text: '完成' }] },
    { kind: 'task', depth: 0, checked: false, runs: [{ text: '未完成' }] },
    { kind: 'code', runs: [{ text: 'let x = 1;\nx++;' }] },
  ];

  it('畫出程式碼底色、螢光、行內程式碼底色、勾選的方塊（填色）、刪除線', () => {
    const lay = L(blocks, 300);
    const { ctx, calls } = mockCtx();
    drawTextLayout(ctx, lay, { x: 0, y: 0, w: 300, h: lay.height }, { color: '#000', align: 'left', valign: 'top', zoom: 1 });
    const fills = calls.filter((c) => c.op === 'fill').map((c) => c.fillStyle);
    expect(fills).toContain(RICH_TEXT_STYLE.codeBlockBg);
    expect(fills).toContain(RICH_TEXT_STYLE.inlineCodeBg);
    expect(fills).toContain(RICH_TEXT_STYLE.checkboxChecked);
    const rects = calls.filter((c) => c.op === 'fillRect').map((c) => c.fillStyle);
    expect(rects).toContain(RICH_TEXT_STYLE.highlight);
    expect(rects).toContain('#000'); // 刪除線
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(texts).toEqual(expect.arrayContaining(['標題', 'a', 'b', 'c', '完成', '未完成', 'let x = 1;', 'x++;']));
  });

  it('形狀與文字物件在各縮放（含低細節）與匯出時都能繪製', () => {
    const { doc, model } = makeModel([rect('a', 0, 0, { w: 300, h: 300 }), { type: 'text', id: 't', x: 0, y: 400, w: 100, h: 20 }], { measurer: mockMeasurer });
    for (const id of ['a', 't']) getObjects(doc).get(id)!.set('text', taskFrag([['x', true]]));
    const rc = (zoom: number, exporting = false): RenderContext => ({
      zoom,
      get: model.store.getter,
      routes: (model as EditorModel).routes,
      text: new TextLayoutCache(mockMeasurer, null),
      images: new ImageCache(undefined, () => {}),
      labels: DEFAULT_LABELS,
      editing: null,
      canOpenLinks: false,
      invalidate: () => {},
      exporting,
    });
    for (const [z, ex] of [[1, false], [0.1, false], [2, true]] as const) {
      const { ctx } = mockCtx();
      expect(() => drawObjects(ctx, Array.from(model.store.objects.values()), rc(z, ex))).not.toThrow();
    }
  });
});

describe('大字級', () => {
  it('128px 的自由文字自動決定寬度與高度', () => {
    const { model } = makeModel([], { measurer: mockMeasurer });
    const id = model.insert({ type: 'text', x: 0, y: 0, w: 10, h: 10, text: 'Big 大', style: { fontSize: 128 } });
    const o = model.store.get(id)!;
    // 'Big ' 4 × 64 + '大' 128 = 384，加 4px 游標空間
    expect(o.w).toBe(388);
    expect(o.h).toBeCloseTo(128 * 1.4);
  });

  it('128px 的形狀文字讓形狀自動增高', () => {
    const { model } = makeModel([], { measurer: mockMeasurer });
    const id = model.insert({ type: 'shape', x: 0, y: 0, w: 400, h: 80, shapeKind: 'rectangle', text: '大字', style: { fontSize: 128 } });
    expect(model.store.get(id)!.h).toBeGreaterThanOrEqual(128 * 1.4 + 16);
  });
});
