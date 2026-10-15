import { useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Image as ImageIcon, Link2, Search, Smile, Spline, Table2, ToggleRight, Type } from 'lucide-react';
import type { BoardEditor, Tool } from '@tinycanvas/canvas-engine';
import { SHAPE_KINDS, WIREFRAME_KINDS, type FrameKind } from '@tinycanvas/shared';
import { cn, dictionaries, format, strings, type Strings } from '@tinycanvas/ui';
import { ShapeGlyph } from './ShapeGlyph';
import { FrameIcon, WireframeIcon } from './componentIcons';

interface Entry {
  id: string;
  label: string;
  keywords: string;
  icon: React.ReactNode;
  run: () => void;
}

/** 「/」指令面板：以名稱搜尋並插入任意元件（見 SPEC.md 第 3.7 節） */
/** 所有語系的名稱，讓不論介面語系為何都能用中文或英文搜尋 */
function inAll(pick: (d: Strings) => string): string {
  return Object.values(dictionaries).map(pick).join(' ');
}

export function CommandPalette({
  open,
  onOpenChange,
  editor,
  onInsertLinkCard,
  onOpenWireframes,
  onOpenIcons,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editor: BoardEditor;
  onInsertLinkCard: () => void;
  onOpenWireframes: () => void;
  onOpenIcons: () => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const entries = useMemo<Entry[]>(() => {
    const tool = (t: Tool) => () => editor.insertWithTool(t);
    const list: Entry[] = [
      ...SHAPE_KINDS.map((k) => ({
        id: `shape:${k}`,
        label: strings.shapes[k],
        keywords: `${k} shape ${inAll((d) => `${d.tools.shapes} ${d.shapes[k]}`)}`,
        icon: <ShapeGlyph kind={k} className="h-4 w-4" />,
        run: tool({ kind: 'shape', shapeKind: k }),
      })),
      { id: 'text', label: strings.tools.text, keywords: `text ${inAll((d) => d.tools.text)}`, icon: <Type className="h-4 w-4" />, run: tool({ kind: 'text' }) },
      {
        id: 'heading',
        label: strings.tools.heading,
        keywords: `heading title ${inAll((d) => d.tools.heading)}`,
        icon: <Type className="h-4 w-4" />,
        run: tool({ kind: 'text', variant: 'heading' }),
      },
      { id: 'connector', label: strings.tools.connector, keywords: `connector line arrow ${inAll((d) => d.tools.connector)}`, icon: <Spline className="h-4 w-4" />, run: () => editor.setTool({ kind: 'connector' }) },
      { id: 'table', label: strings.tools.table, keywords: `table ${inAll((d) => d.tools.table)}`, icon: <Table2 className="h-4 w-4" />, run: tool({ kind: 'table' }) },
      ...(['phone', 'tablet', 'browser', 'window'] as FrameKind[]).map((k) => ({
        id: `frame:${k}`,
        label: format(strings.palette.frameLabel, { tool: strings.tools.deviceFrame, frame: strings.frames[k] }),
        keywords: `frame device ${k} ${inAll((d) => `${d.tools.deviceFrame} ${d.frames[k]}`)}`,
        icon: <FrameIcon kind={k} />,
        run: tool({ kind: 'frame', frameKind: k }),
      })),
      ...WIREFRAME_KINDS.map((k) => ({
        id: `wf:${k}`,
        label: strings.wireframes.kinds[k],
        keywords: `${k} wireframe ${inAll((d) => `${d.tools.wireframe} ${d.wireframes.kinds[k]}`)}`,
        icon: <WireframeIcon kind={k} />,
        run: tool({ kind: 'wireframe', componentKind: k }),
      })),
      { id: 'wflib', label: strings.wireframes.title, keywords: `wireframe library ${inAll((d) => d.wireframes.title)}`, icon: <ToggleRight className="h-4 w-4" />, run: onOpenWireframes },
      { id: 'icon', label: strings.icons.title, keywords: `icon lucide 圖標 ${inAll((d) => d.icons.title)}`, icon: <Smile className="h-4 w-4" />, run: onOpenIcons },
      { id: 'link', label: strings.tools.linkCard, keywords: `link card file ${inAll((d) => d.tools.linkCard)}`, icon: <Link2 className="h-4 w-4" />, run: onInsertLinkCard },
      { id: 'image', label: strings.tools.image, keywords: `image picture ${inAll((d) => d.tools.image)}`, icon: <ImageIcon className="h-4 w-4" />, run: () => document.querySelector<HTMLInputElement>('input[type=file][accept^="image"]')?.click() },
    ];
    return list;
  }, [editor, onInsertLinkCard, onOpenWireframes, onOpenIcons]);

  const query = q.trim().toLowerCase();
  const results = query ? entries.filter((e) => e.label.toLowerCase().includes(query) || e.keywords.toLowerCase().includes(query)) : entries;
  const pick = (e: Entry) => {
    onOpenChange(false);
    setQ('');
    setTimeout(e.run, 0);
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQ('');
        setActive(0);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[18vh] z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-float"
        >
          <DialogPrimitive.Title className="sr-only">{strings.palette.placeholder}</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-ink-100 px-3">
            <Search className="h-4 w-4 text-ink-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, results.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter' && results[active]) {
                  e.preventDefault();
                  pick(results[active]);
                }
              }}
              placeholder={strings.palette.placeholder}
              aria-label={strings.palette.placeholder}
              className="h-11 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <ul className="max-h-80 overflow-y-auto p-1.5" role="listbox">
            {results.length === 0 ? <li className="px-3 py-6 text-center text-sm text-ink-400">{strings.palette.noResults}</li> : null}
            {results.map((e, i) => (
              <li key={e.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(e)}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm', i === active && 'bg-ink-100')}
                >
                  <span className="text-ink-500">{e.icon}</span>
                  {e.label}
                </button>
              </li>
            ))}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
