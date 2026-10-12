import { gzipSync } from 'node:zlib';
import * as Y from 'yjs';
import type { Logger } from 'pino';
import type { PrismaClient } from '@tinycanvas/db';
import {
  AUTO_VERSION_INTERVAL_MS,
  docCanonical,
  extractAssetIds,
  extractSearchText,
  getObjects,
} from '@tinycanvas/shared';
import { sha256Hex } from './auth';

export interface PersistenceDeps {
  prisma: PrismaClient;
  logger: Logger;
  now: () => Date;
}

/** 內容雜湊：以正規化 JSON 計算，與 CRDT 歷史無關 */
export function contentHash(doc: Y.Doc): string {
  return sha256Hex(docCanonical(doc));
}

/**
 * 載入文件。檔案不存在或在垃圾桶內時丟出錯誤（拒絕載入）；
 * 尚未有 documents 資料列時回傳 null（空白畫布）。
 */
export async function fetchDocument(deps: PersistenceDeps, fileId: string): Promise<Uint8Array | null> {
  const file = await deps.prisma.file.findUnique({
    where: { id: fileId },
    select: { deletedAt: true, document: { select: { state: true } } },
  });
  if (!file || file.deletedAt) {
    // message 留空，避免 Hocuspocus 另外 console.error；由呼叫端以 pino 記錄
    throw Object.assign(new Error(''), { reason: 'file-unavailable' });
  }
  return file.document ? new Uint8Array(file.document.state) : null;
}

export type StoreResult = 'stored' | 'file-gone';

/**
 * 寫回文件（SPEC.md 第 5.5、7、8.1 節）：
 * - 檔案不存在或在垃圾桶內：什麼都不寫，回傳 'file-gone'（呼叫端負責關閉連線）
 * - 否則更新 documents；內容雜湊改變時同步更新 files.search_text / asset_ids / updated_at
 * - 自動快照：沒有任何版本且畫布非空，或距上一個版本超過 10 分鐘且雜湊不同時，建立新版本
 */
export async function storeDocument(deps: PersistenceDeps, fileId: string, state: Uint8Array): Promise<StoreResult> {
  const { prisma, now } = deps;

  // 用自己的 Y.Doc 解碼，確保與 @tinycanvas/shared 使用同一份 yjs
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const hash = contentHash(doc);
  const objectCount = getObjects(doc).size;
  let derived: { searchText: string; assetIds: string[] } | null = null;
  const getDerived = () => (derived ??= { searchText: extractSearchText(doc), assetIds: extractAssetIds(doc) });

  return prisma.$transaction(async (tx) => {
    // FOR SHARE：在寫入完成前，api 無法同時把檔案移進垃圾桶或永久刪除
    const rows = await tx.$queryRaw<{ deleted_at: Date | null }[]>`
      SELECT deleted_at FROM files WHERE id = ${fileId}::uuid FOR SHARE`;
    const file = rows[0];
    if (!file || file.deleted_at) return 'file-gone' as const;

    const t = now();
    const prev = await tx.document.findUnique({ where: { fileId }, select: { contentHash: true } });
    const buf = Buffer.from(state);
    await tx.document.upsert({
      where: { fileId },
      create: { fileId, state: buf, contentHash: hash, updatedAt: t },
      update: { state: buf, contentHash: hash, updatedAt: t },
    });

    if (!prev || prev.contentHash !== hash) {
      const { searchText, assetIds } = getDerived();
      await tx.file.update({ where: { id: fileId }, data: { searchText, assetIds, updatedAt: t } });
    }

    const last = await tx.docVersion.findFirst({
      where: { fileId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, contentHash: true },
    });
    const shouldSnapshot = last
      ? t.getTime() - last.createdAt.getTime() > AUTO_VERSION_INTERVAL_MS && last.contentHash !== hash
      : objectCount > 0;
    if (shouldSnapshot) {
      await tx.docVersion.create({
        data: {
          fileId,
          state: gzipSync(buf),
          contentHash: hash,
          assetIds: getDerived().assetIds,
          label: null,
          createdAt: t,
        },
      });
      deps.logger.info({ fileId }, 'auto version created');
    }
    return 'stored' as const;
  });
}
