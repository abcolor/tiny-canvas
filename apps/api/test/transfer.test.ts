import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { docCanonical, docFromState, getObjects, type AssetDto, type BoardFile, type FileDto, type FolderDto } from '@tinycanvas/shared';
import { createTestApp, makeDocState, post, signup, storeDocument, type Client, type TestApp } from './helpers';

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

const importFile = (c: Client, buf: Buffer, folderId?: string) => {
  const req = c.agent.post('/api/files/import').set('X-CSRF-Token', c.csrf);
  if (folderId) req.field('folderId', folderId);
  return req.attach('file', buf, { filename: 'board.json', contentType: 'application/json' });
};

/** 建立含文字與圖片的白板，回傳檔案與圖片 */
async function boardWithContent(c: Client, title = '流程圖') {
  const asset = (
    await c.agent.post('/api/assets').set('X-CSRF-Token', c.csrf).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
  ).body as AssetDto;
  const file = (await post(c, '/api/files', { title }).expect(201)).body as FileDto;
  await storeDocument(t.prisma, file.id, makeDocState({ texts: ['開始', '結束'], assetIds: [asset.id] }));
  return { file, asset };
}

describe('白板匯出與匯入', () => {
  it('匯出 JSON 附件，內嵌圖片', async () => {
    const c = await signup(t);
    const { file, asset } = await boardWithContent(c);
    const r = await c.agent.get(`/api/files/${file.id}/export`).expect(200);
    expect(r.headers['content-type']).toContain('application/json');
    expect(r.headers['content-disposition']).toContain("filename*=UTF-8''" + encodeURIComponent('流程圖.tinycanvas.json'));
    const data = JSON.parse(r.text) as BoardFile;
    expect(data).toMatchObject({ format: 'tinycanvas-board', version: 1, title: '流程圖' });
    expect(data.objects).toHaveLength(3);
    expect(data.assets).toEqual([{ id: asset.id, mime: 'image/png', data: PNG.toString('base64') }]);
  });

  it('匯入建立新檔案：內容相同、圖片換成新的 id、可搜尋', async () => {
    const c = await signup(t);
    const { file, asset } = await boardWithContent(c);
    const exported = (await c.agent.get(`/api/files/${file.id}/export`).expect(200)).text;
    const folder = (await post(c, '/api/folders', { name: 'Backup' }).expect(201)).body as FolderDto;

    const r = await importFile(c, Buffer.from(exported), folder.id).expect(201);
    const created = r.body as FileDto;
    expect(created.id).not.toBe(file.id);
    expect(created).toMatchObject({ title: '流程圖', folderId: folder.id });

    const row = await t.prisma.file.findUniqueOrThrow({ where: { id: created.id }, include: { document: true } });
    expect(row.searchText).toContain('開始');
    expect(row.assetIds).toHaveLength(1);
    expect(row.assetIds[0]).not.toBe(asset.id);
    const newAsset = await t.prisma.asset.findUniqueOrThrow({ where: { id: row.assetIds[0]! } });
    expect(newAsset.ownerId).toBe(c.userId);

    // 除了圖片 id 之外與原本相同
    const orig = docCanonical(docFromState((await t.prisma.document.findUniqueOrThrow({ where: { fileId: file.id } })).state));
    expect(docCanonical(docFromState(row.document!.state))).toBe(orig.replace(asset.id, newAsset.id));
    const img = [...getObjects(docFromState(row.document!.state)).values()].find((m) => m.get('type') === 'image')!;
    expect(img.get('assetId')).toBe(newAsset.id);
  });

  it('另一個帳號可以匯入別人匯出的檔案，但不能直接匯出別人的檔案', async () => {
    const a = await signup(t);
    const b = await signup(t);
    const { file } = await boardWithContent(a);
    await b.agent.get(`/api/files/${file.id}/export`).expect(404);
    const exported = (await a.agent.get(`/api/files/${file.id}/export`).expect(200)).text;
    const r = await importFile(b, Buffer.from(exported)).expect(201);
    expect((r.body as FileDto).folderId).toBeNull();
    const row = await t.prisma.file.findUniqueOrThrow({ where: { id: (r.body as FileDto).id } });
    expect(row.ownerId).toBe(b.userId);
    const owners = await t.prisma.asset.findMany({ where: { id: { in: row.assetIds } } });
    expect(owners.map((x) => x.ownerId)).toEqual([b.userId]);
  });

  it('空白畫布也能匯出與匯入', async () => {
    const c = await signup(t);
    const file = (await post(c, '/api/files', { title: 'Empty' }).expect(201)).body as FileDto;
    const exported = (await c.agent.get(`/api/files/${file.id}/export`).expect(200)).text;
    expect(JSON.parse(exported).objects).toEqual([]);
    await importFile(c, Buffer.from(exported)).expect(201);
  });

  it('格式錯誤時回傳 400，且不留下檔案或圖片', async () => {
    const c = await signup(t);
    const bad = async (body: string) => {
      const r = await importFile(c, Buffer.from(body));
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_board_file');
    };
    await bad('not json');
    await bad(JSON.stringify({ format: 'other', version: 1, title: 'x', objects: [] }));
    await bad(
      JSON.stringify({
        format: 'tinycanvas-board',
        version: 1,
        title: 'x',
        objects: [{ id: 'a', type: 'sticky' }],
        assets: [{ id: 'p', mime: 'image/png', data: PNG.toString('base64') }],
      }),
    );
    expect(await t.prisma.file.count()).toBe(0);
    expect(await t.prisma.asset.count()).toBe(0);
  });

  it('匯入到別人的資料夾回傳 404；缺 CSRF 被拒', async () => {
    const a = await signup(t);
    const b = await signup(t);
    const folder = (await post(a, '/api/folders', { name: 'A' }).expect(201)).body as FolderDto;
    const body = Buffer.from(JSON.stringify({ format: 'tinycanvas-board', version: 1, title: 'x', objects: [] }));
    expect((await importFile(b, body, folder.id)).status).toBe(404);
    const noCsrf = await b.agent.post('/api/files/import').attach('file', body, { filename: 'b.json', contentType: 'application/json' });
    expect(noCsrf.status).toBe(403);
  });
});
