import { useRef } from 'react';
import {
  Hand,
  Image as ImageIcon,
  LayoutTemplate,
  Link2,
  MousePointer2,
  Shapes,
  Smile,
  Spline,
  Table2,
  Type,
} from 'lucide-react';
import type { BoardEditor, EditorState, Tool } from '@tinycanvas/canvas-engine';
import { SHAPE_KINDS, type FrameKind, type ShapeKind } from '@tinycanvas/shared';
import { cn, IconButton, Popover, PopoverContent, PopoverTrigger, strings, Tooltip } from '@tinycanvas/ui';
import { ShapeGlyph } from './ShapeGlyph';
import { FrameIcon } from './componentIcons';

const FRAME_KINDS: FrameKind[] = ['phone', 'tablet', 'browser', 'window'];

function isTool(t: Tool, kind: Tool['kind'], sub?: string): boolean {
  if (t.kind !== kind) return false;
  if (sub === undefined) return true;
  return (t as { shapeKind?: string }).shapeKind === sub;
}

/** 左側工具列。所有工具也都有鍵盤快捷鍵（見 SPEC.md 第 3.7 節） */
export function Toolbar({
  editor,
  state,
  onOpenWireframes,
  onOpenIcons,
  onPickImage,
  onInsertLinkCard,
}: {
  editor: BoardEditor;
  state: EditorState;
  onOpenWireframes: () => void;
  onOpenIcons: () => void;
  onPickImage: (file: File) => void;
  onInsertLinkCard: () => void;
}) {
  const t = strings.tools;
  const tool = state.tool;
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (next: Tool) => {
    editor.setTool(next);
    editor.focus();
  };
  return (
    <div
      className="pointer-events-auto flex flex-col gap-0.5 rounded-xl border border-ink-100 bg-white p-1 shadow-float"
      role="toolbar"
      aria-orientation="vertical"
    >
      <IconButton label={t.select} shortcut="V" tooltipSide="right" active={isTool(tool, 'select')} onClick={() => set({ kind: 'select' })}>
        <MousePointer2 className="h-4 w-4" />
      </IconButton>
      <IconButton label={t.hand} shortcut="H" tooltipSide="right" active={isTool(tool, 'hand')} onClick={() => set({ kind: 'hand' })}>
        <Hand className="h-4 w-4" />
      </IconButton>
      <div className="mx-1.5 my-1 h-px bg-ink-100" />
      <Popover>
        <Tooltip content={t.shapes} side="right">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t.shapes}
              aria-pressed={isTool(tool, 'shape')}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100 data-[state=open]:bg-ink-100',
                isTool(tool, 'shape') && 'bg-brand-100 text-brand-800 hover:bg-brand-100',
              )}
            >
              <Shapes className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent side="right" align="start" className="w-[232px] p-2">
          <div className="grid grid-cols-5 gap-1">
            {SHAPE_KINDS.map((k: ShapeKind) => (
              <button
                key={k}
                type="button"
                title={strings.shapes[k]}
                aria-label={strings.shapes[k]}
                onClick={() => set({ kind: 'shape', shapeKind: k })}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100"
              >
                <ShapeGlyph kind={k} />
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <IconButton label={t.text} shortcut="T" tooltipSide="right" active={isTool(tool, 'text')} onClick={() => set({ kind: 'text' })}>
        <Type className="h-4 w-4" />
      </IconButton>
      <IconButton label={t.connector} shortcut="L" tooltipSide="right" active={isTool(tool, 'connector')} onClick={() => set({ kind: 'connector' })}>
        <Spline className="h-4 w-4" />
      </IconButton>
      <div className="mx-1.5 my-1 h-px bg-ink-100" />
      <IconButton label={t.wireframe} shortcut="W" tooltipSide="right" active={isTool(tool, 'wireframe')} onClick={onOpenWireframes}>
        <LayoutTemplate className="h-4 w-4" />
      </IconButton>
      <IconButton label={t.icon} shortcut="I" tooltipSide="right" active={isTool(tool, 'icon')} onClick={onOpenIcons}>
        <Smile className="h-4 w-4" />
      </IconButton>
      <Popover>
        <Tooltip content={t.deviceFrame} side="right">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t.deviceFrame}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100 data-[state=open]:bg-ink-100"
            >
              <DeviceGlyph />
            </button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent side="right" align="start" className="flex w-44 flex-col p-1">
          {FRAME_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => set({ kind: 'frame', frameKind: k })}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-ink-100"
            >
              <FrameIcon kind={k} className="h-4 w-4 text-ink-500" />
              {strings.frames[k]}
            </button>
          ))}
        </PopoverContent>
      </Popover>
      <IconButton label={t.table} tooltipSide="right" active={isTool(tool, 'table')} onClick={() => set({ kind: 'table' })}>
        <Table2 className="h-4 w-4" />
      </IconButton>
      <IconButton label={t.image} tooltipSide="right" onClick={() => fileInput.current?.click()}>
        <ImageIcon className="h-4 w-4" />
      </IconButton>
      <IconButton label={t.linkCard} tooltipSide="right" onClick={onInsertLinkCard}>
        <Link2 className="h-4 w-4" />
      </IconButton>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickImage(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function DeviceGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="4" y="1.5" width="8" height="13" rx="1.8" />
      <path d="M7 12.5h2" strokeLinecap="round" />
    </svg>
  );
}
