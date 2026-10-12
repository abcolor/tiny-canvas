import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { readRichText, fragmentFromPlain, getObjects, createObjectMap } from '@tinycanvas/shared';
import { canvasExtensions, textEditOrigin } from '../src';

function makeEditor(fragment: Y.XmlFragment, calls: string[] = []) {
  return new Editor({
    extensions: canvasExtensions({
      fragment,
      onUndo: () => calls.push('undo'),
      onRedo: () => calls.push('redo'),
      onExit: () => calls.push('exit'),
      onLinkRequest: () => calls.push('link'),
    }),
  });
}

describe('Tiptap 與 Y.XmlFragment 綁定', () => {
  it('載入既有內容，並以 ySyncPlugin 的 origin 寫回粗體、斜體、列點', () => {
    const doc = new Y.Doc();
    getObjects(doc).set('s', createObjectMap({ type: 'shape', id: 's', x: 0, y: 0, w: 1, h: 1, text: '原本' }));
    const fragment = getObjects(doc).get('s')!.get('text') as Y.XmlFragment;
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));

    const editor = makeEditor(fragment);
    expect(editor.getText()).toBe('原本');

    editor.chain().selectAll().insertContent('<p><strong>粗</strong><em>斜</em></p><ul><li><p>項目</p></li></ul>').run();
    const blocks = readRichText(fragment);
    expect(blocks[0].runs).toEqual([
      { text: '粗', bold: true },
      { text: '斜', italic: true },
    ]);
    expect(blocks[1]).toMatchObject({ kind: 'bullet', depth: 0, runs: [{ text: '項目' }] });
    expect(origins).toContain(textEditOrigin);
    editor.destroy();
  });

  it('外部（另一個分頁或復原）修改 fragment 時，編輯器內容跟著更新', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('m');
    map.set('f', fragmentFromPlain('一'));
    const fragment = map.get('f') as Y.XmlFragment;
    const editor = makeEditor(fragment);
    doc.transact(() => {
      const p = fragment.get(0) as Y.XmlElement;
      (p.get(0) as Y.XmlText).insert(1, '二');
    }, 'remote');
    expect(editor.getText()).toBe('一二');
    editor.destroy();
  });

  it('Mod+Z、Escape、Mod+K 交給呼叫端處理', () => {
    const doc = new Y.Doc();
    const calls: string[] = [];
    const editor = makeEditor(doc.getXmlFragment('f'), calls);
    const dom = editor.view.dom;
    const key = (init: KeyboardEventInit) => dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    key({ key: 'z', ctrlKey: true });
    key({ key: 'Escape' });
    key({ key: 'k', ctrlKey: true });
    expect(calls).toEqual(['undo', 'exit', 'link']);
    editor.destroy();
  });
});
