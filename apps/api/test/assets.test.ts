import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_UPLOAD_BYTES, type AssetDto } from '@tinycanvas/shared';
import { createTestApp, del, makeDocState, post, signup, storeDocument, type Client, type TestApp } from './helpers';

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
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>');

const upload = (c: Client, buf: Buffer, filename: string, contentType: string) =>
  c.agent.post('/api/assets').set('X-CSRF-Token', c.csrf).attach('file', buf, { filename, contentType });

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (ch: Buffer) => chunks.push(ch));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('上傳圖片', () => {
  it('合法的 PNG 與 SVG', async () => {
    const c = await signup(t);
    const r = await upload(c, PNG, 'a.png', 'image/png');
    expect(r.status).toBe(201);
    const asset = r.body as AssetDto;
    expect(asset).toMatchObject({ mime: 'image/png', size: PNG.byteLength, width: 2, height: 3 });
    const row = await t.prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.storageKey).toBe(`${c.userId}/${asset.id}`);
    const onDisk = fs.readFileSync(path.join(t.config.storageDir, row.storageKey));
    expect(Buffer.compare(onDisk, PNG)).toBe(0);

    const svg = await upload(c, SVG, 'a.svg', 'image/svg+xml');
    expect(svg.status).toBe(201);
    expect(svg.body).toMatchObject({ mime: 'image/svg+xml', width: 40, height: 20 });
  });

  it('超過 10 MB 回傳 413；內容不符回傳 415；未登入或缺 CSRF 被拒', async () => {
    const c = await signup(t);
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0);
    PNG.copy(big);
    const tooBig = await upload(c, big, 'big.png', 'image/png');
    expect(tooBig.status).toBe(413);
    expect(tooBig.body).toEqual({ error: 'too_large' });

    const fake = await upload(c, Buffer.from('<html><script>alert(1)</script></html>'), 'x.png', 'image/png');
    expect(fake.status).toBe(415);
    expect(fake.body).toEqual({ error: 'unsupported_type' });
    const fakeSvg = await upload(c, Buffer.from('<html><svg></svg></html>'), 'x.svg', 'image/svg+xml');
    expect(fakeSvg.status).toBe(415);
    const pdf = await upload(c, PNG, 'x.pdf', 'application/pdf');
    expect(pdf.status).toBe(415);
    expect(await t.prisma.asset.count()).toBe(0);

    await c.agent.post('/api/assets').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(403);
    await t.http().post('/api/assets').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(401);
  });
});

describe('讀取圖片', () => {
  it('擁有者可讀，回應帶安全標頭', async () => {
    const c = await signup(t);
    const asset = (await upload(c, PNG, 'a.png', 'image/png')).body as AssetDto;
    const r = await c.agent.get(`/api/assets/${asset.id}`).buffer(true).parse(binary).expect(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(Buffer.compare(r.body, PNG)).toBe(0);

    const svgAsset = (await upload(c, SVG, 'a.svg', 'image/svg+xml')).body as AssetDto;
    const s = await c.agent.get(`/api/assets/${svgAsset.id}`).buffer(true).parse(binary).expect(200);
    expect(s.headers['content-type']).toBe('image/svg+xml');
  });

  it('其他使用者、未登入、未知 id 一律 404', async () => {
    const c = await signup(t);
    const other = await signup(t);
    const asset = (await upload(c, PNG, 'a.png', 'image/png')).body as AssetDto;
    await other.agent.get(`/api/assets/${asset.id}`).expect(404);
    await t.http().get(`/api/assets/${asset.id}`).expect(404);
    await c.agent.get('/api/assets/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('檢視 token：只有被分享檔案引用的圖片可讀，連結失效後拒絕', async () => {
    const c = await signup(t);
    const used = (await upload(c, PNG, 'a.png', 'image/png')).body as AssetDto;
    const unused = (await upload(c, PNG, 'b.png', 'image/png')).body as AssetDto;
    const f = (await post(c, '/api/files', { title: 'x' })).body;
    await storeDocument(t.prisma, f.id, makeDocState({ assetIds: [used.id] }));
    const link = (await post(c, `/api/files/${f.id}/share-links`, {})).body;
    const { viewToken } = (await t.http().get(`/api/shared/${link.token}`).expect(200)).body;

    const guest = t.http();
    const ok = await guest.get(`/api/assets/${used.id}`).set('Authorization', `Bearer ${viewToken}`).expect(200);
    expect(ok.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    await guest.get(`/api/assets/${unused.id}`).set('Authorization', `Bearer ${viewToken}`).expect(404);
    await guest.get(`/api/assets/${used.id}`).set('Authorization', 'Bearer not-a-jwt').expect(404);

    // 撤銷後同一個檢視 token 不能再讀
    await del(c, `/api/files/${f.id}/share-links/${link.id}`).expect(204);
    await guest.get(`/api/assets/${used.id}`).set('Authorization', `Bearer ${viewToken}`).expect(404);

    // 檔案在垃圾桶內也不能讀
    const link2 = (await post(c, `/api/files/${f.id}/share-links`, {})).body;
    const vt2 = (await t.http().get(`/api/shared/${link2.token}`)).body.viewToken;
    await guest.get(`/api/assets/${used.id}`).set('Authorization', `Bearer ${vt2}`).expect(200);
    await del(c, `/api/files/${f.id}`).expect(204);
    await guest.get(`/api/assets/${used.id}`).set('Authorization', `Bearer ${vt2}`).expect(404);
  });
});
