import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decodeJwt, SignJWT } from 'jose';
import { VIEW_TOKEN_TTL_SECONDS, type ShareLinkDto } from '@tinycanvas/shared';
import { createTestApp, del, post, signup, type TestApp } from './helpers';
import { signViewToken, verifyViewToken } from '../src/share/view-token';

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

describe('分享連結管理', () => {
  it('建立、列出、撤銷', async () => {
    const c = await signup(t);
    const f = (await post(c, '/api/files', { title: '分享圖' })).body;
    const r = await post(c, `/api/files/${f.id}/share-links`, {});
    expect(r.status).toBe(201);
    const link = r.body as ShareLinkDto;
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link).toMatchObject({ hasPassword: false, expiresAt: null, revokedAt: null });

    const pw = await post(c, `/api/files/${f.id}/share-links`, {
      password: 'secret',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(pw.body.hasPassword).toBe(true);
    expect(pw.body.expiresAt).not.toBeNull();
    await post(c, `/api/files/${f.id}/share-links`, { expiresAt: new Date(Date.now() - 1000).toISOString() }).expect(400);

    const list = await c.agent.get(`/api/files/${f.id}/share-links`).expect(200);
    expect(list.body).toHaveLength(2);

    await del(c, `/api/files/${f.id}/share-links/${link.id}`).expect(204);
    const after = await c.agent.get(`/api/files/${f.id}/share-links`).expect(200);
    expect(after.body.find((l: ShareLinkDto) => l.id === link.id).revokedAt).not.toBeNull();
    await t.http().get(`/api/shared/${link.token}`).expect(404, { error: 'not_found' });

    const other = await signup(t);
    await other.agent.get(`/api/files/${f.id}/share-links`).expect(404);
    await post(other, `/api/files/${f.id}/share-links`, {}).expect(404);
    await del(other, `/api/files/${f.id}/share-links/${pw.body.id}`).expect(404);
  });
});

describe('訪客存取', () => {
  it('無密碼：直接取得檢視 token；claims 正確、2 小時有效', async () => {
    const c = await signup(t);
    const f = (await post(c, '/api/files', { title: '公開圖' })).body;
    const link = (await post(c, `/api/files/${f.id}/share-links`, {})).body;
    const res = await t.http().get(`/api/shared/${link.token}`).expect(200);
    expect(res.body).toMatchObject({ fileId: f.id, title: '公開圖', requiresPassword: false });
    const claims = decodeJwt(res.body.viewToken);
    expect(claims).toMatchObject({ fileId: f.id, linkId: link.id, readonly: true });
    expect(claims.exp! - claims.iat!).toBe(VIEW_TOKEN_TTL_SECONDS);
    expect(await verifyViewToken(t.config.sessionSecret, res.body.viewToken)).toEqual({
      fileId: f.id,
      linkId: link.id,
      readonly: true,
    });
  });

  it('有密碼：需要 unlock；密碼錯誤 401；次數限制 429', async () => {
    const c = await signup(t);
    const f = (await post(c, '/api/files', { title: '密碼圖' })).body;
    const link = (await post(c, `/api/files/${f.id}/share-links`, { password: 'open sesame' })).body;
    const info = await t.http().get(`/api/shared/${link.token}`).expect(200);
    expect(info.body).toMatchObject({ requiresPassword: true, viewToken: null });

    const guest = t.http();
    const bad = await guest.post(`/api/shared/${link.token}/unlock`).send({ password: 'nope' });
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ error: 'invalid_password' });
    const ok = await guest.post(`/api/shared/${link.token}/unlock`).send({ password: 'open sesame' }).expect(200);
    expect(decodeJwt(ok.body.viewToken)).toMatchObject({ fileId: f.id, linkId: link.id, readonly: true });

    for (let i = 0; i < 8; i++) await guest.post(`/api/shared/${link.token}/unlock`).send({ password: 'nope' });
    const limited = await guest.post(`/api/shared/${link.token}/unlock`).send({ password: 'open sesame' });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('rate_limited');
  });

  it('過期、未知 token、檔案在垃圾桶或已刪除時 404', async () => {
    const c = await signup(t);
    const f = (await post(c, '/api/files', { title: 'x' })).body;
    const link = (await post(c, `/api/files/${f.id}/share-links`, {})).body;
    await t.http().get('/api/shared/unknown-token').expect(404);
    await t.http().post('/api/shared/unknown-token/unlock').send({ password: 'x' }).expect(404);

    await t.prisma.shareLink.update({ where: { id: link.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await t.http().get(`/api/shared/${link.token}`).expect(404);
    await t.prisma.shareLink.update({ where: { id: link.id }, data: { expiresAt: null } });
    await t.http().get(`/api/shared/${link.token}`).expect(200);

    await del(c, `/api/files/${f.id}`).expect(204);
    await t.http().get(`/api/shared/${link.token}`).expect(404);
    await del(c, `/api/files/${f.id}?permanent=true`).expect(204);
    await t.http().get(`/api/shared/${link.token}`).expect(404);
  });
});

describe('檢視 token 輔助函式', () => {
  it('拒絕錯誤簽章、過期與缺少 readonly 的 token', async () => {
    const secret = t.config.sessionSecret;
    const tok = await signViewToken(secret, { fileId: 'f', linkId: 'l' }, new Date('2026-01-01T00:00:00Z'));
    expect(await verifyViewToken(secret, tok, new Date('2026-01-01T01:59:00Z'))).not.toBeNull();
    expect(await verifyViewToken(secret, tok, new Date('2026-01-01T02:01:00Z'))).toBeNull();
    expect(await verifyViewToken('x'.repeat(40), tok, new Date('2026-01-01T01:00:00Z'))).toBeNull();
    const noRo = await new SignJWT({ fileId: 'f', linkId: 'l' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret));
    expect(await verifyViewToken(secret, noRo)).toBeNull();
  });
});
