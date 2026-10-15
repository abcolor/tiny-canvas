import type * as Y from 'yjs';
import { systemOrigin, type FileDto } from '@tinycanvas/shared';
import { api } from '../api/client';

/** 縮圖最大尺寸（裝置像素）：首頁卡片預覽區高 112 px，以 2 倍密度繪製 */
export const THUMBNAIL_MAX_WIDTH = 800;
export const THUMBNAIL_MAX_HEIGHT = 224;
/** 最後一次本地編輯後多久更新縮圖 */
export const THUMBNAIL_DELAY_MS = 2000;

export const thumbnailUrl = (f: Pick<FileDto, 'id' | 'thumbnailAt'>) =>
  `/api/files/${f.id}/thumbnail?v=${encodeURIComponent(f.thumbnailAt ?? '')}`;

/**
 * 開啟畫布時判斷縮圖是否過時：內容在縮圖之後改過（例如在別處還原版本），
 * 或畫布已清空但還留著縮圖
 */
export function thumbnailStale(file: Pick<FileDto, 'updatedAt' | 'thumbnailAt'>, hasObjects: boolean): boolean {
  if (!hasObjects) return file.thumbnailAt !== null;
  return file.thumbnailAt === null || Date.parse(file.updatedAt) > Date.parse(file.thumbnailAt);
}

export interface ThumbnailDeps {
  /** 同步繪製目前內容並開始編碼；畫布沒有物件時回傳 null */
  capture: () => Promise<Blob> | null;
  upload: (blob: Blob) => Promise<unknown>;
  remove: () => Promise<unknown>;
  /** 伺服器上的縮圖已更新 */
  onSaved: () => void;
}

/**
 * 首頁卡片縮圖的更新時機（見 docs/DECISIONS.md 2026-10-15）：
 * - 本地編輯（含復原、還原版本）停止 2 秒後重畫並上傳；遠端變更與 systemOrigin 的自動寫入由做出變更的分頁負責
 * - 開啟時若縮圖過時，也排一次
 * - 離開畫布或切換到背景時，有未上傳的變更就立即處理
 * 上傳依序進行，失敗時忽略（下次開啟時會因為過時而重畫）
 */
export class ThumbnailSync {
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly delay: number;

  constructor(
    private readonly doc: Y.Doc,
    private readonly deps: ThumbnailDeps,
    opts: { stale: boolean; delay?: number },
  ) {
    this.delay = opts.delay ?? THUMBNAIL_DELAY_MS;
    doc.on('update', this.onUpdate);
    if (opts.stale) this.markDirty();
  }

  private onUpdate = (_u: Uint8Array, origin: unknown, _d: Y.Doc, tr: Y.Transaction) => {
    if (tr.local && origin !== systemOrigin) this.markDirty();
  };

  private markDirty() {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  /** 有未上傳的變更時立即繪製（同步）並排入上傳 */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    let blob: Promise<Blob> | null;
    try {
      blob = this.deps.capture();
    } catch {
      return;
    }
    const { upload, remove, onSaved } = this.deps;
    this.queue = this.queue
      .then(() => (blob ? blob.then(upload) : remove()))
      .then(onSaved, () => {});
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.flush();
    this.doc.off('update', this.onUpdate);
  }
}

export const thumbnailApi = {
  upload: (fileId: string, blob: Blob) => {
    const form = new FormData();
    form.append('file', blob, 'thumbnail');
    return api<FileDto>(`/api/files/${fileId}/thumbnail`, { method: 'PUT', body: form });
  },
  remove: (fileId: string) => api<FileDto>(`/api/files/${fileId}/thumbnail`, { method: 'DELETE' }),
};

/** 以 WebP 編碼；瀏覽器不支援 WebP 編碼時（例如部分 Safari）會自動改成 PNG */
export function encodeThumbnail(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/webp', 0.85),
  );
}
