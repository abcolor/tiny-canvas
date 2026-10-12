import { useEffect, useReducer } from 'react';
import * as Y from 'yjs';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  CodeXml,
  EllipsisVertical,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Plus,
  Strikethrough,
  type LucideIcon,
} from 'lucide-react';
import type { BoardEditor } from '@tinycanvas/canvas-engine';
import {
  activeBlockType,
  applyBlockType,
  formatFragments,
  fragmentsFormatState,
  isMarkActive,
  toggleMark,
  type BlockType,
  type Editor,
  type MarkType,
} from '@tinycanvas/editor';
import { FONT_SIZE_SCALE, fontSizeIndex, getObjects, type BoardObject, type Style } from '@tinycanvas/shared';
import {
  cn,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuTrigger,
  shortcutLabel,
  strings,
  Tooltip,
} from '@tinycanvas/ui';

const BLOCKS: { type: BlockType; icon: LucideIcon; hint: string }[] = [
  { type: 'paragraph', icon: Pilcrow, hint: 'Mod+\\' },
  { type: 'h1', icon: Heading1, hint: '#' },
  { type: 'h2', icon: Heading2, hint: '##' },
  { type: 'h3', icon: Heading3, hint: '###' },
  { type: 'bullet', icon: List, hint: '*' },
  { type: 'ordered', icon: ListOrdered, hint: '1.' },
  { type: 'task', icon: ListChecks, hint: '[]' },
  { type: 'code', icon: CodeXml, hint: '```' },
];

const MORE_MARKS: { type: MarkType; icon: LucideIcon; shortcut: string }[] = [
  { type: 'strike', icon: Strikethrough, shortcut: 'Mod+Shift+X' },
  { type: 'code', icon: Code, shortcut: 'Mod+Shift+K' },
  { type: 'highlight', icon: Highlighter, shortcut: 'Mod+Shift+H' },
];

/** 選取物件中可以套用富文本格式的 Y.XmlFragment（形狀、文字、線框圖的文字，以及表格的所有儲存格） */
export function selectedFragments(editor: BoardEditor, selected: BoardObject[]): Y.XmlFragment[] {
  const objs = getObjects(editor.doc);
  const out: Y.XmlFragment[] = [];
  for (const o of selected) {
    const m = objs.get(o.id);
    if (!m || o.locked) continue;
    const text = m.get('text');
    if (text instanceof Y.XmlFragment) out.push(text);
    const cells = m.get('cells');
    if (cells instanceof Y.Map) cells.forEach((f) => f instanceof Y.XmlFragment && out.push(f));
  }
  return out;
}

/** Tiptap 的選取或內容變動時重新繪製工具列（顯示目前格式） */
function useEditorTick(editor: Editor | null) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on('transaction', tick);
    return () => {
      editor.off('transaction', tick);
    };
  }, [editor]);
}

/**
 * 文字格式工具列（見 SPEC.md 第 4.3 節）：字級、粗體 / 斜體 / 更多格式、段落樣式、連結、對齊、文字顏色。
 * 編輯中套用到選取的文字；只選取物件時套用到整個物件的文字。
 */
export function TextControls({
  editor,
  selected,
  style,
  textEditor,
  defaultFontSize,
  onStyle,
  onRequestLink,
  colorPicker,
}: {
  editor: BoardEditor;
  selected: BoardObject[];
  style: Style;
  textEditor: Editor | null;
  defaultFontSize: number;
  onStyle: (patch: Partial<Style>) => void;
  onRequestLink: () => void;
  colorPicker: React.ReactNode;
}) {
  useEditorTick(textEditor);
  const t = strings.text;
  const editing = Boolean(textEditor);
  const fragments = editing ? [] : selectedFragments(editor, selected);
  const rich = editing || fragments.length > 0;
  const state = editing ? null : fragmentsFormatState(fragments);
  const markActive = (m: MarkType) => (textEditor ? isMarkActive(textEditor, m) : Boolean(state?.marks[m]));
  const block = textEditor ? activeBlockType(textEditor) : (state?.block ?? null);
  const BlockIcon = BLOCKS.find((b) => b.type === block)?.icon ?? Pilcrow;

  /** 套用格式：編輯中作用於選取文字，否則以暫時編輯器套用到整個物件（一次復原步驟） */
  const apply = (fn: (e: Editor) => void) => {
    if (textEditor) {
      fn(textEditor);
      return;
    }
    editor.undoManager.stopCapturing();
    void formatFragments(fragments, fn).then(() => editor.undoManager.stopCapturing());
  };

  const size = style.fontSize ?? defaultFontSize;
  const idx = fontSizeIndex(size);
  const setSize = (i: number) => onStyle({ fontSize: FONT_SIZE_SCALE[Math.min(Math.max(i, 0), FONT_SIZE_SCALE.length - 1)].size });
  const align = style.textAlign ?? 'center';

  return (
    <>
      {/* 字級：− 名稱 + */}
      <div className="flex items-center rounded-lg bg-ink-100 p-0.5" role="group" aria-label={t.size}>
        <Tooltip content={t.smaller}>
          <button
            type="button"
            aria-label={t.smaller}
            disabled={idx >= FONT_SIZE_SCALE.length - 1}
            onClick={() => setSize(idx + 1)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-600 hover:bg-white disabled:text-ink-300 disabled:hover:bg-transparent"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Menu>
          <Tooltip content={t.size}>
            <MenuTrigger asChild>
              <button
                type="button"
                aria-label={t.size}
                data-testid="font-size"
                className="h-7 min-w-[40px] rounded-md px-1.5 text-xs font-semibold tabular-nums text-ink-800 hover:bg-white"
              >
                {FONT_SIZE_SCALE[idx].label}
              </button>
            </MenuTrigger>
          </Tooltip>
          <MenuContent className="min-w-[140px]">
            {FONT_SIZE_SCALE.map((f, i) => (
              <MenuCheckboxItem key={f.label} checked={i === idx} onCheckedChange={() => setSize(i)}>
                <span className="flex w-full items-center justify-between gap-4">
                  <span className="font-semibold">{f.label}</span>
                  <span className="text-xs text-ink-400">{f.size}</span>
                </span>
              </MenuCheckboxItem>
            ))}
          </MenuContent>
        </Menu>
        <Tooltip content={t.larger}>
          <button
            type="button"
            aria-label={t.larger}
            disabled={idx <= 0}
            onClick={() => setSize(idx - 1)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-600 hover:bg-white disabled:text-ink-300 disabled:hover:bg-transparent"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {rich ? (
        <>
          <Divider />
          <IconButton label={t.bold} shortcut="Mod+B" active={markActive('bold')} onClick={() => apply((e) => toggleMark(e, 'bold'))}>
            <Bold className="h-4 w-4" />
          </IconButton>
          <IconButton label={t.italic} shortcut="Mod+I" active={markActive('italic')} onClick={() => apply((e) => toggleMark(e, 'italic'))}>
            <Italic className="h-4 w-4" />
          </IconButton>
          <Menu>
            <Tooltip content={t.moreFormats}>
              <MenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t.moreFormats}
                  className={cn(
                    'inline-flex h-8 w-5 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100',
                    MORE_MARKS.some((m) => markActive(m.type)) && 'text-brand-700',
                  )}
                >
                  <EllipsisVertical className="h-4 w-4" />
                </button>
              </MenuTrigger>
            </Tooltip>
            <MenuContent>
              {MORE_MARKS.map((m) => (
                <MenuCheckboxItem key={m.type} checked={markActive(m.type)} onCheckedChange={() => apply((e) => toggleMark(e, m.type))}>
                  <span className="flex w-full items-center gap-2">
                    <m.icon className="h-4 w-4 text-ink-500" />
                    <span className="flex-1">{t.marks[m.type]}</span>
                    <span className="text-xs text-ink-400">{shortcutLabel(m.shortcut)}</span>
                  </span>
                </MenuCheckboxItem>
              ))}
            </MenuContent>
          </Menu>

          <Divider />
          <Menu>
            <Tooltip content={t.blockType}>
              <MenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t.blockType}
                  data-testid="block-type"
                  className="inline-flex h-8 items-center gap-0.5 rounded-lg px-1.5 text-ink-700 hover:bg-ink-100"
                >
                  <BlockIcon className="h-4 w-4" />
                  <EllipsisVertical className="h-3.5 w-3.5 text-ink-400" />
                </button>
              </MenuTrigger>
            </Tooltip>
            <MenuContent className="min-w-[200px]">
              {BLOCKS.map((b) => (
                <MenuItem
                  key={b.type}
                  icon={<b.icon className={cn('h-4 w-4', block === b.type && 'text-brand-700')} />}
                  onSelect={() => apply((e) => applyBlockType(e, b.type))}
                >
                  <span className="flex w-full items-center justify-between gap-4">
                    <span className={cn(block === b.type && 'font-semibold text-brand-800')}>{t.blocks[b.type]}</span>
                    <kbd className="rounded border border-ink-200 bg-ink-50 px-1 font-mono text-[11px] text-ink-500">
                      {b.hint.startsWith('Mod') ? shortcutLabel(b.hint) : b.hint}
                    </kbd>
                  </span>
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          {editing ? (
            <IconButton label={t.link} shortcut="Mod+K" active={Boolean(textEditor?.isActive('link'))} onClick={onRequestLink}>
              <Link className="h-4 w-4" />
            </IconButton>
          ) : null}
        </>
      ) : null}

      <Divider />
      {/* 對齊：三個直接可按的按鈕 */}
      <div className="flex items-center rounded-lg bg-ink-100 p-0.5" role="radiogroup" aria-label={strings.style.align}>
        {(
          [
            ['left', AlignLeft, strings.style.alignLeft],
            ['center', AlignCenter, strings.style.alignCenter],
            ['right', AlignRight, strings.style.alignRight],
          ] as const
        ).map(([value, Icon, label]) => (
          <Tooltip key={value} content={label}>
            <button
              type="button"
              role="radio"
              aria-checked={align === value}
              aria-label={label}
              onClick={() => onStyle({ textAlign: value })}
              className={cn('flex h-7 w-8 items-center justify-center rounded-md text-ink-600', align === value && 'bg-white text-brand-800 shadow-sm')}
            >
              <Icon className="h-4 w-4" />
            </button>
          </Tooltip>
        ))}
      </div>
      {colorPicker}
    </>
  );
}

function Divider() {
  return <div className="mx-0.5 h-5 w-px bg-ink-100" />;
}
