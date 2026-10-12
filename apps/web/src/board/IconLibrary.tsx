import { useEffect, useMemo, useState } from 'react';
import { icons as lucideIcons } from 'lucide-react';
import { SHAPE_ICON_NAMES } from '@tinycanvas/canvas-engine';
import { cn, Dialog, format, Input, strings } from '@tinycanvas/ui';
import { searchIcons } from './iconKeywords';

const ALL_ICON_NAMES = Object.keys(lucideIcons);

// Lucide 官方標籤（約 140 KB），第一次開啟圖示庫時才載入
let tagsPromise: Promise<Record<string, string>> | null = null;
function loadTags() {
  tagsPromise ??= import('./lucide-tags.json').then((m) => m.default as Record<string, string>);
  return tagsPromise;
}
const POPULAR = SHAPE_ICON_NAMES.filter((n) => n in lucideIcons);

/**
 * 圖示庫（快捷鍵 I）：從全部 Lucide Icons 中以中文或英文名稱搜尋，點一下插入（或替換）圖示。
 * 未輸入關鍵字時顯示常用圖示。
 */
export function IconLibrary({
  open,
  onOpenChange,
  onPick,
  title = strings.icons.title,
  current,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (iconName: string) => void;
  title?: string;
  current?: string | null;
}) {
  const s = strings.icons;
  const [q, setQ] = useState('');
  const [tags, setTags] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (open && !tags) void loadTags().then(setTags, () => undefined);
  }, [open, tags]);
  const results = useMemo(() => (q.trim() ? searchIcons(ALL_ICON_NAMES, q, tags) : POPULAR), [q, tags]);
  const pick = (name: string) => {
    onOpenChange(false);
    setQ('');
    setTimeout(() => onPick(name), 0);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQ('');
      }}
      title={title}
      description={format(s.total, { n: ALL_ICON_NAMES.length.toLocaleString() })}
      width="max-w-2xl"
    >
      <Input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && results[0]) {
            e.preventDefault();
            pick(results[0]);
          }
        }}
        placeholder={s.searchPlaceholder}
        aria-label={s.searchPlaceholder}
      />
      <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-400">{q.trim() ? s.results : s.popular}</h3>
      {results.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-400">{s.noResults}</p>
      ) : (
        <div className="grid max-h-[50vh] grid-cols-6 gap-1.5 overflow-y-auto sm:grid-cols-8" role="listbox" aria-label={title}>
          {results.map((name) => {
            const Icon = lucideIcons[name as keyof typeof lucideIcons];
            return (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={current === name}
                title={name}
                aria-label={name}
                onClick={() => pick(name)}
                className={cn(
                  'flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-transparent text-ink-700 hover:border-brand-300 hover:bg-brand-50',
                  current === name && 'border-brand-400 bg-brand-50',
                )}
              >
                <Icon className="h-6 w-6" strokeWidth={1.75} />
                <span className="w-full truncate px-1 text-center text-[10px] text-ink-400">{name}</span>
              </button>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
