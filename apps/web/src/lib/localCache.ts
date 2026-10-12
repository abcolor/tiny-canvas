// 離線暫存（y-indexeddb）的資料庫命名與清除，見 SPEC.md 第 5.4 節

export function cacheDbName(userId: string, fileId: string): string {
  return `tc:${userId}:${fileId}`;
}

/** 目前開啟中、尚有未同步變更的文件數；登出前用來警告 */
const unsynced = new Map<string, boolean>();
export function setUnsynced(key: string, value: boolean) {
  if (value) unsynced.set(key, true);
  else unsynced.delete(key);
}
export function hasUnsyncedChanges(): boolean {
  return unsynced.size > 0;
}

/** 登出時清除該使用者的所有本地暫存 */
export async function clearUserCaches(userId: string): Promise<void> {
  const prefix = `tc:${userId}:`;
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      dbs
        .map((d) => d.name)
        .filter((n): n is string => Boolean(n && n.startsWith(prefix)))
        .map(
          (name) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            }),
        ),
    );
  } catch {
    /* 瀏覽器不支援 databases() 時略過 */
  }
}
