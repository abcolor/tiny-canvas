import * as React from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import type * as Y from 'yjs';
import { canvasExtensions } from './extensions';

export interface OverlayGeometry {
  /** 文字框在畫面上的位置（相對於畫布容器，已扣掉內距） */
  x: number;
  y: number;
  w: number;
  h: number;
  zoom: number;
  rotation: number;
  fontSize: number;
  fontWeight?: number;
  lineHeight?: number;
  color: string;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  /** 寬度依內容自動決定（自由文字未固定寬度時） */
  autoWidth?: boolean;
}

export interface RichTextOverlayProps {
  fragment: Y.XmlFragment;
  geometry: OverlayGeometry;
  /** 由鍵盤直接開始輸入時的第一個字元，會取代原本內容 */
  seed?: string;
  onUndo: () => void;
  onRedo: () => void;
  onExit: () => void;
  onLinkRequest?: (editor: Editor) => void;
  /** Tab / Shift+Tab；回傳 true 表示已處理 */
  onTab?: (shift: boolean) => boolean;
  onEditor?: (editor: Editor | null) => void;
}

/**
 * 疊在畫布上方的 contenteditable（Tiptap），確保中文輸入法、拼字檢查、複製貼上都正常（見 SPEC.md 第 7 節）。
 * 內容直接綁定物件的 Y.XmlFragment，因此其他分頁也會即時看到。
 */
export function RichTextOverlay({
  fragment,
  geometry,
  seed,
  onUndo,
  onRedo,
  onExit,
  onLinkRequest,
  onTab,
  onEditor,
}: RichTextOverlayProps) {
  const callbacks = React.useRef({ onUndo, onRedo, onExit, onLinkRequest, onTab });
  callbacks.current = { onUndo, onRedo, onExit, onLinkRequest, onTab };
  const editorRef = React.useRef<Editor | null>(null);

  const editor = useEditor(
    {
      extensions: canvasExtensions({
        fragment,
        onUndo: () => callbacks.current.onUndo(),
        onRedo: () => callbacks.current.onRedo(),
        onExit: () => callbacks.current.onExit(),
        onLinkRequest: () => editorRef.current && callbacks.current.onLinkRequest?.(editorRef.current),
        onTab: (shift) => callbacks.current.onTab?.(shift) ?? false,
      }),
      editorProps: {
        attributes: { class: 'tc-richtext', spellcheck: 'true', 'data-testid': 'text-editor' },
      },
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
    },
    [fragment],
  );

  React.useEffect(() => {
    editorRef.current = editor;
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  // 進入編輯：立即聚焦並把游標放到最後（不等下一幀，避免緊接著輸入的按鍵落到畫布上）；
  // 有 seed 時以 seed 取代全部內容
  React.useLayoutEffect(() => {
    if (!editor) return;
    if (seed) editor.chain().focus().selectAll().insertContent(seed).run();
    else editor.commands.focus('end');
    // 保險：下一幀若焦點不在編輯器內（例如被其他元素取走），再聚焦一次
    const id = requestAnimationFrame(() => {
      if (!editor.isDestroyed && !editor.view.hasFocus()) editor.commands.focus('end');
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const g = geometry;
  const justify = g.verticalAlign === 'top' ? 'flex-start' : g.verticalAlign === 'bottom' ? 'flex-end' : 'center';
  return (
    <div
      className="tc-richtext-host"
      style={{
        position: 'absolute',
        left: g.x,
        top: g.y,
        width: g.autoWidth ? undefined : g.w,
        minWidth: g.autoWidth ? Math.max(g.w, 8) : undefined,
        minHeight: g.h,
        transform: g.rotation ? `rotate(${g.rotation}deg)` : undefined,
        transformOrigin: `${g.w / 2}px ${g.h / 2}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify,
        fontSize: g.fontSize * g.zoom,
        fontWeight: g.fontWeight ?? 400,
        lineHeight: g.lineHeight ?? 1.4,
        color: g.color,
        textAlign: g.textAlign,
        whiteSpace: g.autoWidth ? 'pre' : 'pre-wrap',
        overflowWrap: 'anywhere',
        zIndex: 20,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onCopy={(e) => e.stopPropagation()}
      onPaste={(e) => e.stopPropagation()}
      onCut={(e) => e.stopPropagation()}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
