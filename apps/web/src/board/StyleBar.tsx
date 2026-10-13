import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { icons as lucideIcons } from 'lucide-react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowRight,
  Blend,
  Brush,
  ClipboardCopy,
  Copy,
  Group,
  Lock,
  MoreHorizontal,
  Paintbrush,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Plus,
  RotateCw,
  Smile,
  Square,
  SquareDashed,
  Ungroup,
} from 'lucide-react';
import type { BoardEditor, EditorState } from '@tinycanvas/canvas-engine';
import { DEFAULT_PALETTE, DEFAULT_SHAPE_COLOR, SHAPE_ICON_NAMES, resolveStyle } from '@tinycanvas/canvas-engine';
import {
  getObjects,
  readObject,
  SHAPE_KINDS,
  type ArrowHead,
  type BoardObject,
  type FillMode,
  type IconPosition,
  type Routing,
  type ShapeKind,
  type Style,
} from '@tinycanvas/shared';
import {
  cn,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Segmented,
  strings,
  Tooltip,
} from '@tinycanvas/ui';
import type { Editor } from '@tinycanvas/editor';
import { ShapeGlyph } from './ShapeGlyph';
import { IconLibrary } from './IconLibrary';
import { TextControls } from './TextControls';
import { ArrangeMenuItems } from './ArrangeMenu';
import { useDialogs } from '../components/dialogs';


export function useSelectedObjects(editor: BoardEditor, state: EditorState): BoardObject[] {
  return useMemo(() => {
    const objs = getObjects(editor.doc);
    return state.selection.map((id) => objs.get(id)).flatMap((m) => (m ? [readObject(m)!].filter(Boolean) : []));
    // 選取或內容改變時重新讀取：state 物件在每次變動時都是新的
  }, [editor, state]);
}

/** 選取物件上方的浮動樣式工具列（見 SPEC.md 第 3.2 節） */
export function StyleBar({
  editor,
  state,
  textEditor,
  onRequestLink,
}: {
  editor: BoardEditor;
  state: EditorState;
  textEditor: Editor | null;
  onRequestLink: () => void;
}) {
  const selected = useSelectedObjects(editor, state);
  const barRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const centerX = state.selectionScreenBounds ? state.selectionScreenBounds.x + state.selectionScreenBounds.w / 2 : 0;
  // 工具列置中於選取範圍上方；靠近畫布左右邊緣時往內推，避免被切掉
  useLayoutEffect(() => {
    const el = barRef.current;
    const host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) return;
    const w = el.offsetWidth;
    const min = 8 + w / 2;
    const max = host.clientWidth - 8 - w / 2;
    const clamped = max < min ? host.clientWidth / 2 : Math.min(Math.max(centerX, min), max);
    setShift(clamped - centerX);
  }, [centerX, selected, state.editing, textEditor]);
  const b = state.selectionScreenBounds;
  if (!b || selected.length === 0 || state.readOnly || state.dragging) return null;
  const first = selected[0];
  const style: Style = first.style ?? {};
  const types = new Set(selected.map((o) => o.type));
  const hasFill = selected.some((o) => ['shape', 'section', 'table', 'wireframe'].includes(o.type));
  const hasText = selected.some((o) => ['shape', 'text', 'wireframe', 'table', 'section'].includes(o.type));
  const onlyConnectors = types.size === 1 && types.has('connector');
  const onlyShapes = types.size === 1 && types.has('shape');
  const onlyIcons = types.size === 1 && types.has('icon');
  // 文字物件沒有邊框：只選取文字時不顯示邊框顏色
  const onlyText = types.size === 1 && types.has('text');
  const allLocked = selected.every((o) => o.locked);
  // 多選（至少兩個非連線物件）時只顯示對齊與等距分佈，樣式改由「更多」裡的複製 / 套用樣式處理
  const multi = selected.length > 1 && state.can.align;
  const s = strings.style;
  const setStyle = (patch: Partial<Style>) => editor.setStyle(patch);
  const update = (patch: Record<string, unknown>) => {
    for (const o of selected) editor.updateObject(o.id, patch);
  };

  // 放在選取範圍上方；空間不足時改放下方
  const top = b.y > 64 ? b.y - 52 : b.y + b.h + 12;
  const left = centerX + shift;

  return (
    <div
      ref={barRef}
      className="pointer-events-auto absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-ink-100 bg-white p-1 shadow-float"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label={s.toolbar}
    >
      {multi ? (
        <>
          <AlignControls editor={editor} distribute={state.can.distribute} />
          <GroupButtons editor={editor} selected={selected} />
          <CopyImageButton editor={editor} />
        </>
      ) : (
        <>
          {onlyShapes ? (
            <Popover>
              <Tooltip content={s.shapeKind}>
                <PopoverTrigger asChild>
                  <button type="button" aria-label={s.shapeKind} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100">
                    {first.type === 'shape' ? <ShapeGlyph kind={first.shapeKind} className="h-4 w-4" /> : null}
                  </button>
                </PopoverTrigger>
              </Tooltip>
              <PopoverContent className="w-[232px] p-2">
                <div className="grid grid-cols-5 gap-1">
                  {SHAPE_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      title={strings.shapes[k]}
                      aria-label={strings.shapes[k]}
                      onClick={() => update({ shapeKind: k })}
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-lg hover:bg-ink-100',
                        first.type === 'shape' && first.shapeKind === k && 'bg-brand-50 text-brand-800',
                      )}
                    >
                      <ShapeGlyph kind={k} />
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : null}

          {onlyShapes ? (
            <ShapeAppearance
              style={style}
              kinds={selected.flatMap((o) => (o.type === 'shape' ? [o.shapeKind] : []))}
              onStyle={setStyle}
              onKind={(k) => update({ shapeKind: k })}
            />
          ) : (
            <>
          {hasFill ? (
              <ColorPicker
                label={s.fill}
                value={style.fill}
                swatches={DEFAULT_PALETTE.map((p) => ({ name: p.name, color: p.fill, stroke: p.stroke, text: p.text }))}
                onPick={(c, entry) => setStyle(entry ? { fill: entry.color, stroke: entry.stroke, textColor: entry.text } : { fill: c })}
              />
            ) : null}
            {onlyIcons ? (
              <IconStyleControls
                value={style.stroke}
                weight={style.strokeWidth ?? 2}
                current={first.type === 'icon' ? first.iconName : null}
                onColor={(c) => setStyle({ stroke: c })}
                onWeight={(w) => setStyle({ strokeWidth: w })}
                onReplace={(iconName) => update({ iconName })}
                onRotate={state.can.rotate ? () => editor.rotateEach(90) : undefined}
              />
            ) : onlyText ? null : (
            <ColorPicker
              label={s.stroke}
              value={style.stroke}
              fallback="#7a766a"
              swatches={DEFAULT_PALETTE.map((p) => ({ name: p.name, color: p.color }))}
              onPick={(c) => setStyle({ stroke: c })}
              extra={
                <div className="mt-1.5 flex w-[110px] flex-col gap-1">
                  {/* 連線的實線 / 虛線改由工具列上的按鈕切換 */}
                  {onlyConnectors ? null : (
                    <Segmented
                      size="sm"
                      fullWidth
                      value={style.strokeStyle ?? 'solid'}
                      onChange={(v) => setStyle({ strokeStyle: v })}
                      options={[
                        { value: 'solid', label: s.solid },
                        { value: 'dashed', label: s.dashed },
                        { value: 'dotted', label: s.dotted },
                        { value: 'none', label: s.none },
                      ]}
                    />
                  )}
                  <Segmented
                    size="sm"
                    fullWidth
                    value={style.strokeWidth ?? (onlyConnectors ? 2 : 1.5)}
                    onChange={(v) => setStyle({ strokeWidth: v })}
                    options={[1, 1.5, 2, 3, 4].map((w) => ({ value: w, label: String(w) }))}
                  />
                </div>
              }
            />
            )}
            {onlyConnectors && first.type === 'connector' ? (
              <LineStyleToggle dashed={first.dashed} onPick={(dashed) => update({ dashed })} />
            ) : null}
            </>
          )}
          {hasText ? (
            <>
              {onlyText ? null : <Divider />}
              <TextControls
                editor={editor}
                selected={selected}
                style={style}
                textEditor={state.editing ? textEditor : null}
                defaultFontSize={resolveStyle(first).fontSize}
                onStyle={setStyle}
                onRequestLink={onRequestLink}
                colorPicker={
                  <ColorPicker
                label={s.textColor}
                value={style.textColor}
                fallback="#33322d"
                swatches={DEFAULT_PALETTE.map((p) => ({ name: p.name, color: p.color }))}
                onPick={(c) => setStyle({ textColor: c })}
              />
                }
              />
            </>
          ) : null}

          {onlyShapes ? <IconPicker current={first.type === 'shape' ? first.icon : null} onPick={(icon) => update({ icon })} /> : null}
          {onlyShapes && first.type === 'shape' && first.icon ? (
            <IconPositionPicker value={first.iconPosition} onPick={(iconPosition) => update({ iconPosition })} />
          ) : null}

          {onlyConnectors && first.type === 'connector' ? (
            <>
              <Divider />
              <Segmented<Routing>
                value={first.routing}
                onChange={(v) => update({ routing: v, waypoints: [] })}
                options={[
                  { value: 'straight', label: s.straight },
                  { value: 'orthogonal', label: s.orthogonal },
                  { value: 'curved', label: s.curved },
                ]}
              />
              <ArrowMenu label={s.startArrow} value={first.startArrow} onPick={(v) => update({ startArrow: v })} flip />
              <ArrowMenu label={s.endArrow} value={first.endArrow} onPick={(v) => update({ endArrow: v })} />
            </>
          ) : null}

          <Divider />
          <IconButton label={strings.arrange.duplicate} onClick={() => editor.startPlacingDuplicate()}>
            <Copy className="h-4 w-4" />
          </IconButton>
          <GroupButtons editor={editor} selected={selected} />
        </>
      )}
      <Menu>
        <Tooltip content={strings.common.more}>
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label={strings.common.more}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100',
                allLocked && 'text-brand-700',
              )}
            >
              {allLocked ? <Lock className="h-4 w-4" /> : <MoreHorizontal className="h-4 w-4" />}
            </button>
          </MenuTrigger>
        </Tooltip>
        <MenuContent align="end">
          <MenuItem icon={<Brush className="h-4 w-4" />} onSelect={() => editor.copyStyle()}>
            {s.copyStyle}
          </MenuItem>
          <MenuItem icon={<Paintbrush className="h-4 w-4" />} onSelect={() => editor.pasteStyle()}>
            {s.pasteStyle}
          </MenuItem>
          <MenuSeparator />
          <ArrangeMenuItems editor={editor} selected={selected} hideDuplicate={!multi} hideGroup />
        </MenuContent>
      </Menu>
    </div>
  );
}

const CORNER_KINDS: ShapeKind[] = ['rectangle', 'rounded', 'ellipse'];

/**
 * 只選取形狀時的外觀控制（見 SPEC.md 第 4.1 節）：矩形 / 圓角 / 圓形切換、顏色、
 * 整個填滿 / 只有外框 / 虛線外框、半透明背景。背景色由引擎依外框色推算
 */
function ShapeAppearance({
  style,
  kinds,
  onStyle,
  onKind,
}: {
  style: Style;
  kinds: ShapeKind[];
  onStyle: (patch: Partial<Style>) => void;
  onKind: (k: ShapeKind) => void;
}) {
  const s = strings.style;
  // 尚未設定外觀的形狀（舊畫布或預設外觀）視為「只有外框」
  const mode: FillMode = style.fillMode ?? 'outline';
  const withMode = (patch: Partial<Style>) => onStyle({ fillMode: mode, ...patch });
  const showCorners = kinds.length > 0 && kinds.every((k) => CORNER_KINDS.includes(k));
  const modes: { value: FillMode; label: string; icon: React.ReactNode }[] = [
    { value: 'solid', label: s.fillSolid, icon: <Square className="h-4 w-4" fill="currentColor" /> },
    { value: 'outline', label: s.fillOutline, icon: <Square className="h-4 w-4" /> },
    { value: 'dashed', label: s.fillDashed, icon: <SquareDashed className="h-4 w-4" /> },
  ];
  return (
    <>
      {showCorners ? (
        <div className="flex items-center rounded-lg bg-ink-100 p-0.5" role="radiogroup" aria-label={s.corners}>
          {CORNER_KINDS.map((k) => (
            <Tooltip key={k} content={strings.shapes[k]}>
              <button
                type="button"
                role="radio"
                aria-checked={kinds.every((x) => x === k)}
                aria-label={strings.shapes[k]}
                onClick={() => onKind(k)}
                className={cn(
                  'flex h-7 w-8 items-center justify-center rounded-md text-ink-600',
                  kinds.every((x) => x === k) && 'bg-white text-brand-800 shadow-sm',
                )}
              >
                <ShapeGlyph kind={k} className="h-4 w-4" />
              </button>
            </Tooltip>
          ))}
        </div>
      ) : null}
      <ColorPicker
        label={s.color}
        value={style.stroke ?? DEFAULT_SHAPE_COLOR}
        swatches={DEFAULT_PALETTE.map((p) => ({ name: p.name, color: p.color }))}
        onPick={(c) => withMode({ stroke: c })}
        extra={
          <div className="mt-1.5 flex w-[110px] flex-col gap-0.5 text-[11px] text-ink-500">
            {s.strokeWidth}
            <Segmented
              size="sm"
              fullWidth
              value={style.strokeWidth ?? 1.5}
              onChange={(v) => onStyle({ strokeWidth: v })}
              options={[1, 1.5, 2, 3, 4].map((w) => ({ value: w, label: String(w) }))}
            />
          </div>
        }
      />
      <div className="flex items-center rounded-lg bg-ink-100 p-0.5" role="radiogroup" aria-label={s.appearance}>
        {modes.map((m) => (
          <Tooltip key={m.value} content={m.label}>
            <button
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              aria-label={m.label}
              onClick={() => onStyle({ fillMode: m.value })}
              className={cn(
                'flex h-7 w-8 items-center justify-center rounded-md text-ink-600',
                mode === m.value && 'bg-white text-brand-800 shadow-sm',
              )}
            >
              {m.icon}
            </button>
          </Tooltip>
        ))}
      </div>
      <IconButton
        label={s.transparent}
        active={mode !== 'solid' && Boolean(style.transparent)}
        disabled={mode === 'solid'}
        onClick={() => withMode({ transparent: !style.transparent })}
      >
        <Blend className="h-4 w-4" />
      </IconButton>
    </>
  );
}

/** 連線的實線 / 虛線切換：渲染器依連線本身的 dashed 欄位畫虛線，不看 style.strokeStyle */
function LineStyleToggle({ dashed, onPick }: { dashed: boolean; onPick: (dashed: boolean) => void }) {
  const s = strings.style;
  const options = [
    { value: false, label: s.solid },
    { value: true, label: s.dashed },
  ];
  return (
    <div className="flex items-center rounded-lg bg-ink-100 p-0.5" role="radiogroup" aria-label={s.lineStyle}>
      {options.map((o) => (
        <Tooltip key={o.label} content={o.label}>
          <button
            type="button"
            role="radio"
            aria-checked={dashed === o.value}
            aria-label={o.label}
            onClick={() => onPick(o.value)}
            className={cn(
              'flex h-7 w-8 items-center justify-center rounded-md text-ink-600',
              dashed === o.value && 'bg-white text-brand-800 shadow-sm',
            )}
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
              <path
                d="M3 13L13 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeDasharray={o.value ? '3 3' : undefined}
              />
            </svg>
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/** 選取獨立圖示時的控制項：顏色、線條粗細、更換圖示 */
function IconStyleControls({
  value,
  weight,
  current,
  onColor,
  onWeight,
  onReplace,
  onRotate,
}: {
  value?: string;
  weight: number;
  current: string | null;
  onColor: (c: string) => void;
  onWeight: (w: number) => void;
  onReplace: (iconName: string) => void;
  onRotate?: () => void;
}) {
  const s = strings.icons;
  const [open, setOpen] = useState(false);
  const Current = current && current in lucideIcons ? lucideIcons[current as keyof typeof lucideIcons] : Smile;
  return (
    <>
      <ColorPicker
        label={s.color}
        value={value ?? '#33322d'}
        swatches={DEFAULT_PALETTE.map((p) => ({ name: p.name, color: p.color }))}
        onPick={onColor}
        extra={
          <div className="mt-1.5 flex w-[110px] flex-col gap-0.5 text-[11px] text-ink-500">
            {s.weight}
            <Segmented size="sm" fullWidth value={weight} onChange={onWeight} options={[1, 1.5, 2, 2.5, 3].map((w) => ({ value: w, label: String(w) }))} />
          </div>
        }
      />
      <Tooltip content={s.replace}>
        <button
          type="button"
          aria-label={s.replace}
          onClick={() => setOpen(true)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100"
        >
          <Current className="h-4 w-4" />
        </button>
      </Tooltip>
      {onRotate ? (
        <Tooltip content={s.rotate}>
          <button
            type="button"
            aria-label={s.rotate}
            onClick={onRotate}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100"
          >
            <RotateCw className="h-4 w-4" />
          </button>
        </Tooltip>
      ) : null}
      <IconLibrary open={open} onOpenChange={setOpen} onPick={onReplace} title={s.replace} current={current} />
    </>
  );
}

/** 多選時的對齊與等距分佈按鈕 */
function AlignControls({ editor, distribute }: { editor: BoardEditor; distribute: boolean }) {
  const a = strings.arrange;
  return (
    <>
      <IconButton label={a.alignLeft} onClick={() => editor.align('left')}>
        <AlignStartVertical className="h-4 w-4" />
      </IconButton>
      <IconButton label={a.alignHCenter} onClick={() => editor.align('hcenter')}>
        <AlignCenterVertical className="h-4 w-4" />
      </IconButton>
      <IconButton label={a.alignRight} onClick={() => editor.align('right')}>
        <AlignEndVertical className="h-4 w-4" />
      </IconButton>
      <Divider />
      <IconButton label={a.alignTop} onClick={() => editor.align('top')}>
        <AlignStartHorizontal className="h-4 w-4" />
      </IconButton>
      <IconButton label={a.alignVCenter} onClick={() => editor.align('vcenter')}>
        <AlignCenterHorizontal className="h-4 w-4" />
      </IconButton>
      <IconButton label={a.alignBottom} onClick={() => editor.align('bottom')}>
        <AlignEndHorizontal className="h-4 w-4" />
      </IconButton>
      <Divider />
      <IconButton label={a.distributeH} disabled={!distribute} onClick={() => editor.distribute('h')}>
        <AlignHorizontalDistributeCenter className="h-4 w-4" />
      </IconButton>
      <IconButton label={a.distributeV} disabled={!distribute} onClick={() => editor.distribute('v')}>
        <AlignVerticalDistributeCenter className="h-4 w-4" />
      </IconButton>
      <Divider />
    </>
  );
}

/** 群組 / 解除群組：多選時顯示群組，只選一個群組時顯示解除群組（含區塊時無法群組） */
function GroupButtons({ editor, selected }: { editor: BoardEditor; selected: BoardObject[] }) {
  const a = strings.arrange;
  if (selected.length > 1) {
    return (
      <IconButton label={a.group} shortcut="Mod+G" disabled={selected.some((o) => o.type === 'section')} onClick={() => editor.group()}>
        <Group className="h-4 w-4" />
      </IconButton>
    );
  }
  if (selected.length === 1 && selected[0].type === 'group') {
    return (
      <IconButton label={a.ungroup} shortcut="Mod+Shift+G" onClick={() => editor.ungroup()}>
        <Ungroup className="h-4 w-4" />
      </IconButton>
    );
  }
  return null;
}

/** 把選取的物件畫成透明背景的 PNG 放進剪貼簿，可直接貼到其他文書軟體（沿用 SPEC.md 第 4.5 節的匯出） */
function CopyImageButton({ editor }: { editor: BoardEditor }) {
  const { toast } = useDialogs();
  const s = strings.export;
  const copy = async () => {
    try {
      // 以 Promise 建立 ClipboardItem，Safari 才會保留這次點擊的使用者操作權限
      const png = editor.exportPng({ scope: 'selection', scale: 3, background: 'transparent' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast(s.copied);
    } catch (e) {
      const name = (e as Error).name;
      toast(name === 'ExportTooLargeError' ? s.tooLarge : name === 'ExportEmptyError' ? s.empty : s.copyFailed);
    }
  };
  return (
    <IconButton label={s.copyImage} onClick={() => void copy()}>
      <ClipboardCopy className="h-4 w-4" />
    </IconButton>
  );
}

function Divider() {
  return <div className="mx-0.5 h-5 w-px bg-ink-100" />;
}

interface Swatch {
  name: string;
  color: string;
  stroke?: string;
  text?: string;
}

function ColorPicker({
  label,
  value,
  swatches,
  onPick,
  fallback = '#ffffff',
  extra,
}: {
  label: string;
  value?: string;
  swatches: Swatch[];
  onPick: (color: string, entry?: Swatch) => void;
  /** 尚未設定顏色時按鈕顯示的顏色 */
  fallback?: string;
  extra?: React.ReactNode;
}) {
  const customRef = useRef<HTMLInputElement>(null);
  const isCustom = Boolean(value) && !swatches.some((sw) => sw.color.toLowerCase() === value!.toLowerCase());
  return (
    <Popover>
      <Tooltip content={label}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={label} className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-ink-100">
            <span className="h-4 w-4 rounded-full border border-ink-200" style={{ background: value ?? fallback }} />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="w-auto p-1.5">
        <div className="grid w-[110px] grid-cols-4 gap-0.5" role="listbox" aria-label={label}>
          {swatches.map((sw) => {
            const selected = value?.toLowerCase() === sw.color.toLowerCase();
            const title = strings.colors[sw.name] ?? sw.name;
            return (
              <button
                key={sw.name + sw.color}
                type="button"
                role="option"
                aria-selected={selected}
                title={title}
                aria-label={title}
                onClick={() => onPick(sw.color, sw)}
                className={cn(
                  'flex h-[26px] w-[26px] items-center justify-center rounded-md transition-colors hover:bg-ink-100',
                  selected && 'bg-brand-100 hover:bg-brand-100',
                )}
              >
                <span
                  className={cn('h-[22px] w-[22px] rounded-full border', selected ? 'border-white ring-2 ring-brand-600' : 'border-ink-200')}
                  style={{ background: sw.color }}
                />
              </button>
            );
          })}
          <button
            type="button"
            title={strings.style.customColor}
            aria-label={strings.style.customColor}
            onClick={() => customRef.current?.click()}
            className={cn(
              'relative flex h-[26px] w-[26px] items-center justify-center rounded-md hover:bg-ink-100',
              isCustom && 'bg-brand-100',
            )}
          >
            <span
              className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-ink-200 text-ink-600"
              style={isCustom ? { background: value } : undefined}
            >
              {isCustom ? null : <Plus className="h-3.5 w-3.5" />}
            </span>
            <input
              ref={customRef}
              type="color"
              tabIndex={-1}
              aria-hidden
              value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? value : '#4d5c6d'}
              onChange={(e) => onPick(e.target.value)}
              className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
            />
          </button>
        </div>
        {extra}
      </PopoverContent>
    </Popover>
  );
}

function ArrowMenu({ label, value, onPick, flip }: { label: string; value: ArrowHead; onPick: (v: ArrowHead) => void; flip?: boolean }) {
  const options: ArrowHead[] = ['none', 'arrow', 'triangle', 'circle', 'diamond'];
  return (
    <Menu>
      <Tooltip content={label}>
        <MenuTrigger asChild>
          <button type="button" aria-label={label} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100">
            <ArrowRight className={cn('h-4 w-4', flip && 'rotate-180', value === 'none' && 'opacity-40')} />
          </button>
        </MenuTrigger>
      </Tooltip>
      <MenuContent className="min-w-[120px]">
        {options.map((o) => (
          <MenuItem key={o} onSelect={() => onPick(o)}>
            <ArrowSample head={o} />
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function ArrowSample({ head }: { head: ArrowHead }) {
  return (
    <svg viewBox="0 0 48 12" className="h-3 w-12" aria-label={head}>
      <path d="M2 6h38" stroke="currentColor" strokeWidth="1.5" />
      {head === 'arrow' ? <path d="M36 2l6 4-6 4" fill="none" stroke="currentColor" strokeWidth="1.5" /> : null}
      {head === 'triangle' ? <path d="M36 2l7 4-7 4z" fill="currentColor" /> : null}
      {head === 'circle' ? <circle cx="41" cy="6" r="3.5" fill="currentColor" /> : null}
      {head === 'diamond' ? <path d="M36 6l4-4 4 4-4 4z" fill="currentColor" /> : null}
    </svg>
  );
}

const ICON_POSITIONS: { value: IconPosition; label: keyof typeof strings.style; Icon: typeof PanelTop }[] = [
  { value: 'top', label: 'iconTop', Icon: PanelTop },
  { value: 'bottom', label: 'iconBottom', Icon: PanelBottom },
  { value: 'left', label: 'iconLeft', Icon: PanelLeft },
  { value: 'right', label: 'iconRight', Icon: PanelRight },
];

/** 形狀內圖示相對於文字的位置：上、下、左、右 */
function IconPositionPicker({ value, onPick }: { value: IconPosition; onPick: (v: IconPosition) => void }) {
  const s = strings.style;
  const Current = ICON_POSITIONS.find((p) => p.value === value)?.Icon ?? PanelTop;
  return (
    <Popover>
      <Tooltip content={s.iconPosition}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={s.iconPosition} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100">
            <Current className="h-4 w-4" />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="w-auto p-1">
        <div className="flex gap-0.5" role="radiogroup" aria-label={s.iconPosition}>
          {ICON_POSITIONS.map(({ value: v, label, Icon }) => (
            <Tooltip key={v} content={s[label]}>
              <button
                type="button"
                role="radio"
                aria-checked={value === v}
                aria-label={s[label]}
                onClick={() => onPick(v)}
                className={cn('flex h-8 w-8 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100', value === v && 'bg-brand-50 text-brand-800')}
              >
                <Icon className="h-4 w-4" />
              </button>
            </Tooltip>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function IconPicker({ current, onPick }: { current: string | null; onPick: (name: string | null) => void }) {
  const [q, setQ] = useState('');
  const names = useMemo(() => {
    const query = q.trim().toLowerCase();
    const all = SHAPE_ICON_NAMES.filter((n) => n in lucideIcons);
    return (query ? all.filter((n) => n.toLowerCase().includes(query)) : all).slice(0, 72);
  }, [q]);
  return (
    <Popover>
      <Tooltip content={strings.style.icon}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={strings.style.icon} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100">
            <Smile className="h-4 w-4" />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="w-72">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={strings.style.iconSearch} aria-label={strings.style.iconSearch} />
        <div className="mt-2 grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
          {names.map((n) => {
            const Icon = lucideIcons[n as keyof typeof lucideIcons];
            return (
              <button
                key={n}
                type="button"
                title={n}
                aria-label={n}
                onClick={() => onPick(n)}
                className={cn('flex h-8 w-8 items-center justify-center rounded-lg hover:bg-ink-100', current === n && 'bg-brand-50 text-brand-800')}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
        {current ? (
          <button type="button" onClick={() => onPick(null)} className="mt-2 text-xs text-ink-500 hover:text-ink-800">
            {strings.style.removeIcon}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
