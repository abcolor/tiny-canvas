import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { CLOSE_FILE_TRASHED, SESSION_AUTH_TOKEN } from '@tinycanvas/shared';
import { cacheDbName, setUnsynced } from '../lib/localCache';

export type SyncStatus =
  | 'connecting' // 尚未完成第一次同步
  | 'synced' // 已連線，所有變更都已寫回
  | 'saving' // 已連線，有變更尚未確認
  | 'offline' // 連線中斷，變更暫存在本地
  | 'trashed' // 檔案已移到垃圾桶
  | 'denied'; // 沒有權限或連結失效

export type BoardAuth = { kind: 'session'; userId: string } | { kind: 'view'; token: string };

export interface BoardDoc {
  doc: Y.Doc;
  status: SyncStatus;
  /** 內容已可顯示（伺服器同步完成，或從本地暫存載入） */
  ready: boolean;
}

export function syncUrl(): string {
  return `${location.origin.replace(/^http/, 'ws')}/sync`;
}

/**
 * 開啟一張畫布：Yjs 文件 + Hocuspocus 同步 + y-indexeddb 離線暫存（見 SPEC.md 第 5.4 節）。
 * 唯讀分享頁面不使用 y-indexeddb。
 */
export function useBoardDoc(fileId: string, auth: BoardAuth): BoardDoc {
  const authKey = auth.kind === 'session' ? `s:${auth.userId}` : `v:${auth.token}`;
  const [state, setState] = useState<BoardDoc>(() => ({ doc: new Y.Doc(), status: 'connecting', ready: false }));

  useEffect(() => {
    const doc = new Y.Doc();
    let status: SyncStatus = 'connecting';
    let ready = false;
    let disposed = false;
    const unsyncedKey = `${fileId}:${Math.random()}`;
    const publish = () => {
      if (!disposed) setState({ doc, status, ready });
    };

    let idb: IndexeddbPersistence | null = null;
    if (auth.kind === 'session') {
      idb = new IndexeddbPersistence(cacheDbName(auth.userId, fileId), doc);
      idb.on('synced', () => {
        // 本地有暫存內容時先顯示，伺服器同步完成後自動合併
        if (doc.getMap('objects').size > 0 && !ready) {
          ready = true;
          publish();
        }
      });
    }

    let stopped = false;
    const markTerminal = (s: 'trashed' | 'denied') => {
      status = s;
      ready = true;
      publish();
      if (!stopped) {
        stopped = true;
        // 不再重試連線
        queueMicrotask(() => provider.destroy());
      }
    };

    const provider = new HocuspocusProvider({
      url: syncUrl(),
      name: fileId,
      document: doc,
      token: auth.kind === 'session' ? SESSION_AUTH_TOKEN : auth.token,
      onSynced: () => {
        ready = true;
        status = provider.hasUnsyncedChanges ? 'saving' : 'synced';
        publish();
      },
      onStatus: ({ status: s }) => {
        if (status === 'trashed' || status === 'denied') return;
        if (s === 'disconnected') status = 'offline';
        else if (s === 'connected') status = provider.isSynced ? (provider.hasUnsyncedChanges ? 'saving' : 'synced') : 'connecting';
        publish();
      },
      onClose: ({ event }) => {
        if (event.code === CLOSE_FILE_TRASHED.code) markTerminal('trashed');
      },
      onAuthenticationFailed: ({ reason }) => {
        markTerminal(reason === CLOSE_FILE_TRASHED.reason ? 'trashed' : 'denied');
      },
    });

    const onUnsynced = (n: number) => {
      setUnsynced(unsyncedKey, n > 0);
      if (status === 'synced' || status === 'saving') {
        status = n > 0 ? 'saving' : 'synced';
        publish();
      }
    };
    provider.on('unsyncedChanges', onUnsynced);

    // 瀏覽器回報離線時立即斷線並顯示「離線中」，不必等 WebSocket 逾時；恢復連線時立即重連
    const onOffline = () => {
      if (stopped) return;
      void provider.disconnect();
      if (status !== 'trashed' && status !== 'denied') {
        status = 'offline';
        publish();
      }
    };
    const onOnline = () => {
      if (!stopped) void provider.connect();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    if (!navigator.onLine) onOffline();
    publish();

    return () => {
      disposed = true;
      setUnsynced(unsyncedKey, false);
      provider.off('unsyncedChanges', onUnsynced);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      if (!stopped) provider.destroy();
      void idb?.destroy();
      doc.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, authKey]);

  return state;
}
