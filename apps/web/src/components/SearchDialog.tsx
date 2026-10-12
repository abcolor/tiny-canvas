import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { cn, Spinner, strings } from '@tinycanvas/ui';
import { useSearch } from '../api/hooks';
import { BoardIcon } from './BoardIcon';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-amber-100 px-0.5 text-ink-900">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** Mod+K 搜尋（檔名與畫布內容），見 SPEC.md 第 5.2 節 */
export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 150);
  const results = useSearch(dq);
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const list = results.data ?? [];

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [dq]);

  const go = (id: string) => {
    onOpenChange(false);
    nav(`/b/${id}`);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink-900/30" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl bg-white shadow-float"
        >
          <DialogPrimitive.Title className="sr-only">{strings.sidebar.search}</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-ink-100 px-4">
            <Search className="h-4 w-4 text-ink-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, list.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter' && list[active]) {
                  e.preventDefault();
                  go(list[active].file.id);
                }
              }}
              placeholder={strings.search.placeholder}
              aria-label={strings.search.placeholder}
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
            />
            {results.isFetching ? <Spinner className="h-4 w-4" /> : null}
          </div>
          <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
            {!dq ? (
              <li className="px-3 py-6 text-center text-sm text-ink-400">{strings.search.hint}</li>
            ) : list.length === 0 && !results.isFetching ? (
              <li className="px-3 py-6 text-center text-sm text-ink-400">{strings.search.noResults}</li>
            ) : (
              list.map((r, i) => (
                <li key={r.file.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.file.id)}
                    className={cn('flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left', i === active && 'bg-ink-50')}
                  >
                    <BoardIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{highlight(r.file.title, dq)}</span>
                      {r.snippet ? <span className="block truncate text-xs text-ink-500">{highlight(r.snippet, dq)}</span> : null}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
