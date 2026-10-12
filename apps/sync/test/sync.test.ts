import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_VERSION_INTERVAL_MS,
  CLOSE_FILE_TRASHED,
  createObjectMap,
  docCanonical,
  getObjects,
  newId,
} from '@tinycanvas/shared';
import type { SyncServer } from '../src/server';
import { contentHash } from '../src/persistence';
import {
  connect,
  createClock,
  prisma,
  resetDb,
  seedFile,
  seedLink,
  seedUser,
  sleep,
  startServer,
  viewToken,
  waitFor,
  type TestClient,
} from './helpers';

let server: SyncServer;
let url: string;
let clock: ReturnType<typeof createClock>;
let clients: TestClient[] = [];

function track(c: TestClient) {
  clients.push(c);
  return c;
}

function addImage(doc: Y.Doc, assetId: string) {
  const id = newId();
  const m = createObjectMap({ type: 'image', id, x: 0, y: 0, w: 10, h: 10, assetId, naturalWidth: 10, naturalHeight: 10 });
  doc.transact(() => getObjects(doc).set(id, m));
  return id;
}

function addShape(doc: Y.Doc, text: string, extra: Record<string, unknown> = {}) {
  const id = newId();
  const m = createObjectMap({ type: 'shape', id, x: 0, y: 0, w: 100, h: 50, text, ...extra });
  doc.transact(() => getObjects(doc).set(id, m));
  return id;
}

const storedDoc = (fileId: string) => prisma.document.findUnique({ where: { fileId } });

beforeEach(async () => {
  await resetDb();
  clock = createClock();
  ({ server, url } = await startServer(clock.now));
});

afterEach(async () => {
  for (const c of clients) c.destroy();
  clients = [];
  await server.destroy();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('healthz', () => {
  it('answers GET /healthz with 200 {status:"ok"}', async () => {
    const port = new URL(url).port;
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/healthz`, (r) => {
          let body = '';
          r.on('data', (d) => (body += d));
          r.on('end', () => resolve({ status: r.statusCode ?? 0, body }));
        })
        .on('error', reject);
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });
});

describe('session auth', () => {
  it('owner can read/write and changes are persisted within ~1.5s', async () => {
    const { user, cookie } = await seedUser();
    const file = await seedFile(user.id);
    const a = track(connect(url, file.id, { cookie }));
    await a.ready;
    const started = Date.now();
    addShape(a.doc, 'hello');
    const row = await waitFor(async () => {
      const d = await storedDoc(file.id);
      return d && d.contentHash === contentHash(a.doc) ? d : null;
    }, 1500);
    expect(Date.now() - started).toBeLessThan(1500);
    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, new Uint8Array(row.state));
    expect(docCanonical(loaded)).toBe(docCanonical(a.doc));

    // 重新連線（伺服器卸載文件後從資料庫載入）拿到相同內容
    a.destroy();
    await waitFor(() => server.hocuspocus.getDocumentsCount() === 0);
    const b = track(connect(url, file.id, { cookie }));
    await b.ready;
    expect(docCanonical(b.doc)).toBe(docCanonical(loaded));
  });

  it('rejects a wrong Origin', async () => {
    const { user, cookie } = await seedUser();
    const file = await seedFile(user.id);
    const c = track(connect(url, file.id, { cookie, origin: 'http://evil.example' }));
    await expect(c.ready).rejects.toThrow(/auth failed/);
    const noOrigin = track(connect(url, file.id, { cookie, origin: null }));
    await expect(noOrigin.ready).rejects.toThrow(/auth failed/);
  });

  it('rejects missing/invalid/expired session cookies', async () => {
    const { user, cookie } = await seedUser();
    const file = await seedFile(user.id);
    await expect(track(connect(url, file.id, {})).ready).rejects.toThrow();
    await expect(track(connect(url, file.id, { cookie: 'tc_session=nope' })).ready).rejects.toThrow();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(track(connect(url, file.id, { cookie })).ready).rejects.toThrow();
  });

  it("rejects another user's file and unknown files", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const file = await seedFile(owner.user.id);
    await expect(track(connect(url, file.id, { cookie: other.cookie })).ready).rejects.toThrow();
    await expect(track(connect(url, randomUUID(), { cookie: owner.cookie })).ready).rejects.toThrow();
    await expect(track(connect(url, 'not-a-uuid', { cookie: owner.cookie })).ready).rejects.toThrow();
  });

  it('rejects a trashed file on connect with reason file-trashed', async () => {
    const { user, cookie } = await seedUser();
    const file = await seedFile(user.id, { deletedAt: new Date() });
    const c = track(connect(url, file.id, { cookie }));
    await expect(c.ready).rejects.toThrow(/file-trashed/);
    expect(await storedDoc(file.id)).toBeNull();
  });

  it('two clients editing converge', async () => {
    const { user, cookie } = await seedUser();
    const file = await seedFile(user.id);
    const a = track(connect(url, file.id, { cookie }));
    const b = track(connect(url, file.id, { cookie }));
    await Promise.all([a.ready, b.ready]);
    addShape(a.doc, 'from a');
    addShape(b.doc, 'from b');
    await waitFor(() => getObjects(a.doc).size === 2 && getObjects(b.doc).size === 2);
    expect(docCanonical(a.doc)).toBe(docCanonical(b.doc));
    await waitFor(async () => (await storedDoc(file.id))?.contentHash === contentHash(a.doc));
  });
});

describe('view token (share link)', () => {
  it('can read but writes are neither persisted nor propagated', async () => {
    const { user, cookie } = await seedUser();
    const file = await seedFile(user.id);
    const link = await seedLink(file.id);
    const owner = track(connect(url, file.id, { cookie }));
    await owner.ready;
    addShape(owner.doc, 'owner content');
    await waitFor(async () => (await storedDoc(file.id))?.contentHash === contentHash(owner.doc));

    const viewer = track(connect(url, file.id, { token: await viewToken(file.id, link.id) }));
    await viewer.ready;
    await waitFor(() => docCanonical(viewer.doc) === docCanonical(owner.doc));
    const before = await storedDoc(file.id);

    addShape(viewer.doc, 'viewer attempt');
    await sleep(1500);
    expect(getObjects(owner.doc).size).toBe(1);
    const after = await storedDoc(file.id);
    expect(after?.contentHash).toBe(before?.contentHash);
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());

    // 新的連線也看不到訪客的修改
    const fresh = track(connect(url, file.id, { cookie }));
    await fresh.ready;
    expect(getObjects(fresh.doc).size).toBe(1);
  });

  it('rejects revoked, expired, mismatched or forged tokens', async () => {
    const { user } = await seedUser();
    const file = await seedFile(user.id);
    const other = await seedFile(user.id);
    const revoked = await seedLink(file.id, { revokedAt: new Date() });
    const expired = await seedLink(file.id, { expiresAt: new Date(Date.now() - 1000) });
    const ok = await seedLink(file.id);
    const cases = [
      await viewToken(file.id, revoked.id),
      await viewToken(file.id, expired.id),
      await viewToken(file.id, ok.id, { exp: Math.floor(Date.now() / 1000) - 10 }),
      await viewToken(file.id, ok.id, { secret: 'wrong-secret-wrong-secret-wrong-secret' }),
      await viewToken(other.id, ok.id),
      'garbage',
    ];
    for (const token of cases) {
      await expect(track(connect(url, file.id, { token })).ready).rejects.toThrow();
    }
    // 檔案 id 與 token 內不同
    await expect(track(connect(url, other.id, { token: await viewToken(file.id, ok.id) })).ready).rejects.toThrow();
    // 檔案在垃圾桶內
    await prisma.file.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
    await expect(track(connect(url, file.id, { token: await viewToken(file.id, ok.id) })).ready).rejects.toThrow();
  });
});

describe('derived fields', () => {
  it('updates files.search_text, asset_ids and updated_at when content changes', async () => {
    const { user, cookie } = await seedUser();
    const file = await seedFile(user.id);
    const assetId = randomUUID();
    const a = track(connect(url, file.id, { cookie }));
    await a.ready;
    addShape(a.doc, 'Hello 世界');
    const imgId = addImage(a.doc, assetId);
    const row = await waitFor(async () => {
      const f = await prisma.file.findUnique({ where: { id: file.id } });
      return f && f.searchText.includes('Hello 世界') && f.assetIds.length === 1 ? f : null;
    });
    expect(row.assetIds).toEqual([assetId]);
    expect(row.updatedAt.getTime()).toBe(clock.now().getTime());

    a.doc.transact(() => getObjects(a.doc).delete(imgId));
    await waitFor(async () => (await prisma.file.findUnique({ where: { id: file.id } }))?.assetIds.length === 0);
  });
});

describe('auto versions', () => {
  const versions = (fileId: string) => prisma.docVersion.findMany({ where: { fileId }, orderBy: { createdAt: 'asc' } });
  const waitStored = (fileId: string, doc: Y.Doc) =>
    waitFor(async () => {
      const d = await storedDoc(fileId);
      return d && d.contentHash === contentHash(doc) && d.updatedAt.getTime() === clock.now().getTime() ? d : null;
    });

  it('follows the 10-minute / content-hash rules', async () => {
    const { user, cookie } = await seedUser();
    const file = await seedFile(user.id);
    const a = track(connect(url, file.id, { cookie }));
    await a.ready;

    // 空白畫布（objects 為空）不建立版本
    a.doc.getMap('meta').set('touched', true);
    await waitStored(file.id, a.doc);
    expect(await versions(file.id)).toHaveLength(0);

    // 第一次非空的寫入建立版本
    const id = addShape(a.doc, 'v1');
    await waitStored(file.id, a.doc);
    let vs = await versions(file.id);
    expect(vs).toHaveLength(1);
    expect(vs[0].label).toBeNull();
    expect(vs[0].contentHash).toBe(contentHash(a.doc));
    const restored = new Y.Doc();
    Y.applyUpdate(restored, new Uint8Array(gunzipSync(vs[0].state)));
    expect(docCanonical(restored)).toBe(docCanonical(a.doc));

    // 10 分鐘內的變更不建立版本
    clock.advance(5 * 60 * 1000);
    addShape(a.doc, 'v1b');
    await waitStored(file.id, a.doc);
    expect(await versions(file.id)).toHaveLength(1);

    // 超過 10 分鐘且內容不同 → 新版本（含 asset_ids）
    clock.advance(AUTO_VERSION_INTERVAL_MS + 1000);
    const assetId = randomUUID();
    addImage(a.doc, assetId);
    await waitStored(file.id, a.doc);
    vs = await versions(file.id);
    expect(vs).toHaveLength(2);
    expect(vs[1].assetIds).toEqual([assetId]);
    expect(vs[1].contentHash).toBe(contentHash(a.doc));

    // 超過 10 分鐘但內容與上一個版本相同 → 不建立
    clock.advance(AUTO_VERSION_INTERVAL_MS + 1000);
    const obj = getObjects(a.doc).get(id)!;
    // 兩次修改在同一次寫回內，最終內容與上一個版本相同
    obj.set('x', 42);
    obj.set('x', 0);
    await waitStored(file.id, a.doc);
    expect(contentHash(a.doc)).toBe(vs[1].contentHash);
    expect(await versions(file.id)).toHaveLength(2);
  });

  it('counts a named version as the last version', async () => {
    const { user, cookie } = await seedUser();
    const file = await seedFile(user.id);
    const a = track(connect(url, file.id, { cookie }));
    await a.ready;
    addShape(a.doc, 'x');
    await waitStored(file.id, a.doc);
    await prisma.docVersion.create({
      data: { fileId: file.id, state: Buffer.from([]), contentHash: 'named', label: 'Named', createdAt: clock.now() },
    });
    clock.advance(60 * 1000);
    addShape(a.doc, 'y');
    await waitStored(file.id, a.doc);
    expect(await versions(file.id)).toHaveLength(2);
  });
});

describe('shutdown', () => {
  it('flushes pending stores on destroy', async () => {
    const { user, cookie } = await seedUser();
    const file = await seedFile(user.id);
    const a = track(connect(url, file.id, { cookie }));
    await a.ready;
    addShape(a.doc, 'pending');
    // 讓更新送達伺服器，但還在 debounce 期間
    await waitFor(() => server.hocuspocus.debouncer.isDebounced(`onStoreDocument-${file.id}`), 1000, 5);
    expect(await storedDoc(file.id)).toBeNull();
    await server.destroy();
    expect((await storedDoc(file.id))?.contentHash).toBe(contentHash(a.doc));
  });
});

describe('file trashed while open', () => {
  it('drops the write and closes connections with 4404', async () => {
    const { user, cookie } = await seedUser();
    const file = await seedFile(user.id);
    const a = track(connect(url, file.id, { cookie }));
    await a.ready;
    addShape(a.doc, 'saved');
    const saved = await waitFor(async () => {
      const d = await storedDoc(file.id);
      return d?.contentHash === contentHash(a.doc) ? d : null;
    });

    await prisma.file.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
    addShape(a.doc, 'lost');
    await waitFor(() => a.closes.some((c) => c.code === CLOSE_FILE_TRASHED.code));
    expect(a.closes.find((c) => c.code === CLOSE_FILE_TRASHED.code)?.reason).toBe(CLOSE_FILE_TRASHED.reason);
    const after = await storedDoc(file.id);
    expect(after?.contentHash).toBe(saved.contentHash);
    expect(after?.updatedAt.getTime()).toBe(saved.updatedAt.getTime());
    // provider 自動重連時，驗證以 file-trashed 失敗
    await waitFor(() => a.authFailures.includes(CLOSE_FILE_TRASHED.reason));
  });

  it('never recreates the documents row for a deleted file', async () => {
    const { user, cookie } = await seedUser();
    const file = await seedFile(user.id);
    const a = track(connect(url, file.id, { cookie }));
    await a.ready;
    await prisma.file.delete({ where: { id: file.id } });
    addShape(a.doc, 'lost');
    await waitFor(() => a.closes.some((c) => c.code === CLOSE_FILE_TRASHED.code));
    expect(await storedDoc(file.id)).toBeNull();
    expect(await prisma.docVersion.count()).toBe(0);
  });
});
