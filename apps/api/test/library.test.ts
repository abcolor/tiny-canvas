import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FileDto, FolderDto } from '@tinycanvas/shared';
import { createTestApp, signup, type Client, type TestApp } from './helpers';

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

const post = (c: Client, url: string, body: object = {}) => c.agent.post(url).set('X-CSRF-Token', c.csrf).send(body);
const patch = (c: Client, url: string, body: object) => c.agent.patch(url).set('X-CSRF-Token', c.csrf).send(body);
const del = (c: Client, url: string) => c.agent.delete(url).set('X-CSRF-Token', c.csrf);

async function folder(c: Client, name: string, parentId: string | null = null): Promise<FolderDto> {
  const r = await post(c, '/api/folders', { name, parentId });
  expect(r.status).toBe(201);
  return r.body;
}
async function file(c: Client, title: string, folderId: string | null = null): Promise<FileDto> {
  const r = await post(c, '/api/files', { title, folderId });
  expect(r.status).toBe(201);
  return r.body;
}

describe('資料夾', () => {
  it('建立、列出、重新命名、移動、分頁資料夾與排序鍵', async () => {
    const c = await signup(t);
    const a = await folder(c, 'A');
    expect(a).toMatchObject({ name: 'A', parentId: null, isTabbed: false, sortKey: 'a0', deletedAt: null });
    expect(typeof a.createdAt).toBe('string');
    const b = await folder(c, 'B', a.id);
    const r = await patch(c, `/api/folders/${b.id}`, { name: 'B2', parentId: null, isTabbed: true, sortKey: 'a1' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'B2', parentId: null, isTabbed: true, sortKey: 'a1' });
    const list = await c.agent.get('/api/folders').expect(200);
    expect(list.body.map((f: FolderDto) => f.name)).toEqual(['A', 'B2']);
    await post(c, '/api/folders', { name: '' }).expect(400);
  });

  it('移動造成循環時回傳 400', async () => {
    const c = await signup(t);
    const a = await folder(c, 'A');
    const b = await folder(c, 'B', a.id);
    const d = await folder(c, 'C', b.id);
    expect((await patch(c, `/api/folders/${a.id}`, { parentId: d.id })).status).toBe(400);
    expect((await patch(c, `/api/folders/${a.id}`, { parentId: a.id })).body.error).toBe('folder_cycle');
    expect((await patch(c, `/api/folders/${d.id}`, { parentId: a.id })).status).toBe(200);
  });
});

describe('檔案', () => {
  it('CRUD、我的最愛、最近檔案', async () => {
    const c = await signup(t);
    const f1 = await file(c, '流程圖');
    expect(f1).toMatchObject({ type: 'board', title: '流程圖', folderId: null, isFavorite: false, deletedAt: null });
    const dir = await folder(c, 'Dir');
    const f2 = await file(c, '線框圖', dir.id);

    expect((await c.agent.get('/api/files').expect(200)).body.map((f: FileDto) => f.id)).toEqual([f1.id]);
    expect((await c.agent.get('/api/files?folderId=root').expect(200)).body).toHaveLength(1);
    expect((await c.agent.get(`/api/files?folderId=${dir.id}`).expect(200)).body.map((f: FileDto) => f.id)).toEqual([
      f2.id,
    ]);

    const upd = await patch(c, `/api/files/${f1.id}`, { title: '新標題', isFavorite: true, folderId: dir.id });
    expect(upd.body).toMatchObject({ title: '新標題', isFavorite: true, folderId: dir.id });
    expect((await c.agent.get('/api/files?favorite=true')).body.map((f: FileDto) => f.id)).toEqual([f1.id]);
    expect((await c.agent.get(`/api/files/${f1.id}`).expect(200)).body.title).toBe('新標題');

    await t.prisma.file.update({ where: { id: f2.id }, data: { updatedAt: new Date(Date.now() + 1000) } });
    const recent = await c.agent.get('/api/files?recent=true').expect(200);
    expect(recent.body.map((f: FileDto) => f.id)).toEqual([f2.id, f1.id]);

    await c.agent.get('/api/files/not-a-uuid').expect(404);
    await post(c, '/api/files', { title: 'x', folderId: '00000000-0000-4000-8000-000000000000' }).expect(404);
  });

  it('別人的資料夾與檔案一律 404', async () => {
    const alice = await signup(t);
    const bob = await signup(t);
    const af = await folder(alice, 'A');
    const file1 = await file(alice, 'secret', af.id);
    await bob.agent.get(`/api/files/${file1.id}`).expect(404);
    await patch(bob, `/api/files/${file1.id}`, { title: 'x' }).expect(404);
    await del(bob, `/api/files/${file1.id}`).expect(404);
    await post(bob, `/api/files/${file1.id}/restore`).expect(404);
    await patch(bob, `/api/folders/${af.id}`, { name: 'x' }).expect(404);
    await del(bob, `/api/folders/${af.id}`).expect(404);
    await bob.agent.get(`/api/files?folderId=${af.id}`).expect(404);
    await post(bob, '/api/files', { title: 'x', folderId: af.id }).expect(404);
    await post(bob, '/api/folders', { name: 'x', parentId: af.id }).expect(404);
    expect((await bob.agent.get('/api/folders')).body).toEqual([]);
    expect((await bob.agent.get('/api/files?recent=true')).body).toEqual([]);
    // 資料沒有被改動
    expect((await alice.agent.get(`/api/files/${file1.id}`).expect(200)).body.title).toBe('secret');
  });
});

describe('垃圾桶', () => {
  it('刪除資料夾時子資料夾與檔案以同一時間進垃圾桶；垃圾桶只列最上層', async () => {
    const c = await signup(t);
    const a = await folder(c, 'A');
    const b = await folder(c, 'B', a.id);
    const fa = await file(c, 'fa', a.id);
    const fb = await file(c, 'fb', b.id);
    const loose = await file(c, 'loose');
    await del(c, `/api/files/${loose.id}`).expect(204);
    await del(c, `/api/folders/${a.id}`).expect(204);

    const folders = await t.prisma.folder.findMany();
    const files = await t.prisma.file.findMany({ where: { id: { in: [fa.id, fb.id] } } });
    const ts = folders[0].deletedAt!.getTime();
    for (const x of [...folders, ...files]) expect(x.deletedAt?.getTime()).toBe(ts);

    expect((await c.agent.get('/api/folders')).body).toEqual([]);
    await c.agent.get(`/api/files/${fa.id}`).expect(404);
    expect((await c.agent.get(`/api/files/${fa.id}?includeTrashed=true`).expect(200)).body.deletedAt).not.toBeNull();

    const trash = await c.agent.get('/api/files?trash=true').expect(200);
    expect(trash.body.folders.map((f: FolderDto) => f.id)).toEqual([a.id]);
    expect(trash.body.files.map((f: FileDto) => f.id)).toEqual([loose.id]);
  });

  it('還原資料夾會一併還原同一批刪除的內容；上層仍在垃圾桶時移到根目錄', async () => {
    const c = await signup(t);
    const a = await folder(c, 'A');
    const b = await folder(c, 'B', a.id);
    const fb = await file(c, 'fb', b.id);
    const earlier = await file(c, 'earlier', b.id);
    await del(c, `/api/files/${earlier.id}`).expect(204);
    await new Promise((r) => setTimeout(r, 5));
    await del(c, `/api/folders/${a.id}`).expect(204);

    // 先刪的檔案仍出現在垃圾桶最上層
    const trash = await c.agent.get('/api/files?trash=true');
    expect(trash.body.files.map((f: FileDto) => f.id)).toEqual([earlier.id]);

    const rb = await post(c, `/api/folders/${b.id}/restore`).expect(200);
    expect(rb.body).toMatchObject({ id: b.id, parentId: null, deletedAt: null });
    expect((await c.agent.get(`/api/files/${fb.id}`).expect(200)).body.folderId).toBe(b.id);
    await c.agent.get(`/api/files/${earlier.id}`).expect(404);

    const ra = await post(c, `/api/folders/${a.id}/restore`).expect(200);
    expect(ra.body.deletedAt).toBeNull();
    expect((await c.agent.get('/api/folders')).body).toHaveLength(2);
  });

  it('還原所在資料夾仍在垃圾桶的檔案時移到根目錄', async () => {
    const c = await signup(t);
    const a = await folder(c, 'A');
    const f = await file(c, 'f', a.id);
    await del(c, `/api/folders/${a.id}`).expect(204);
    const r = await post(c, `/api/files/${f.id}/restore`).expect(200);
    expect(r.body).toMatchObject({ folderId: null, deletedAt: null });
    expect((await c.agent.get('/api/files?folderId=root')).body.map((x: FileDto) => x.id)).toEqual([f.id]);
  });

  it('永久刪除只適用於垃圾桶內的項目', async () => {
    const c = await signup(t);
    const a = await folder(c, 'A');
    const sub = await folder(c, 'S', a.id);
    const f = await file(c, 'f', sub.id);
    const g = await file(c, 'g');
    expect((await del(c, `/api/files/${g.id}?permanent=true`)).status).toBe(400);
    await del(c, `/api/files/${g.id}`).expect(204);
    await del(c, `/api/files/${g.id}?permanent=true`).expect(204);
    expect(await t.prisma.file.findUnique({ where: { id: g.id } })).toBeNull();

    expect((await del(c, `/api/folders/${a.id}?permanent=true`)).body.error).toBe('not_in_trash');
    await del(c, `/api/folders/${a.id}`).expect(204);
    await del(c, `/api/folders/${a.id}?permanent=true`).expect(204);
    expect(await t.prisma.folder.count()).toBe(0);
    expect(await t.prisma.file.findUnique({ where: { id: f.id } })).toBeNull();
  });

  it('不能把檔案或資料夾移進垃圾桶內的資料夾', async () => {
    const c = await signup(t);
    const a = await folder(c, 'A');
    const b = await folder(c, 'B');
    const f = await file(c, 'f');
    await del(c, `/api/folders/${a.id}`).expect(204);
    await patch(c, `/api/files/${f.id}`, { folderId: a.id }).expect(404);
    await patch(c, `/api/folders/${b.id}`, { parentId: a.id }).expect(404);
  });
});
