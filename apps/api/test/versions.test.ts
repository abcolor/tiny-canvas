import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { docCanonical, docFromState, extractSearchText, type VersionDto } from '@tinycanvas/shared';
import { createTestApp, del, makeDocState, post, signup, storeDocument, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const ASSET = '11111111-1111-4111-8111-111111111111';

/** supertest 以 Buffer 取回二進位回應 */
const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('版本歷史', () => {
  it('建立命名版本、列出、下載、另存複本', async () => {
    const c = await signup(t);
    const dir = (await post(c, '/api/folders', { name: 'Dir' })).body;
    const f = (await post(c, '/api/files', { title: '架構圖', folderId: dir.id })).body;

    // 尚無 documents 資料列時以空白文件建立
    const v0 = await post(c, `/api/files/${f.id}/versions`, { label: '空白' });
    expect(v0.status).toBe(201);
    const emptyHash = createHash('sha256').update(docCanonical(new Y.Doc())).digest('hex');
    expect((await t.prisma.docVersion.findUniqueOrThrow({ where: { id: v0.body.id } })).contentHash).toBe(emptyHash);

    const state = makeDocState({ texts: ['資料庫', 'API 閘道'], assetIds: [ASSET] });
    const hash = await storeDocument(t.prisma, f.id, state);
    await new Promise((r) => setTimeout(r, 5));
    const v1 = await post(c, `/api/files/${f.id}/versions`, { label: '第一版' });
    expect(v1.status).toBe(201);
    expect(v1.body).toMatchObject({ label: '第一版' });
    const row = await t.prisma.docVersion.findUniqueOrThrow({ where: { id: v1.body.id } });
    expect(row.contentHash).toBe(hash);
    expect(row.assetIds).toEqual([ASSET]);
    expect(v1.body.size).toBe(row.state.byteLength);
    await post(c, `/api/files/${f.id}/versions`, {}).expect(400);

    const list = await c.agent.get(`/api/files/${f.id}/versions`).expect(200);
    expect(list.body.versions.map((v: VersionDto) => v.id)).toEqual([v1.body.id, v0.body.id]);
    expect(list.body.nextCursor).toBeNull();

    const got = await c.agent.get(`/api/files/${f.id}/versions/${v1.body.id}`).buffer(true).parse(binary).expect(200);
    expect(got.headers['content-type']).toBe('application/octet-stream');
    expect(Buffer.compare(got.body, Buffer.from(state))).toBe(0);

    const copy = await post(c, `/api/files/${f.id}/versions/${v1.body.id}/copy`, {});
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ title: '架構圖 的副本', folderId: dir.id, type: 'board' });
    const copied = await t.prisma.file.findUniqueOrThrow({ where: { id: copy.body.id }, include: { document: true } });
    expect(copied.searchText).toBe(extractSearchText(docFromState(state)));
    expect(copied.searchText).toContain('API 閘道');
    expect(copied.assetIds).toEqual([ASSET]);
    expect(Buffer.compare(Buffer.from(copied.document!.state), Buffer.from(state))).toBe(0);
    expect(copied.document!.contentHash).toBe(hash);

    const named = await post(c, `/api/files/${f.id}/versions/${v1.body.id}/copy`, { title: '另存' });
    expect(named.body.title).toBe('另存');
  });

  it('命名版本會合併前端送來、尚未寫回資料庫的狀態', async () => {
    const c = await signup(t);
    const f = (await post(c, '/api/files', { title: '合併' })).body;
    const stored = makeDocState({ texts: ['已寫回'] });
    await storeDocument(t.prisma, f.id, stored);

    // 前端在已寫回的狀態上又加了一個物件（尚未寫回資料庫）
    const client = docFromState(stored);
    const extra = makeDocState({ texts: ['剛剛新增'], assetIds: [ASSET] });
    Y.applyUpdate(client, extra);
    const v = await post(c, `/api/files/${f.id}/versions`, {
      label: '含最新修改',
      state: Buffer.from(Y.encodeStateAsUpdate(client)).toString('base64'),
    });
    expect(v.status).toBe(201);
    const got = await c.agent.get(`/api/files/${f.id}/versions/${v.body.id}`).buffer(true).parse(binary).expect(200);
    const text = extractSearchText(docFromState(new Uint8Array(got.body)));
    expect(text).toContain('已寫回');
    expect(text).toContain('剛剛新增');
    const row = await t.prisma.docVersion.findUniqueOrThrow({ where: { id: v.body.id } });
    expect(row.assetIds).toEqual([ASSET]);
    expect(row.contentHash).toBe(createHash('sha256').update(docCanonical(client)).digest('hex'));

    await post(c, `/api/files/${f.id}/versions`, { label: 'x', state: Buffer.from('not yjs').toString('base64') }).expect(400);
  });

  it('以游標分頁，由新到舊', async () => {
    const c = await signup(t);
    const f = (await post(c, '/api/files', { title: 'x' })).body;
    const gz = gzipSync(Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())));
    const base = Date.now() - 100_000;
    await t.prisma.docVersion.createMany({
      data: Array.from({ length: 65 }, (_, i) => ({
        fileId: f.id,
        state: new Uint8Array(gz),
        contentHash: `h${i}`,
        createdAt: new Date(base + Math.floor(i / 2) * 1000), // 兩兩同一時間，確認同時間排序穩定
      })),
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: any = await c.agent
        .get(`/api/files/${f.id}/versions`)
        .query(cursor ? { cursor } : {})
        .expect(200);
      pages++;
      for (const v of res.body.versions as VersionDto[]) seen.push(v.createdAt + v.id);
      expect(res.body.versions.length).toBeLessThanOrEqual(30);
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(65);
    expect(new Set(seen).size).toBe(65);
    expect([...seen].sort().reverse()).toEqual(seen);
    await c.agent.get(`/api/files/${f.id}/versions?cursor=garbage`).expect(400);
  });

  it('別人的檔案與不存在的版本回傳 404', async () => {
    const a = await signup(t);
    const b = await signup(t);
    const f = (await post(a, '/api/files', { title: 'x' })).body;
    const v = (await post(a, `/api/files/${f.id}/versions`, { label: 'v' })).body;
    await b.agent.get(`/api/files/${f.id}/versions`).expect(404);
    await b.agent.get(`/api/files/${f.id}/versions/${v.id}`).expect(404);
    await post(b, `/api/files/${f.id}/versions`, { label: 'x' }).expect(404);
    await post(b, `/api/files/${f.id}/versions/${v.id}/copy`, {}).expect(404);
    await a.agent.get(`/api/files/${f.id}/versions/00000000-0000-4000-8000-000000000000`).expect(404);
    await del(a, `/api/files/${f.id}`).expect(204);
    await a.agent.get(`/api/files/${f.id}/versions`).expect(404);
  });
});
