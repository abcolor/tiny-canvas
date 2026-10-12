import { useEffect, useRef, useState } from 'react';
import { Map as MapIcon, Maximize, Minus, Plus, Redo2, ScanSearch, Undo2 } from 'lucide-react';
import type { BoardEditor, EditorState } from '@tinycanvas/canvas-engine';
import { IconButton, strings } from '@tinycanvas/ui';

function readMinimapPref(): boolean {
  try {
    return localStorage.getItem('tc:minimap') === 'on';
  } catch {
    return false;
  }
}

/** 右下角：復原 / 重做、縮放、縮放至全部 / 選取、小地圖（見 SPEC.md 第 3.1 節） */
export function ZoomControls({ editor, state }: { editor: BoardEditor; state: EditorState }) {
  const s = strings.board;
  const [minimap, setMinimap] = useState(readMinimapPref);
  const toggleMinimap = () => {
    setMinimap((m) => {
      try {
        localStorage.setItem('tc:minimap', m ? 'off' : 'on');
      } catch {
        /* 忽略 */
      }
      return !m;
    });
  };
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
      {minimap ? <Minimap editor={editor} state={state} /> : null}
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-ink-100 bg-white p-1 shadow-float">
        {!state.readOnly ? (
          <>
            <IconButton label={s.undo} shortcut="Mod+Z" tooltipSide="top" disabled={!state.canUndo} onClick={() => editor.undo()}>
              <Undo2 className="h-4 w-4" />
            </IconButton>
            <IconButton label={s.redo} shortcut="Mod+Shift+Z" tooltipSide="top" disabled={!state.canRedo} onClick={() => editor.redo()}>
              <Redo2 className="h-4 w-4" />
            </IconButton>
            <div className="mx-0.5 h-5 w-px bg-ink-100" />
          </>
        ) : null}
        <IconButton label={s.zoomOut} shortcut="Mod+-" tooltipSide="top" onClick={() => editor.zoomOut()}>
          <Minus className="h-4 w-4" />
        </IconButton>
        <button
          type="button"
          className="h-8 min-w-[52px] rounded-lg text-xs tabular-nums text-ink-700 hover:bg-ink-100"
          onClick={() => editor.setZoom(1)}
          aria-label="100%"
          data-testid="zoom-level"
        >
          {Math.round(state.camera.zoom * 100)}%
        </button>
        <IconButton label={s.zoomIn} shortcut="Mod+=" tooltipSide="top" onClick={() => editor.zoomIn()}>
          <Plus className="h-4 w-4" />
        </IconButton>
        <IconButton label={s.zoomToFit} shortcut="Shift+1" tooltipSide="top" onClick={() => editor.zoomToFit()}>
          <Maximize className="h-4 w-4" />
        </IconButton>
        <IconButton
          label={s.zoomToSelection}
          shortcut="Shift+2"
          tooltipSide="top"
          disabled={state.selection.length === 0}
          onClick={() => editor.zoomToSelection()}
        >
          <ScanSearch className="h-4 w-4" />
        </IconButton>
        <IconButton label={s.minimap} tooltipSide="top" active={minimap} onClick={toggleMinimap}>
          <MapIcon className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

const MINIMAP_W = 200;
const MINIMAP_H = 140;

function Minimap({ editor, state }: { editor: BoardEditor; state: EditorState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // 相機或內容變動時重繪；以 rAF 合併
  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current && editor.renderMinimap(ref.current));
    return () => cancelAnimationFrame(id);
  }, [editor, state]);
  const navigate = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const world = editor.minimapToWorld?.(ref.current!, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    if (world) editor.centerOn(world);
  };
  return (
    <canvas
      ref={ref}
      width={MINIMAP_W * devicePixelRatio}
      height={MINIMAP_H * devicePixelRatio}
      style={{ width: MINIMAP_W, height: MINIMAP_H }}
      className="pointer-events-auto cursor-pointer rounded-xl border border-ink-100 bg-white shadow-float"
      aria-label={strings.board.minimap}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        navigate(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && navigate(e)}
    />
  );
}
