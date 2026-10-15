import { useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FilePlus2, Folder as FolderIcon, FolderPlus, Star, Upload } from 'lucide-react';
import { Button, Spinner, strings } from '@tinycanvas/ui';
import type { FileDto } from '@tinycanvas/shared';
import { useFiles, useFolders } from '../api/hooks';
import { useFileActions } from '../components/fileActions';
import { FileMenu } from '../components/Sidebar';
import { BoardIcon } from '../components/BoardIcon';
import { formatRelative } from '../lib/time';
import { thumbnailUrl } from '../board/thumbnail';

/** 首頁（最近檔案）、我的最愛、資料夾內容 */
export function FileListPage({ mode }: { mode: 'recent' | 'favorite' | 'folder' }) {
  const { folderId } = useParams();
  const nav = useNavigate();
  const actions = useFileActions();
  const folders = useFolders();
  const key = mode === 'folder' ? folderId! : mode;
  const files = useFiles(key);
  const folder = mode === 'folder' ? folders.data?.find((f) => f.id === folderId) : undefined;
  const subfolders = mode === 'folder' ? (folders.data ?? []).filter((f) => f.parentId === folderId) : [];
  const title =
    mode === 'recent' ? strings.files.homeTitle : mode === 'favorite' ? strings.files.favoritesTitle : (folder?.name ?? '');
  const targetFolder = mode === 'folder' ? (folderId ?? null) : null;
  const importInput = useRef<HTMLInputElement>(null);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="flex gap-2">
          {/* 匯入白板 JSON（見 docs/DECISIONS.md 2026-10-15「白板匯出與匯入」） */}
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="import-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void actions.importBoard(f, targetFolder);
            }}
          />
          <Button onClick={() => importInput.current?.click()}>
            <Upload className="h-4 w-4" />
            {strings.files.import}
          </Button>
          {mode !== 'favorite' ? (
            <Button onClick={() => actions.newFolder(targetFolder)}>
              <FolderPlus className="h-4 w-4" />
              {strings.sidebar.newFolder}
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => actions.newBoard(targetFolder)}>
            <FilePlus2 className="h-4 w-4" />
            {strings.sidebar.newBoard}
          </Button>
        </div>
      </div>
      {files.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          {subfolders.length > 0 ? (
            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {subfolders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => nav(`/folder/${f.id}`)}
                  className="flex items-center gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3 text-left text-sm hover:border-ink-200 hover:shadow-sm"
                >
                  <FolderIcon className="h-5 w-5 text-ink-400" />
                  <span className="truncate font-medium">{f.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          {(files.data ?? []).length === 0 && subfolders.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-ink-200 py-16 text-ink-500">
              <BoardIcon className="h-10 w-10 text-ink-300" />
              <p>{mode === 'favorite' ? strings.files.emptyFavorites : strings.files.empty}</p>
              {mode !== 'favorite' ? (
                <Button variant="primary" onClick={() => actions.newBoard(targetFolder)}>
                  {strings.files.createFirst}
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(files.data ?? []).map((f) => (
                <FileCard key={f.id} file={f} onOpen={() => nav(`/b/${f.id}`)} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function FileCard({ file, onOpen }: { file: FileDto; onOpen: () => void }) {
  const folders = useFolders();
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col overflow-hidden rounded-xl border border-ink-100 bg-white text-left hover:border-ink-200 hover:shadow-sm"
      >
        {/* 預覽區用接近白的淺灰，與卡片下方的白色區隔 */}
        <div className="flex h-28 items-center justify-center bg-[#FAFBFC]">
          {file.thumbnailAt ? (
            <img
              src={thumbnailUrl(file)}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="max-h-full max-w-full object-contain p-3"
              data-testid="file-thumbnail"
            />
          ) : (
            <BoardIcon className="h-8 w-8 text-brand-400" />
          )}
        </div>
        <div className="flex flex-col gap-0.5 px-4 py-3">
          <span className="flex items-center gap-1.5 truncate text-sm font-medium">
            {file.isFavorite ? <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" /> : null}
            <span className="truncate">{file.title}</span>
          </span>
          <span className="text-xs text-ink-500">
            {strings.files.updatedAt} {formatRelative(file.updatedAt)}
          </span>
        </div>
      </button>
      <div className="absolute right-2 top-2">
        <FileMenu file={file} folders={folders.data ?? []} triggerClassName="bg-white/90 shadow-sm" />
      </div>
    </li>
  );
}
