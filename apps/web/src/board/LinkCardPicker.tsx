import { useState } from 'react';
import { Dialog, Input, strings } from '@tinycanvas/ui';
import { useFiles, useSearch } from '../api/hooks';
import { BoardIcon } from '../components/BoardIcon';

/** 選擇要放上畫布的檔案連結卡目標（見 SPEC.md 第 4.4 節） */
export function LinkCardPicker({
  open,
  onOpenChange,
  excludeId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  excludeId: string;
  onPick: (fileId: string, title: string) => void;
}) {
  const [q, setQ] = useState('');
  const recent = useFiles('recent', open);
  const search = useSearch(q);
  const files = (q.trim() ? (search.data ?? []).map((r) => r.file) : (recent.data ?? [])).filter((f) => f.id !== excludeId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={strings.linkCard.pickTitle}>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={strings.search.placeholder} aria-label={strings.search.placeholder} />
      <ul className="mt-3 max-h-72 overflow-y-auto">
        {files.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => {
                onPick(f.id, f.title);
                onOpenChange(false);
                setQ('');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink-50"
            >
              <BoardIcon className="h-4 w-4 text-ink-400" />
              <span className="truncate">{f.title}</span>
            </button>
          </li>
        ))}
        {files.length === 0 ? <li className="py-6 text-center text-sm text-ink-400">{strings.search.noResults}</li> : null}
      </ul>
    </Dialog>
  );
}
