import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bookmark, Clock, X } from 'lucide-react';
import * as Y from 'yjs';
import { docFromState, type FileDto, type VersionDto } from '@tinycanvas/shared';
import { Button, cn, format, IconButton, Input, Spinner, strings } from '@tinycanvas/ui';
import { api } from '../api/client';
import { invalidateTree, versionsPage } from '../api/hooks';
import { useDialogs } from '../components/dialogs';
import { formatDateTime } from '../lib/time';

// 與 copyVersionSchema 的標題上限一致
const COPY_TITLE_MAX = 200;

export interface PreviewState {
  version: VersionDto;
  doc: Y.Doc;
}

/** 下載某個版本的 Yjs 狀態並建立暫時文件（見 SPEC.md 第 5.5 節） */
export async function loadVersionDoc(fileId: string, versionId: string): Promise<Y.Doc> {
  const res = await api<Response>(`/api/files/${fileId}/versions/${versionId}`, { raw: true });
  return docFromState(new Uint8Array(await res.arrayBuffer()));
}

/** 右側的版本歷史面板：由新到舊列出、增量載入、命名版本、預覽 */
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function HistoryPanel({
  fileId,
  doc,
  onClose,
  preview,
  onPreview,
}: {
  fileId: string;
  /** 目前開啟的文件；命名版本時一併送出，確保包含尚未寫回資料庫的修改 */
  doc: Y.Doc;
  onClose: () => void;
  preview: PreviewState | null;
  onPreview: (p: PreviewState | null) => void;
}) {
  const s = strings.history;
  const [versions, setVersions] = useState<VersionDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const load = async (c: string | null, replace: boolean) => {
    setLoading(true);
    try {
      const page = await versionsPage(fileId, c);
      setVersions((v) => (replace ? page.versions : [...v, ...page.versions]));
      setCursor(page.nextCursor);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const nameVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    await api(`/api/files/${fileId}/versions`, {
      method: 'POST',
      body: { label: label.trim(), state: toBase64(Y.encodeStateAsUpdate(doc)) },
    });
    setLabel('');
    await load(null, true);
  };

  const open = async (v: VersionDto) => {
    setLoadingId(v.id);
    try {
      onPreview({ version: v, doc: await loadVersionDoc(fileId, v.id) });
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <aside className="pointer-events-auto absolute bottom-0 right-0 top-0 z-30 flex w-80 max-w-[calc(100vw-16px)] flex-col border-l border-ink-100 bg-white shadow-float" aria-label={s.title}>
      <div className="flex h-12 items-center justify-between border-b border-ink-100 px-4">
        <h2 className="text-sm font-semibold">{s.title}</h2>
        <IconButton label={strings.common.close} onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <form onSubmit={nameVersion} className="flex gap-2 border-b border-ink-100 p-3">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={s.namePlaceholder} aria-label={s.nameVersion} maxLength={200} />
        <Button type="submit" size="md" disabled={!label.trim()}>
          {strings.common.save}
        </Button>
      </form>
      <ul className="flex-1 overflow-y-auto p-2">
        {versions.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => open(v)}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-ink-50',
                preview?.version.id === v.id && 'bg-brand-50',
              )}
            >
              {v.label ? <Bookmark className="mt-0.5 h-4 w-4 text-brand-600" /> : <Clock className="mt-0.5 h-4 w-4 text-ink-400" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{v.label ?? s.auto}</span>
                <span className="block text-xs text-ink-500">{formatDateTime(v.createdAt)}</span>
              </span>
              {loadingId === v.id ? <Spinner className="h-4 w-4" /> : null}
            </button>
          </li>
        ))}
        {!loading && versions.length === 0 ? <li className="py-8 text-center text-sm text-ink-400">{s.empty}</li> : null}
        {loading ? (
          <li className="flex justify-center py-4">
            <Spinner />
          </li>
        ) : cursor ? (
          <li className="flex justify-center py-2">
            <Button size="sm" variant="ghost" onClick={() => load(cursor, false)}>
              {s.loadMore}
            </Button>
          </li>
        ) : null}
      </ul>
    </aside>
  );
}

/** 預覽中的頂部提示列：還原、另存成複本、結束預覽 */
export function PreviewBanner({
  fileId,
  title,
  preview,
  onRestore,
  onExit,
}: {
  fileId: string;
  /** 目前檔案標題，用來組出複本名稱 */
  title: string;
  preview: PreviewState;
  onRestore: () => void;
  onExit: () => void;
}) {
  const s = strings.history;
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    setBusy(true);
    try {
      const f = await api<FileDto>(`/api/files/${fileId}/versions/${preview.version.id}/copy`, {
        method: 'POST',
        body: { title: format(s.copyTitle, { title }).slice(0, COPY_TITLE_MAX) },
      });
      invalidateTree(qc);
      toast(s.copyCreated);
      nav(`/b/${f.id}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 z-40 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm shadow-float">
      <span className="text-ink-600">
        {s.previewing}
        <span className="font-medium text-ink-900">{preview.version.label ?? formatDateTime(preview.version.createdAt)}</span>
      </span>
      <Button size="sm" variant="primary" onClick={onRestore} data-testid="restore-version">
        {s.restore}
      </Button>
      <Button size="sm" loading={busy} onClick={copy}>
        {s.saveAsCopy}
      </Button>
      <Button size="sm" variant="ghost" onClick={onExit}>
        {s.exitPreview}
      </Button>
    </div>
  );
}
