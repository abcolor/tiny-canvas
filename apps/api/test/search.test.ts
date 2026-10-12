import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SearchResultDto } from '@tinycanvas/shared';
import { createTestApp, del, makeDocState, post, signup, storeDocument, type TestApp } from './helpers';
import { escapeLike, makeSnippet } from '../src/search/search.service';

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

describe('搜尋', () => {
  it('依檔名與內容搜尋，含 2 個中文字與片段', async () => {
    const c = await signup(t);
    const other = await signup(t);
    const a = (await post(c, '/api/files', { title: '產品流程圖' })).body;
    const b = (await post(c, '/api/files', { title: '會議記錄' })).body;
    const long = '這是一段很長的開頭文字，用來確認片段只擷取命中位置附近的內容而不是整段文字。';
    await storeDocument(t.prisma, b.id, makeDocState({ texts: [long + '登入流程說明' + long, 'Hello World'] }));
    const trashed = (await post(c, '/api/files', { title: '舊的流程' })).body;
    await del(c, `/api/files/${trashed.id}`).expect(204);
    await post(other, '/api/files', { title: '別人的流程' }).expect(201);

    const res = await c.agent.get('/api/search').query({ q: '流程' }).expect(200);
    const results = res.body as SearchResultDto[];
    expect(results.map((r) => r.file.id).sort()).toEqual([a.id, b.id].sort());
    const ra = results.find((r) => r.file.id === a.id)!;
    expect(ra.snippet).toBeNull();
    expect(ra.file).toMatchObject({ title: '產品流程圖', type: 'board', deletedAt: null });
    const rb = results.find((r) => r.file.id === b.id)!;
    expect(rb.snippet).toContain('登入流程說明');
    expect(rb.snippet!.length).toBeLessThan(80);
    expect(typeof rb.score).toBe('number');

    // 單一中文字、不分大小寫
    expect((await c.agent.get('/api/search').query({ q: '議' })).body.map((r: SearchResultDto) => r.file.id)).toEqual([
      b.id,
    ]);
    const hello = (await c.agent.get('/api/search').query({ q: 'hello' })).body as SearchResultDto[];
    expect(hello[0].snippet).toContain('Hello');
  });

  it('LIKE 特殊字元被跳脫', async () => {
    const c = await signup(t);
    await post(c, '/api/files', { title: '100% 完成' });
    await post(c, '/api/files', { title: '1000 完成' });
    await post(c, '/api/files', { title: 'a_b' });
    await post(c, '/api/files', { title: 'axb' });
    await post(c, '/api/files', { title: 'back\\slash' });
    const pct = (await c.agent.get('/api/search').query({ q: '0%' })).body as SearchResultDto[];
    expect(pct.map((r) => r.file.title)).toEqual(['100% 完成']);
    const us = (await c.agent.get('/api/search').query({ q: 'a_b' })).body as SearchResultDto[];
    expect(us.map((r) => r.file.title)).toEqual(['a_b']);
    const bs = (await c.agent.get('/api/search').query({ q: 'k\\s' })).body as SearchResultDto[];
    expect(bs.map((r) => r.file.title)).toEqual(['back\\slash']);
  });

  it('空查詢回傳 400；最多 30 筆', async () => {
    const c = await signup(t);
    await c.agent.get('/api/search').query({ q: ' ' }).expect(400);
    await t.prisma.file.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({ ownerId: c.userId, title: `圖 ${i}` })),
    });
    expect((await c.agent.get('/api/search').query({ q: '圖' })).body).toHaveLength(30);
  });

  it('輔助函式', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    expect(makeSnippet('abc', 'x')).toBeNull();
    expect(makeSnippet('前文 ABC 後文', 'abc')).toBe('前文 ABC 後文');
    const s = makeSnippet('x'.repeat(100) + 'HIT' + 'y'.repeat(100), 'hit')!;
    expect(s).toBe('…' + 'x'.repeat(30) + 'HIT' + 'y'.repeat(30) + '…');
  });
});
