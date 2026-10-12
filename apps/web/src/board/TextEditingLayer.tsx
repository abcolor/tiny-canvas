import { useEffect, useRef, useState } from 'react';
import type { BoardEditor, EditorState } from '@tinycanvas/canvas-engine';
import { RichTextOverlay, type Editor } from '@tinycanvas/editor';
import { getObjects } from '@tinycanvas/shared';

/**
 * 依引擎的編輯狀態疊上輸入元件：
 * - 富文本（形狀、文字、線框圖、表格儲存格）→ Tiptap，直接綁定 Y.XmlFragment
 * - 區塊標題、連線標籤 → 單行輸入框
 */
export function TextEditingLayer({
  editor,
  state,
  onTextEditor,
  onRequestLink,
}: {
  editor: BoardEditor;
  state: EditorState;
  onTextEditor: (e: Editor | null) => void;
  onRequestLink: () => void;
}) {
  const editing = state.editing;
  if (!editing || state.readOnly) return null;
  const geometry = editor.getEditingGeometry();
  if (!geometry) return null;

  if (editing.field === 'title' || editing.field === 'label') {
    return <PlainInput key={`${editing.id}:${editing.field}`} editor={editor} id={editing.id} field={editing.field} geometry={geometry} />;
  }
  const fragment = editor.getEditingFragment();
  if (!fragment) return null;
  return (
    <RichTextOverlay
      key={`${editing.id}:${editing.cellKey ?? ''}`}
      fragment={fragment}
      geometry={geometry}
      seed={editing.seed}
      onUndo={() => editor.undo()}
      onRedo={() => editor.redo()}
      onExit={() => {
        editor.stopEditing();
        editor.focus();
      }}
      onLinkRequest={onRequestLink}
      onTab={
        editing.field === 'cell'
          ? (shift) => {
              // 表格儲存格：Tab / Shift+Tab 移到下一格 / 上一格
              editor.moveEditingCell(shift ? -1 : 1, 0);
              return true;
            }
          : undefined
      }
      onEditor={onTextEditor}
    />
  );
}

function PlainInput({
  editor,
  id,
  field,
  geometry,
}: {
  editor: BoardEditor;
  id: string;
  field: 'title' | 'label';
  geometry: NonNullable<ReturnType<BoardEditor['getEditingGeometry']>>;
}) {
  const initial = String(getObjects(editor.doc).get(id)?.get(field) ?? '');
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && value !== initial) editor.updateObject(id, { [field]: value });
    editor.stopEditing();
    editor.focus();
  };
  const g = geometry;
  return (
    <input
      ref={ref}
      value={value}
      aria-label={field}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') commit(true);
        if (e.key === 'Escape') commit(false);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-20 rounded border border-brand-400 bg-white px-1 outline-none"
      style={{
        left: g.x,
        top: g.y,
        width: Math.max(g.w, 80),
        height: Math.max(g.h, 20),
        fontSize: g.fontSize * g.zoom,
        fontWeight: g.fontWeight ?? 600,
        color: g.color,
        textAlign: g.textAlign,
      }}
    />
  );
}
