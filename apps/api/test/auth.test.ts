import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '@tinycanvas/shared';
import { createTestApp, signup, type TestApp } from './helpers';
import { sha256Hex } from '../src/auth/auth.service';

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

describe('healthz 與設定', () => {
  it('healthz 回傳 ok', async () => {
    const res = await t.http().get('/api/healthz').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('auth/config 反映 ALLOW_SIGNUP', async () => {
    expect((await t.http().get('/api/auth/config').expect(200)).body).toEqual({ allowSignup: true });
    t.config.allowSignup = false;
    expect((await t.http().get('/api/auth/config').expect(200)).body).toEqual({ allowSignup: false });
  });
});

describe('註冊', () => {
  it('ALLOW_SIGNUP 關閉時回傳 403 signup_disabled', async () => {
    t.config.allowSignup = false;
    const res = await t.http().post('/api/auth/signup').send({ email: 'a@example.com', password: 'password123' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'signup_disabled' });
    expect(await t.prisma.user.count()).toBe(0);
  });

  it('開放時可註冊並直接登入；密碼以 argon2id 雜湊', async () => {
    const res = await t.http().post('/api/auth/signup').send({ email: ' A@Example.com ', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('a@example.com');
    expect(typeof res.body.csrfToken).toBe('string');
    const cookie = res.headers['set-cookie'][0] as string;
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/i);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: 'a@example.com' } });
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('重複 email 回傳 409；格式錯誤回傳 400', async () => {
    await signup(t, 'dup@example.com');
    const dup = await t.http().post('/api/auth/signup').send({ email: 'dup@example.com', password: 'password123' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('email_taken');
    const bad = await t.http().post('/api/auth/signup').send({ email: 'nope', password: 'short' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_request');
  });
});

describe('登入、登出、me', () => {
  it('完整流程', async () => {
    await signup(t, 'me@example.com', 'password123');
    const agent = t.http();
    await agent.get('/api/me').expect(401, { error: 'unauthenticated' });

    const wrong = await agent.post('/api/auth/login').send({ email: 'me@example.com', password: 'wrongpass' });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: 'invalid_credentials' });
    const unknown = await agent.post('/api/auth/login').send({ email: 'x@example.com', password: 'password123' });
    expect(unknown.body).toEqual({ error: 'invalid_credentials' });

    const login = await agent.post('/api/auth/login').send({ email: 'ME@example.com', password: 'password123' });
    expect(login.status).toBe(200);
    const csrf = login.body.csrfToken as string;
    expect(login.body.user.email).toBe('me@example.com');

    // sessions.id 是 cookie token 的 SHA-256
    const token = /tc_session=([^;]+)/.exec(login.headers['set-cookie'][0])![1];
    const session = await t.prisma.session.findUnique({ where: { id: sha256Hex(token) } });
    expect(session).not.toBeNull();
    expect(session!.csrfToken).toBe(csrf);
    const days = (session!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    const me = await agent.get('/api/me').expect(200);
    expect(me.body).toEqual(login.body);

    const out = await agent.post('/api/auth/logout').set('X-CSRF-Token', csrf);
    expect(out.status).toBe(204);
    expect(out.headers['set-cookie'][0]).toMatch(/tc_session=;/);
    expect(await t.prisma.session.findUnique({ where: { id: sha256Hex(token) } })).toBeNull();
    await agent.get('/api/me').expect(401);
  });

  it('過期的 Session 視為未登入', async () => {
    const c = await signup(t);
    await t.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await c.agent.get('/api/me').expect(401);
  });

  it('HTTPS 的 PUBLIC_URL 會加上 Secure', async () => {
    t.config.secureCookies = true;
    const res = await t.http().post('/api/auth/signup').send({ email: 's@example.com', password: 'password123' });
    expect(res.headers['set-cookie'][0]).toMatch(/; Secure/);
  });
});

describe('CSRF', () => {
  it('缺少或錯誤的 X-CSRF-Token 回傳 403 csrf', async () => {
    const c = await signup(t);
    const missing = await c.agent.post('/api/folders').send({ name: 'x' });
    expect(missing.status).toBe(403);
    expect(missing.body).toEqual({ error: 'csrf' });
    const wrong = await c.agent.post('/api/folders').set('X-CSRF-Token', 'nope').send({ name: 'x' });
    expect(wrong.status).toBe(403);
    await c.agent.post('/api/auth/logout').expect(403);
    const ok = await c.agent.post('/api/folders').set('X-CSRF-Token', c.csrf).send({ name: 'x' });
    expect(ok.status).toBe(201);
    // GET 不需要 CSRF
    await c.agent.get('/api/folders').expect(200);
  });

  it('未登入的寫入請求回傳 401', async () => {
    await t.http().post('/api/folders').send({ name: 'x' }).expect(401);
  });
});

describe('登入次數限制', () => {
  it('同一 IP 每分鐘第 11 次回傳 429', async () => {
    await signup(t, 'rl@example.com');
    const agent = t.http();
    for (let i = 0; i < 10; i++) {
      const r = await agent
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.7')
        .send({ email: 'rl@example.com', password: 'wrongpass' });
      expect(r.status).toBe(401);
    }
    const blocked = await agent
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ email: 'rl@example.com', password: 'password123' });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'rate_limited' });
    // 其他 IP 不受影響
    const other = await agent
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.8')
      .send({ email: 'rl@example.com', password: 'password123' });
    expect(other.status).toBe(200);
  });
});
