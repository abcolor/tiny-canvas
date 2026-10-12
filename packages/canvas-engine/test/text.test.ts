import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { getObjects } from '@tinycanvas/shared';
import { breakLines, layoutRichText, plainBlocks } from '../src/text/layout';
import { FontLoader } from '../src/text/measure';
import { makeModel, mockMeasurer, rect } from './helpers';

// 每個字元寬 10（CJK 與 Latin 相同），方便計算
const m10 = (s: string) => Array.from(s).length * 10;

describe('斷行', () => {
  it('Latin：在單字邊界斷行，不切開單字', () => {
    expect(breakLines('hello world foo', 110, m10)).toEqual(['hello world', 'foo']);
    expect(breakLines('hello world foo', 60, m10)).toEqual(['hello', 'world', 'foo']);
  });

  it('過長的單字逐字切開', () => {
    expect(breakLines('abcdefghij', 40, m10)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('CJK：任何字元之間都可以斷行', () => {
    expect(breakLines('流程圖白板工具', 30, m10)).toEqual(['流程圖', '白板工', '具']);
  });

  it('避頭：，。、；：？！）」』 等不出現在行首', () => {
    // 寬度 40 可以放 4 個字：「我們走吧，」的逗號不能在下一行行首
    expect(breakLines('我們走吧，好嗎', 40, m10)).toEqual(['我們走', '吧，好嗎']);
    expect(breakLines('一二三。」四', 30, m10)).toEqual(['一二', '三。」', '四']);
    for (const p of ['，', '。', '、', '；', '：', '？', '！', '）', '」', '』']) {
      const lines = breakLines(`甲乙丙${p}丁`, 30, m10);
      for (const l of lines) expect(l.startsWith(p)).toBe(false);
    }
  });

  it('避尾：「（ 不出現在行尾', () => {
    const lines = breakLines('甲乙「丙丁」', 30, m10);
    for (const l of lines) expect(l.endsWith('「')).toBe(false);
    expect(lines).toEqual(['甲乙', '「丙', '丁」']);
    expect(breakLines('甲乙丙（丁', 40, m10)).toEqual(['甲乙丙', '（丁']);
  });

  it('中英混排：英文單字不被切開，CJK 與英文之間可以斷行', () => {
    expect(breakLines('使用TinyCanvas畫圖', 100, m10)).toEqual(['使用', 'TinyCanvas', '畫圖']);
    expect(breakLines('使用TinyCanvas畫圖', 120, m10)).toEqual(['使用TinyCanvas', '畫圖']);
  });

  it('換行字元強制斷行', () => {
    expect(breakLines('ab\ncd', 1000, m10)).toEqual(['ab', 'cd']);
  });
});

describe('富文本排版', () => {
  it('標題字級較大、列表有縮排與符號、粗體使用 700', () => {
    const lay = layoutRichText(
      [
        { kind: 'heading', level: 1, runs: [{ text: 'Title' }] },
        { kind: 'bullet', depth: 0, runs: [{ text: 'item ' }, { text: 'bold', bold: true }] },
        { kind: 'ordered', depth: 1, index: 2, runs: [{ text: 'two' }] },
        { kind: 'paragraph', runs: [{ text: 'link', link: 'https://x' }] },
      ],
      { maxWidth: 400, fontSize: 14, fontWeight: 400 },
      mockMeasurer,
    );
    expect(lay.lines.length).toBe(4);
    expect(lay.lines[0].fontSize).toBe(22.4); // headingScale[1] = 1.6
    expect(lay.lines[0].segments[0].bold).toBe(true);
    expect(lay.lines[1].marker).toBe('•');
    expect(lay.lines[1].indent).toBeCloseTo(18.2); // 1.3em
    expect(lay.lines[1].segments.map((s) => s.bold)).toEqual([false, true]);
    expect(lay.lines[2].marker).toBe('2.');
    expect(lay.lines[2].indent).toBeCloseTo(36.4); // 第二層 2 × 1.3em
    expect(lay.lines[3].segments[0].link).toBe('https://x');
    expect(lay.height).toBeCloseTo(22.4 * 1.4 + 14 * 1.4 * 3, 5);
  });

  it('自動寬度（maxWidth null）不換行', () => {
    const lay = layoutRichText(plainBlocks('一段很長很長很長很長很長的文字'), { maxWidth: null, fontSize: 10, fontWeight: 400 }, mockMeasurer);
    expect(lay.lines.length).toBe(1);
    expect(lay.width).toBe(150);
  });
});

describe('文字自動尺寸', () => {
  it('形狀文字超過高度時自動增高（localOrigin，與打字同一步復原）', () => {
    const editorKey = { name: 'ySync' };
    const { doc, model } = makeModel([rect('a', 0, 0, { w: 100, h: 48, text: '短' })], { measurer: mockMeasurer, extraTrackedOrigins: [editorKey] });
    doc.transact(() => {
      const f = getObjects(doc).get('a')!.get('text') as Y.XmlFragment;
      const t = (f.get(0) as Y.XmlElement).get(0) as Y.XmlText;
      t.insert(1, '這是一段很長的文字，會超過形狀原本的高度，所以形狀應該要自動長高才對');
    }, editorKey);
    expect(model.store.get('a')!.h).toBeGreaterThan(48);
    expect(model.store.get('a')!.h % 8).toBe(0);
    expect(model.undoManager.undoStack.length).toBe(1);
    model.undo();
    expect(model.store.get('a')!.h).toBe(48);
  });

  it('文字物件：自動寬度；固定寬度時換行並調整高度', () => {
    const { model } = makeModel([], { measurer: mockMeasurer });
    const id = model.insert({ type: 'text', x: 0, y: 0, w: 10, h: 10, text: 'hello' });
    expect(model.store.get(id)!.w).toBe(5 * 7 + 4);
    model.updateObject(id, { fixedWidth: true, w: 20 });
    const o = model.store.get(id)!;
    expect(o.w).toBe(20);
    expect(o.h).toBeGreaterThan(14 * 1.4);
  });
});

describe('字型按需載入', () => {
  it('新字元送出 document.fonts.load，同一批合併；loadingdone 時清除快取', async () => {
    const target = new EventTarget();
    const load = vi.fn(async () => [{}]);
    const fonts = {
      load,
      addEventListener: (t: string, cb: () => void) => target.addEventListener(t, cb),
      removeEventListener: (t: string, cb: () => void) => target.removeEventListener(t, cb),
    };
    const invalidate = vi.fn();
    const loader = new FontLoader(fonts as any, invalidate);
    expect(loader.request('14px X', '你好')).toBe(true);
    expect(loader.request('14px X', '你好嗎')).toBe(true);
    expect(loader.request('14px X', '你好')).toBe(false);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('14px X', '你好嗎');
    await new Promise((r) => setTimeout(r, 0));
    expect(invalidate).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new Event('loadingdone'));
    expect(invalidate).toHaveBeenCalledTimes(2);
    loader.destroy();
    target.dispatchEvent(new Event('loadingdone'));
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
