import { useState } from 'react';
import type { BoardEditor } from '@tinycanvas/canvas-engine';
import type { WireframeKind } from '@tinycanvas/shared';
import { Dialog, Input, strings } from '@tinycanvas/ui';
import { WireframeIcon } from './componentIcons';

const GROUPS: { key: keyof typeof strings.wireframes.groups; kinds: WireframeKind[] }[] = [
  {
    key: 'controls',
    kinds: ['button', 'button_secondary', 'link_button', 'icon_button', 'input', 'textarea', 'search', 'select', 'checkbox', 'radio', 'switch', 'slider', 'stepper', 'date_picker', 'rating'],
  },
  { key: 'navigation', kinds: ['navbar', 'sidebar', 'tabs', 'segmented', 'breadcrumb', 'pagination', 'menu', 'accordion'] },
  { key: 'content', kinds: ['heading', 'paragraph', 'label', 'card', 'list', 'table', 'divider', 'badge', 'tag', 'avatar'] },
  { key: 'feedback', kinds: ['modal', 'toast', 'tooltip', 'progress', 'spinner'] },
  { key: 'media', kinds: ['image_placeholder', 'video_placeholder', 'chart_placeholder', 'map_placeholder'] },
];

/** 線框圖元件庫（快捷鍵 W），見 SPEC.md 第 4.2 節 */
export function WireframeLibrary({ open, onOpenChange, editor }: { open: boolean; onOpenChange: (o: boolean) => void; editor: BoardEditor }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const insert = (k: WireframeKind) => {
    onOpenChange(false);
    setQ('');
    setTimeout(() => editor.insertWithTool({ kind: 'wireframe', componentKind: k }), 0);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={strings.wireframes.title} width="max-w-2xl">
      <Input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={strings.wireframes.searchPlaceholder}
        aria-label={strings.wireframes.searchPlaceholder}
      />
      <div className="mt-4 flex flex-col gap-5">
        {GROUPS.map((g) => {
          const kinds = g.kinds.filter((k) => !query || k.includes(query) || strings.wireframes.kinds[k].includes(query));
          if (kinds.length === 0) return null;
          return (
            <section key={g.key}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">{strings.wireframes.groups[g.key]}</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {kinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => insert(k)}
                    className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl border border-ink-100 px-1 text-xs text-ink-700 hover:border-brand-300 hover:bg-brand-50"
                  >
                    <WireframeIcon kind={k} className="h-5 w-5 text-ink-500" />
                    <span className="truncate">{strings.wireframes.kinds[k]}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}
