import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { strings } from '@tinycanvas/ui';
import type { FileDto, FolderDto } from '@tinycanvas/shared';
import { ApiError } from '../api/client';
import { fileApi, folderApi, invalidateTree } from '../api/hooks';
import { useDialogs } from './dialogs';

/** 檔案與資料夾的常用操作（新增、改名、移動、刪除），側邊欄與清單共用 */
export function useFileActions() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { prompt, toast } = useDialogs();
  const done = () => invalidateTree(qc);

  return {
    newBoard: async (folderId: string | null) => {
      const f = await fileApi.create(strings.common.untitled, folderId);
      done();
      nav(`/b/${f.id}`);
    },
    newFolder: (parentId: string | null) =>
      prompt({
        title: strings.sidebar.newFolder,
        label: strings.files.folderName,
        initial: strings.common.newFolder,
        confirmLabel: strings.common.create,
        onSubmit: async (name) => {
          await folderApi.create(name, parentId);
          done();
        },
      }),
    renameFile: (file: FileDto) =>
      prompt({
        title: strings.common.rename,
        label: strings.files.boardName,
        initial: file.title,
        onSubmit: async (title) => {
          await fileApi.update(file.id, { title });
          done();
        },
      }),
    renameFolder: (folder: FolderDto) =>
      prompt({
        title: strings.common.rename,
        label: strings.files.folderName,
        initial: folder.name,
        onSubmit: async (name) => {
          await folderApi.update(folder.id, { name });
          done();
        },
      }),
    toggleFavorite: async (file: FileDto) => {
      await fileApi.update(file.id, { isFavorite: !file.isFavorite });
      done();
    },
    moveFile: async (file: FileDto, folderId: string | null) => {
      await fileApi.update(file.id, { folderId });
      done();
    },
    moveFolder: async (folder: FolderDto, parentId: string | null) => {
      await folderApi.update(folder.id, { parentId });
      done();
    },
    setTabbed: async (folder: FolderDto, isTabbed: boolean) => {
      await folderApi.update(folder.id, { isTabbed });
      done();
    },
    trashFile: async (file: FileDto) => {
      await fileApi.trash(file.id);
      done();
    },
    /** 下載成 `<標題>.tinycanvas.json`（見 docs/DECISIONS.md 2026-10-15「白板匯出與匯入」） */
    exportFile: async (file: FileDto) => {
      try {
        const blob = await fileApi.export(file.id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${file.title}.tinycanvas.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
        toast(strings.errors.exportFailed);
      }
    },
    importBoard: async (blob: Blob, folderId: string | null) => {
      try {
        const f = await fileApi.import(blob, folderId);
        done();
        toast(strings.files.imported.replace('{title}', f.title));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'invalid_board_file') toast(strings.errors.importInvalid);
        else if (e instanceof ApiError && e.status === 413) toast(strings.errors.importTooLarge);
        else toast(strings.errors.importFailed);
      }
    },
    trashFolder: async (folder: FolderDto) => {
      await folderApi.trash(folder.id);
      done();
    },
  };
}
