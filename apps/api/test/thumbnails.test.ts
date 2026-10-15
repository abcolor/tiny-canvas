import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_THUMBNAIL_BYTES, type FileDto } from '@tinycanvas/shared';
import { createTestApp, del, post, signup, type Client, type TestApp } from './helpers';

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

// 2x3 的 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR42mP8z8DwnwEJMCJzAEUTBAG3pLcpAAAAAElFTkSuQmCC',
  'base64',
);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>');

const put = (c: Client, fileId: string, buf: Buffer, contentType = 'image/png') =>
  c.agent
    .put(`/api/files/${fileId}/thumbnail`)
    .set('X-CSRF-Token', c.csrf)
    .attach('file', buf, { filename: 'thumb', contentType });

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (ch: Buffer) => chunks.push(ch));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function newBoard(c: Client): Promise<FileDto> {
  return (await post(c, '/api/files', { title: 'Board' }).expect(201)).body as FileDto;
}

describe('首頁卡片縮圖', () => {
  it('上傳後列表帶出 thumbnailAt，可讀回同一張圖並長期快取', async () => {
    const c = await signup(t);
    const f = await newBoard(c);
    expect(f.thumbnailAt).toBeNull();

    const r = await put(c, f.id, PNG);
    expect(r.status).toBe(200);
    const after = r.body as FileDto;
    expect(after.thumbnailAt).not.toBeNull();
    // 縮圖不算內容變更，不影響排序用的 updatedAt
    expect(after.updatedAt).toBe(f.updatedAt);

    const list = (await c.agent.get('/api/files').query({ recent: true }).expect(200)).body as FileDto[];
    expect(list[0]!.thumbnailAt).toBe(after.thumbnailAt);

    const img = await c.agent.get(`/api/files/${f.id}/thumbnail`).buffer(true).parse(binary).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);
  });

  it('刪除後 thumbnailAt 回到 null，讀取回傳 404', async () => {
    const c = await signup(t);
    const f = await newBoard(c);
    await put(c, f.id, PNG).expect(200);
    const r = await del(c, `/api/files/${f.id}/thumbnail`).expect(200);
    expect((r.body as FileDto).thumbnailAt).toBeNull();
    await c.agent.get(`/api/files/${f.id}/thumbnail`).expect(404);
  });

  it('只接受 PNG 與 WebP，且不超過 512 KB', async () => {
    const c = await signup(t);
    const f = await newBoard(c);
    expect((await put(c, f.id, SVG, 'image/svg+xml')).status).toBe(415);
    expect((await put(c, f.id, Buffer.from('not an image'))).status).toBe(415);
    const big = Buffer.alloc(MAX_THUMBNAIL_BYTES + 1, 0);
    PNG.copy(big);
    expect((await put(c, f.id, big)).status).toBe(413);
    expect((await c.agent.get(`/api/files/${f.id}`).expect(200)).body.thumbnailAt).toBeNull();
  });

  it('別人的檔案一律 404；缺 CSRF 被拒', async () => {
    const a = await signup(t);
    const b = await signup(t);
    const f = await newBoard(a);
    await put(a, f.id, PNG).expect(200);
    expect((await put(b, f.id, PNG)).status).toBe(404);
    await b.agent.get(`/api/files/${f.id}/thumbnail`).expect(404);
    expect((await del(b, `/api/files/${f.id}/thumbnail`)).status).toBe(404);
    const noCsrf = await a.agent.put(`/api/files/${f.id}/thumbnail`).attach('file', PNG, { filename: 'thumb', contentType: 'image/png' });
    expect(noCsrf.status).toBe(403);
  });

  it('永久刪除檔案時一併刪除縮圖', async () => {
    const c = await signup(t);
    const f = await newBoard(c);
    await put(c, f.id, PNG).expect(200);
    await del(c, `/api/files/${f.id}`).expect(204);
    await del(c, `/api/files/${f.id}?permanent=true`).expect(204);
    expect(await t.prisma.fileThumbnail.count()).toBe(0);
  });
});
