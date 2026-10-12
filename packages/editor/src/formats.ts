import { Editor } from '@tiptap/core';
import type * as Y from 'yjs';
import { readRichText, type TextBlock } from '@tinycanvas/shared';
import { canvasExtensions } from './extensions';

/** 段落樣式（見 SPEC.md 第 4.3 節） */
export type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'task' | 'code';
export const BLOCK_TYPES: BlockType[] = ['paragraph', 'h1', 'h2', 'h3', 'bullet', 'ordered', 'task', 'code'];

/** 行內格式 */
export type MarkType = 'bold' | 'italic' | 'strike' | 'code' | 'highlight';
export const MARK_TYPES: MarkType[] = ['bold', 'italic', 'strike', 'code', 'highlight'];

/** 把目前選取的段落設成指定樣式；清單類型再按一次會取消 */
export function applyBlockType(editor: Editor, t: BlockType): boolean {
  const c = editor.chain().focus();
  switch (t) {
    case 'paragraph':
      return c.clearNodes().setParagraph().run();
    case 'h1':
    case 'h2':
    case 'h3':
      return c.clearNodes().setHeading({ level: Number(t[1]) as 1 | 2 | 3 }).run();
    case 'bullet':
      return editor.isActive('bulletList') ? c.toggleBulletList().run() : c.clearNodes().toggleBulletList().run();
    case 'ordered':
      return editor.isActive('orderedList') ? c.toggleOrderedList().run() : c.clearNodes().toggleOrderedList().run();
    case 'task':
      return editor.isActive('taskList') ? c.toggleTaskList().run() : c.clearNodes().toggleTaskList().run();
    case 'code':
      return c.toggleCodeBlock().run();
  }
}

export function activeBlockType(editor: Editor): BlockType {
  if (editor.isActive('codeBlock')) return 'code';
  if (editor.isActive('taskList')) return 'task';
  if (editor.isActive('orderedList')) return 'ordered';
  if (editor.isActive('bulletList')) return 'bullet';
  for (const l of [1, 2, 3] as const) if (editor.isActive('heading', { level: l })) return `h${l}`;
  return 'paragraph';
}

export function toggleMark(editor: Editor, m: MarkType): boolean {
  const c = editor.chain().focus();
  switch (m) {
    case 'bold':
      return c.toggleBold().run();
    case 'italic':
      return c.toggleItalic().run();
    case 'strike':
      return c.toggleStrike().run();
    case 'code':
      return c.toggleCode().run();
    case 'highlight':
      return c.toggleHighlight().run();
  }
}

export function isMarkActive(editor: Editor, m: MarkType): boolean {
  return editor.isActive(m);
}

const noop = () => {};

/**
 * 不在編輯狀態時，對整個物件的文字套用格式：以不顯示的暫時編輯器開啟 fragment、全選後執行 fn。
 * 寫入一樣經過 y-prosemirror（同一個 transaction origin），因此可以用 Mod+Z 復原。
 */
export async function formatFragments(fragments: Y.XmlFragment[], fn: (editor: Editor) => void): Promise<void> {
  for (const fragment of fragments) {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: canvasExtensions({ fragment, onUndo: noop, onRedo: noop, onExit: noop, onLinkRequest: noop }),
    });
    // y-prosemirror 可能在下一個事件迴圈才把 fragment 內容放進編輯器
    if (editor.isEmpty && fragment.length > 0) await new Promise((r) => setTimeout(r, 0));
    editor.commands.selectAll();
    fn(editor);
    editor.destroy();
  }
}

/** 由富文本快照計算整個物件的格式狀態（不在編輯狀態時顯示在工具列上） */
export function fragmentsFormatState(fragments: Y.XmlFragment[]): { marks: Record<MarkType, boolean>; block: BlockType | null } {
  const blocks: TextBlock[] = fragments.flatMap((f) => readRichText(f));
  const runs = blocks.flatMap((b) => b.runs).filter((r) => r.text.trim());
  const all = (pred: (r: (typeof runs)[number]) => boolean) => runs.length > 0 && runs.every(pred);
  const marks: Record<MarkType, boolean> = {
    bold: all((r) => !!r.bold),
    italic: all((r) => !!r.italic),
    strike: all((r) => !!r.strike),
    code: all((r) => !!r.code),
    highlight: all((r) => !!r.highlight),
  };
  const kinds = new Set(
    blocks.map((b): BlockType => (b.kind === 'heading' ? (`h${b.level ?? 1}` as BlockType) : b.kind === 'bullet' ? 'bullet' : b.kind)),
  );
  const block = kinds.size === 1 ? [...kinds][0] : kinds.size === 0 ? 'paragraph' : null;
  return { marks, block };
}
