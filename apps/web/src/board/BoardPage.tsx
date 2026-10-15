import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Cloud, CloudOff, Download, History, Keyboard, Loader2, Share2, Trash2 } from 'lucide-react';
import type { BoardEditor } from '@tinycanvas/canvas-engine';
import { getObjects, localOrigin, restoreFromDoc } from '@tinycanvas/shared';
import { Button, cn, IconButton, shortcutLabel, Spinner, strings } from '@tinycanvas/ui';
import { fileApi, invalidateTree, useFile, useFiles, useFolders } from '../api/hooks';
import { useLayout } from '../components/AppLayout';
import { useDialogs } from '../components/dialogs';
import { BoardCanvas } from './BoardCanvas';
import { createImageLoader } from './assets';
import { useBoardDoc, type SyncStatus } from './useBoardDoc';
import { ShareDialog } from './ShareDialog';
import { HistoryPanel, PreviewBanner, type PreviewState } from './HistoryPanel';
import { LinkCardPicker } from './LinkCardPicker';
import {
  encodeThumbnail,
  thumbnailApi,
  thumbnailStale,
  ThumbnailSync,
  THUMBNAIL_MAX_HEIGHT,
  THUMBNAIL_MAX_WIDTH,
} from './thumbnail';

export function BoardPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const { userId, sidebarOpen, openShortcuts } = useLayout();
  const file = useFile(fileId);
  const board = useBoardDoc(fileId!, { kind: 'session', userId });
  const nav = useNavigate();
  const qc = useQueryClient();
  const { prompt, toast } = useDialogs();
  const folders = useFolders();
  const folder = folders.data?.find((f) => f.id === file.data?.folderId);
  const tabFiles = useFiles(folder?.id ?? 'root', Boolean(folder?.isTabbed));
  const loadImage = useMemo(() => createImageLoader(), []);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [linkPicker, setLinkPicker] = useState<((id: string, title: string) => void) | null>(null);
  const editorRef = useRef<BoardEditor | null>(null);
  const [editor, setEditor] = useState<BoardEditor | null>(null);
  const thumbRef = useRef<ThumbnailSync | null>(null);
  const fileData = file.data?.id === fileId ? file.data : undefined;

  // 首頁卡片縮圖（見 docs/DECISIONS.md 2026-10-15）
  useEffect(() => {
    if (!editor || !fileData) return;
    const id = fileData.id;
    const sync = new ThumbnailSync(
      editor.doc,
      {
        capture: () => {
          const canvas = editor.renderThumbnail(THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT);
          return canvas ? encodeThumbnail(canvas) : null;
        },
        upload: (blob) => thumbnailApi.upload(id, blob),
        remove: () => thumbnailApi.remove(id),
        onSaved: () => {
          void qc.invalidateQueries({ queryKey: ['files'] });
          void qc.invalidateQueries({ queryKey: ['file'] });
          void qc.invalidateQueries({ queryKey: ['search'] });
        },
      },
      { stale: thumbnailStale(fileData, getObjects(editor.doc).size > 0) },
    );
    thumbRef.current = sync;
    const onHidden = () => {
      if (document.visibilityState === 'hidden') sync.flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      sync.dispose();
      if (thumbRef.current === sync) thumbRef.current = null;
    };
    // fileData 只用來在開啟時判斷是否過時；同一個檔案重新取得資料不必重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, fileData?.id, qc]);

  if (file.isError || board.status === 'denied') {
    return <Centered>{strings.board.notFound}</Centered>;
  }
  if (board.status === 'trashed') {
    return (
      <Centered>
        <Trash2 className="h-8 w-8 text-ink-300" />
        <p>{strings.board.trashed}</p>
        <Button onClick={() => nav('/trash')}>{strings.sidebar.trash}</Button>
      </Centered>
    );
  }

  const title = file.data?.title ?? '';
  const rename = () =>
    file.data &&
    prompt({
      title: strings.common.rename,
      label: strings.files.boardName,
      initial: title,
      onSubmit: async (t) => {
        await fileApi.update(file.data!.id, { title: t });
        invalidateTree(qc);
      },
    });

  const restore = () => {
    const editor = editorRef.current;
    if (!preview || !editor) return;
    // 以差異套用在目前文件上，一個 transaction、可用 Mod+Z 復原（見 SPEC.md 第 5.5 節）
    editor.undoManager.stopCapturing();
    restoreFromDoc(board.doc, preview.doc, localOrigin);
    editor.undoManager.stopCapturing();
    setPreview(null);
    toast(strings.history.restored.replace('Mod+Z', shortcutLabel('Mod+Z')));
  };

  return (
    <div className="relative flex h-full flex-col">
      {folder?.isTabbed ? (
        <div className={cn('flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-ink-100 bg-white px-2', !sidebarOpen && 'pl-12')} role="tablist">
          {(tabFiles.data ?? []).map((f) => (
            <NavLink
              key={f.id}
              to={`/b/${f.id}`}
              role="tab"
              aria-selected={f.id === fileId}
              className={cn(
                'max-w-[200px] truncate rounded-t-lg border border-b-0 px-3 py-1.5 text-sm',
                f.id === fileId ? 'border-ink-100 bg-ink-50 font-medium text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800',
              )}
            >
              {f.title}
            </NavLink>
          ))}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {board.ready ? (
          <BoardCanvas
            doc={board.doc}
            title={title}
            loadImage={loadImage}
            onOpenLink={(id) => nav(`/b/${id}`)}
            exportOpen={exportOpen}
            onExportOpenChange={setExportOpen}
            onInsertLinkCard={(insert) => setLinkPicker(() => insert)}
            onEditor={(e) => {
              // 編輯器銷毀前先畫出縮圖（React 不保證父子元件 effect 清除的先後）
              if (!e) thumbRef.current?.dispose();
              editorRef.current = e;
              setEditor(e);
            }}
          />
        ) : (
          <Centered>
            <Spinner />
            <p className="text-sm">{strings.board.connecting}</p>
          </Centered>
        )}

        {preview ? (
          <div className="absolute inset-0 z-30">
            <BoardCanvas key={preview.version.id} doc={preview.doc} readOnly loadImage={loadImage} />
            <PreviewBanner fileId={fileId!} title={title} preview={preview} onRestore={restore} onExit={() => setPreview(null)} />
          </div>
        ) : null}

        {/* 側邊欄收合時讓出左上角的「展開側邊欄」按鈕（cn 不合併衝突的 class，只能擇一）；與它同樣 top-2、高 32 px，垂直置中對齊 */}
        <div className={cn('pointer-events-none absolute top-2 z-20 flex items-center gap-2', !sidebarOpen && !folder?.isTabbed ? 'left-12' : 'left-3')}>
          <button
            type="button"
            onClick={rename}
            className="pointer-events-auto h-8 max-w-[40vw] truncate rounded-xl border border-ink-100 bg-white px-3 text-sm font-medium shadow-float hover:bg-ink-50"
            title={strings.common.rename}
          >
            {title || '…'}
          </button>
          <StatusChip status={board.status} />
        </div>
        <div className="pointer-events-none absolute right-3 top-2 z-20 flex items-center gap-1">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-ink-100 bg-white p-1 shadow-float">
            <IconButton label={strings.board.shortcuts} shortcut="Mod+/" onClick={openShortcuts}>
              <Keyboard className="h-4 w-4" />
            </IconButton>
            <IconButton label={strings.board.history} active={historyOpen} onClick={() => setHistoryOpen((o) => !o)}>
              <History className="h-4 w-4" />
            </IconButton>
            <IconButton label={strings.board.export} shortcut="Mod+Shift+E" onClick={() => setExportOpen(true)}>
              <Download className="h-4 w-4" />
            </IconButton>
          </div>
          <Button variant="primary" className="pointer-events-auto shadow-float" onClick={() => setShareOpen(true)}>
            <Share2 className="h-4 w-4" />
            {strings.board.share}
          </Button>
        </div>
        {historyOpen ? (
          <HistoryPanel
            fileId={fileId!}
            doc={board.doc}
            preview={preview}
            onPreview={setPreview}
            onClose={() => {
              setHistoryOpen(false);
              setPreview(null);
            }}
          />
        ) : null}
      </div>
      <ShareDialog fileId={fileId!} open={shareOpen} onOpenChange={setShareOpen} />
      <LinkCardPicker
        open={linkPicker !== null}
        onOpenChange={(o) => !o && setLinkPicker(null)}
        excludeId={fileId!}
        onPick={(id, t) => linkPicker?.(id, t)}
      />
    </div>
  );
}

function StatusChip({ status }: { status: SyncStatus }) {
  const s = strings.board;
  const map: Partial<Record<SyncStatus, [React.ReactNode, string, string]>> = {
    connecting: [<Loader2 key="i" className="h-3.5 w-3.5 animate-spin" />, s.connecting, 'text-ink-500'],
    saving: [<Loader2 key="i" className="h-3.5 w-3.5 animate-spin" />, s.syncing, 'text-ink-500'],
    synced: [<Cloud key="i" className="h-3.5 w-3.5" />, s.synced, 'text-ink-400'],
    offline: [<CloudOff key="i" className="h-3.5 w-3.5" />, s.offline, 'text-amber-700 bg-amber-50 border-amber-200'],
  };
  const entry = map[status];
  if (!entry) return null;
  return (
    <span
      className={cn('pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-xl border border-ink-100 bg-white px-2.5 text-xs shadow-float', entry[2])}
      data-testid="sync-status"
      data-status={status}
      role="status"
    >
      {entry[0]}
      {entry[1]}
    </span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-500">{children}</div>;
}
