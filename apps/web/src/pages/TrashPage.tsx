import { useState } from 'react';
import { Folder as FolderIcon, RotateCcw, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, Spinner, strings } from '@tinycanvas/ui';
import { useQueryClient } from '@tanstack/react-query';
import { fileApi, folderApi, invalidateTree, useTrash } from '../api/hooks';
import { BoardIcon } from '../components/BoardIcon';
import { formatRelative } from '../lib/time';

export function TrashPage() {
  const trash = useTrash();
  const qc = useQueryClient();
  const [pending, setPending] = useState<{ kind: 'file' | 'folder'; id: string } | null>(null);
  const s = strings.trash;
  const items = [
    ...(trash.data?.folders ?? []).map((f) => ({ kind: 'folder' as const, id: f.id, name: f.name, deletedAt: f.deletedAt! })),
    ...(trash.data?.files ?? []).map((f) => ({ kind: 'file' as const, id: f.id, name: f.title, deletedAt: f.deletedAt! })),
  ].sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));

  const run = async (fn: () => Promise<unknown>) => {
    await fn();
    invalidateTree(qc);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <h1 className="text-xl font-semibold">{s.title}</h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">{s.hint}</p>
      {trash.isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink-200 py-16 text-center text-ink-500">{s.empty}</p>
      ) : (
        <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 bg-white">
          {items.map((it) => (
            <li key={it.kind + it.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              {it.kind === 'folder' ? <FolderIcon className="h-5 w-5 text-ink-400" /> : <BoardIcon className="h-5 w-5 text-ink-400" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{it.name}</div>
                <div className="text-xs text-ink-500">
                  {s.deletedAt} {formatRelative(it.deletedAt)}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => run(() => (it.kind === 'file' ? fileApi.restore(it.id) : folderApi.restore(it.id)))}
              >
                <RotateCcw className="h-4 w-4" />
                {s.restore}
              </Button>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setPending({ kind: it.kind, id: it.id })}>
                <Trash2 className="h-4 w-4" />
                {s.deleteForever}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={s.deleteForever}
        message={s.deleteForeverConfirm}
        cancelLabel={strings.common.cancel}
        actions={[
          {
            label: s.deleteForever,
            variant: 'danger',
            onSelect: () => {
              const p = pending!;
              void run(() => (p.kind === 'file' ? fileApi.destroy(p.id) : folderApi.destroy(p.id)));
              setPending(null);
            },
          },
        ]}
      />
    </div>
  );
}
