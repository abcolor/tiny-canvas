import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import Code from '@tiptap/extension-code';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { ySyncPlugin, ySyncPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';

/**
 * y-prosemirror 寫入 Y.XmlFragment 時使用的 transaction origin。
 * 畫布引擎的 UndoManager 也要追蹤它，打字才會和畫布操作共用同一個復原堆疊（見 SPEC.md 第 3.5 節）。
 */
export const textEditOrigin = ySyncPluginKey;

export interface CanvasTextOptions {
  fragment: Y.XmlFragment | null;
  onUndo: () => void;
  onRedo: () => void;
  onExit: () => void;
  onLinkRequest: () => void;
  /** Tab / Shift+Tab：回傳 true 表示已處理（例如表格移到下一格）；否則交給預設行為（列點縮排） */
  onTab?: (shift: boolean) => boolean;
}

/**
 * 綁定畫布物件的 Y.XmlFragment。只加入 ySyncPlugin，不加 y-prosemirror 的 undo 外掛：
 * 復原 / 重做交給畫布引擎的 UndoManager，避免兩個復原堆疊互相打架。
 */
export const CanvasText = Extension.create<CanvasTextOptions>({
  name: 'canvasText',
  priority: 1000,
  addOptions() {
    return {
      fragment: null,
      onUndo: () => {},
      onRedo: () => {},
      onExit: () => {},
      onLinkRequest: () => {},
      onTab: undefined,
    };
  },
  addProseMirrorPlugins() {
    return this.options.fragment ? [ySyncPlugin(this.options.fragment)] : [];
  },
  addKeyboardShortcuts() {
    return {
      'Mod-z': () => {
        this.options.onUndo();
        return true;
      },
      'Mod-Shift-z': () => {
        this.options.onRedo();
        return true;
      },
      'Mod-y': () => {
        this.options.onRedo();
        return true;
      },
      'Mod-k': () => {
        this.options.onLinkRequest();
        return true;
      },
      Escape: () => {
        this.options.onExit();
        return true;
      },
      // 文字格式快捷鍵（見 SPEC.md 第 4.3 節）；Tiptap 原本的快捷鍵也保留
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      'Mod-Shift-k': () => this.editor.commands.toggleCode(),
      'Mod-\\': () => this.editor.chain().clearNodes().setParagraph().run(),
      Tab: () => this.options.onTab?.(false) ?? false,
      'Shift-Tab': () => this.options.onTab?.(true) ?? false,
    };
  },
});

/**
 * 編輯器允許的內容（見 SPEC.md 第 4.3 節）：
 * 段落、標題 1–3、項目清單、編號清單、核取清單、程式碼區塊；粗體、斜體、刪除線、行內程式碼、螢光標記、連結。
 * Markdown 快速輸入由各擴充套件提供：# / ## / ###、* 或 -、1.、[] 、```、`程式碼`
 */
export function canvasExtensions(options: CanvasTextOptions) {
  return [
    StarterKit.configure({
      history: false,
      blockquote: false,
      horizontalRule: false,
      code: false,
      dropcursor: false,
      gapcursor: false,
      heading: { levels: [1, 2, 3] },
    }),
    // Tiptap 的行內程式碼預設排除所有其他格式（excludes: '_'）。套用時若剛好「一個格式換成另一個」
    // （例如粗體 → 程式碼），y-prosemirror 1.3.7 不會把變更寫回 Yjs，編輯器與資料會不一致。
    // 改為只排除自己（一般格式的預設）：可與其他格式並存，也不會出現格式互換。
    // 注意不可設為 ''：y-prosemirror 會把「可與自己重疊」的格式改存成 `code--雜湊` 鍵名
    Code.extend({ excludes: 'code' }),
    Highlight.configure({ multicolor: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }),
    CanvasText.configure(options),
  ];
}
