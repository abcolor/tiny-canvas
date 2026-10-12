import { Hocuspocus } from '@hocuspocus/server';
import type { Document } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { pino, type Logger } from 'pino';
import type { PrismaClient } from '@tinycanvas/db';
import { CLOSE_FILE_TRASHED } from '@tinycanvas/shared';
import { authenticate, SyncDenied, UUID_RE, type SyncContext } from './auth';
import { fetchDocument, storeDocument } from './persistence';

export interface SyncServerOptions {
  prisma: PrismaClient;
  /** 用來驗證檢視 token（HS256） */
  sessionSecret: string;
  /** 只接受 Origin 等於此 URL 的 origin 的 WebSocket 連線 */
  publicUrl: string;
  /** 0 代表隨機埠（測試用）；預設 4000 */
  port?: number;
  address?: string;
  logger?: Logger;
  /** 時鐘，測試可注入假時間 */
  now?: () => Date;
  /** onStoreDocument 的 debounce，預設 500 / 1000 ms（SPEC.md 第 9 節：1 秒內寫回） */
  debounce?: number;
  maxDebounce?: number;
}

export interface SyncServer {
  hocuspocus: Hocuspocus;
  /** 開始監聽，回傳實際的埠號 */
  listen(): Promise<number>;
  /** 關閉所有連線並寫回尚未儲存的變更 */
  destroy(): Promise<void>;
}

export function createSyncServer(options: SyncServerOptions): SyncServer {
  const { prisma } = options;
  const logger = options.logger ?? pino({ name: 'sync' });
  const now = options.now ?? (() => new Date());
  const expectedOrigin = new URL(options.publicUrl).origin;
  const secret = new TextEncoder().encode(options.sessionSecret);
  const persistence = { prisma, logger, now };

  // 同一份文件的寫入依序執行，避免兩次 store 交錯
  const storeChains = new Map<string, Promise<void>>();

  const closeAllConnections = (document: Document) => {
    for (const connection of document.getConnections()) {
      connection.close({ code: CLOSE_FILE_TRASHED.code, reason: CLOSE_FILE_TRASHED.reason });
    }
  };

  const runStore = async (documentName: string, document: Document, state: Uint8Array) => {
    if (!UUID_RE.test(documentName)) return;
    try {
      const result = await storeDocument(persistence, documentName, state);
      if (result === 'file-gone') {
        logger.info({ fileId: documentName }, 'file trashed or deleted; dropping changes and closing connections');
        closeAllConnections(document);
      }
    } catch (err) {
      logger.error({ err, fileId: documentName }, 'store failed');
    }
  };

  const database = new Database({
    fetch: async ({ documentName }) => {
      try {
        return await fetchDocument(persistence, documentName);
      } catch (err) {
        if ((err as { reason?: string }).reason === 'file-unavailable') {
          logger.warn({ fileId: documentName }, 'load denied: file missing or trashed');
        } else {
          logger.error({ err, fileId: documentName }, 'load failed');
        }
        throw err;
      }
    },
    store: async ({ documentName, document, state }) => {
      const prev = storeChains.get(documentName) ?? Promise.resolve();
      const next = prev.then(() => runStore(documentName, document, state));
      storeChains.set(documentName, next);
      await next;
      if (storeChains.get(documentName) === next) storeChains.delete(documentName);
    },
  });

  const hocuspocus = new Hocuspocus({
    name: 'tinycanvas-sync',
    port: options.port ?? 4000,
    address: options.address ?? '0.0.0.0',
    quiet: true,
    // 由 main.ts 自行處理訊號，確保先寫回再結束
    stopOnSignals: false,
    debounce: options.debounce ?? 500,
    maxDebounce: options.maxDebounce ?? 1000,
    extensions: [database],

    async onAuthenticate(data): Promise<SyncContext> {
      try {
        const ctx = await authenticate(
          { prisma, expectedOrigin, secret, now },
          { documentName: data.documentName, token: data.token, requestHeaders: data.requestHeaders },
        );
        // v2：唯讀連線的所有寫入都會被伺服器拒絕
        data.connection.readOnly = ctx.readOnly;
        logger.info({ fileId: data.documentName, readOnly: ctx.readOnly, userId: ctx.userId }, 'connection authenticated');
        return ctx;
      } catch (err) {
        if (err instanceof SyncDenied) {
          logger.warn(
            { fileId: data.documentName, reason: err.detail, origin: data.requestHeaders.origin ?? null },
            'connection rejected',
          );
          throw err;
        }
        logger.error({ err, fileId: data.documentName }, 'authentication error');
        throw new SyncDenied('permission-denied', 'internal-error');
      }
    },

    async onRequest({ request, response }) {
      const path = (request.url ?? '/').split('?')[0];
      if (request.method === 'GET' && path === '/healthz') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok' }));
      } else {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('Not Found');
      }
      // v2：以空值 reject 代表已自行回應，阻止預設的 "OK" 回應
      throw null;
    },
  });

  let destroying: Promise<void> | null = null;
  return {
    hocuspocus,
    async listen() {
      await hocuspocus.listen(options.port ?? 4000);
      return hocuspocus.address.port;
    },
    destroy() {
      destroying ??= (async () => {
        await hocuspocus.destroy();
        await Promise.allSettled(Array.from(storeChains.values()));
      })();
      return destroying;
    },
  };
}
