import { useSyncExternalStore } from 'react';
import type { BoardEditor, EditorState } from '@tinycanvas/canvas-engine';

/** 訂閱畫布引擎的狀態（選取、工具、縮放、編輯中物件等） */
export function useEditorState(editor: BoardEditor): EditorState {
  return useSyncExternalStore(
    (cb) => editor.subscribe(cb),
    () => editor.getState(),
  );
}
