import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createObjectMap, getObjects, readRichText } from '@tinycanvas/shared';
import { applyBlockType, canvasExtensions, formatFragments, fragmentsFormatState, toggleMark } from '../src';

function shapeFragment(text: string) {
  const doc = new Y.Doc();
  getObjects(doc).set('s', createObjectMap({ type: 'shape', id: 's', x: 0, y: 0, w: 1, h: 1, text }));
  return getObjects(doc).get('s')!.get('text') as Y.XmlFragment;
}
const noop = () => {};
function editorFor(fragment: Y.XmlFragment) {
  return new Editor({ extensions: canvasExtensions({ fragment, onUndo: noop, onRedo: noop, onExit: noop, onLinkRequest: noop }) });
}

describe('文字格式', () => {
  it('不在編輯狀態時對整個物件套用粗體與刪除線', async () => {
    const f = shapeFragment('第一行\n第二行');
    await formatFragments([f], (e) => {
      toggleMark(e, 'bold');
      toggleMark(e, 'strike');
    });
    const runs = readRichText(f).flatMap((b) => b.runs);
    expect(runs.every((r) => r.bold && r.strike)).toBe(true);
    expect(fragmentsFormatState([f]).marks).toMatchObject({ bold: true, strike: true, italic: false });
  });

  it('段落樣式：標題、編號清單、核取清單、程式碼區塊', async () => {
    for (const [type, kind] of [
      ['h2', 'heading'],
      ['ordered', 'ordered'],
      ['task', 'task'],
      ['code', 'code'],
    ] as const) {
      const f = shapeFragment('內容');
      await formatFragments([f], (e) => applyBlockType(e, type));
      expect(readRichText(f)[0].kind).toBe(kind);
      expect(fragmentsFormatState([f]).block).toBe(type);
    }
  });

  it('螢光標記與行內程式碼可以並存，且確實寫回 Y.XmlFragment', async () => {
    const f = shapeFragment('abc');
    await formatFragments([f], (e) => toggleMark(e, 'highlight'));
    expect(readRichText(f)[0].runs[0].highlight).toBeTruthy();
    await formatFragments([f], (e) => toggleMark(e, 'code'));
    expect(readRichText(f)[0].runs[0]).toEqual({ text: 'abc', code: true, highlight: true });
  });

  it('切換任一格式後，編輯器與 Y.XmlFragment 的內容一致（避開 y-prosemirror 的同步問題）', () => {
    const marks = ['bold', 'italic', 'strike', 'code', 'highlight'] as const;
    for (const a of marks) {
      for (const b of marks) {
        if (a === b) continue;
        const doc = new Y.Doc();
        const f = doc.getXmlFragment('f');
        const e = editorFor(f);
        e.commands.insertContent('abc');
        e.commands.selectAll();
        toggleMark(e, a);
        toggleMark(e, b);
        const pm = (e.getJSON().content![0].content![0].marks ?? []).map((m) => m.type).sort();
        const y = Object.entries(readRichText(f)[0].runs[0]).filter(([k, v]) => k !== 'text' && v).map(([k]) => k).sort();
        expect(y, `${a} → ${b}`).toEqual(pm);
        e.destroy();
      }
    }
  });

  it('快捷鍵：Mod+Shift+X 刪除線、Mod+Shift+K 行內程式碼、Mod+Shift+H 螢光標記、Mod+\\ 內文', () => {
    const cases: [string, (r: ReturnType<typeof readRichText>[number]) => unknown][] = [
      ['x', (b) => b.runs[0].strike],
      ['k', (b) => b.runs[0].code],
      ['h', (b) => b.runs[0].highlight],
    ];
    for (const [k, check] of cases) {
      const f = shapeFragment('abc');
      const e = editorFor(f);
      e.commands.selectAll();
      e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, shiftKey: true, key: k }));
      expect(check(readRichText(f)[0]), k).toBeTruthy();
      e.destroy();
    }
    const f = shapeFragment('abc');
    const e = editorFor(f);
    e.commands.selectAll();
    applyBlockType(e, 'h1');
    expect(readRichText(f)[0].kind).toBe('heading');
    e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: '\\' }));
    expect(readRichText(f)[0].kind).toBe('paragraph');
    e.destroy();
  });

  it('Markdown 快速輸入：# 標題、* 清單、[] 核取清單、``` 程式碼區塊', () => {
    for (const [input, kind] of [
      ['# ', 'heading'],
      ['* ', 'bullet'],
      ['1. ', 'ordered'],
      ['[] ', 'task'],
      ['```', 'code'],
    ] as const) {
      const doc = new Y.Doc();
      const f = doc.getXmlFragment('f');
      const e = editorFor(f);
      e.commands.focus('end');
      // 模擬逐字輸入，觸發 input rule
      for (const ch of input) {
        const { from, to } = e.state.selection;
        const handled = e.view.someProp('handleTextInput', (fn) => fn(e.view, from, to, ch, () => e.state.tr.insertText(ch, from, to)));
        if (!handled) e.view.dispatch(e.state.tr.insertText(ch, from, to));
      }
      if (input === '```') {
        const { from, to } = e.state.selection;
        const handled = e.view.someProp('handleTextInput', (fn) => fn(e.view, from, to, ' ', () => e.state.tr.insertText(' ', from, to)));
        if (!handled) e.view.dispatch(e.state.tr.insertText(' ', from, to));
      }
      expect(readRichText(f)[0]?.kind, input).toBe(kind);
      e.destroy();
    }
  });
});

describe('連結', () => {
  it('修改連結網址會寫回 Y.XmlFragment', () => {
    const f = new Y.Doc().getXmlFragment('f');
    const e = editorFor(f);
    e.commands.insertContent('abc');
    e.commands.selectAll();
    e.chain().setLink({ href: 'https://a.example' }).run();
    expect(readRichText(f)[0].runs[0].link).toBe('https://a.example');
    e.commands.selectAll();
    e.chain().extendMarkRange('link').setLink({ href: 'https://b.example' }).run();
    expect(readRichText(f)[0].runs[0].link).toBe('https://b.example');
    e.destroy();
  });
});
