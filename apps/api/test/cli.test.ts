import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, signup, type TestApp } from './helpers';
import { CliError, createUser, resetPassword } from '../src/cli/commands';
import { runCli } from '../src/cli/run';
import { verifyPassword } from '../src/auth/passwords';

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

describe('CLI', () => {
  it('create-user 建立帳號，可以登入；重複或格式錯誤時失敗', async () => {
    const u = await createUser(t.prisma, 'Cli@Example.com', 'password123');
    expect(u.email).toBe('cli@example.com');
    await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'cli@example.com', password: 'password123' })
      .expect(200);
    await expect(createUser(t.prisma, 'cli@example.com', 'password123')).rejects.toThrow(CliError);
    await expect(createUser(t.prisma, 'bad', 'password123')).rejects.toThrow('Email 格式不正確');
    await expect(createUser(t.prisma, 'ok@example.com', 'short')).rejects.toThrow('密碼長度');
  });

  it('reset-password 更新密碼並刪除該帳號的 Session', async () => {
    const c = await signup(t, 'r@example.com', 'oldpassword');
    const other = await signup(t, 'o@example.com');
    await resetPassword(t.prisma, 'r@example.com', 'newpassword');
    await c.agent.get('/api/me').expect(401);
    await other.agent.get('/api/me').expect(200);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: 'r@example.com' } });
    expect(await verifyPassword(user.passwordHash, 'newpassword')).toBe(true);
    await expect(resetPassword(t.prisma, 'none@example.com', 'newpassword')).rejects.toThrow('找不到帳號');
  });

  it('runCli：參數錯誤與 run-daily', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await runCli(['nope'])).toBe(2);
      expect(await runCli(['create-user'])).toBe(1);
      expect(await runCli(['create-user', '--email', 'x@example.com', '--password', 'password123'])).toBe(0);
      expect(await t.prisma.user.count()).toBe(1);
      expect(await runCli(['create-user', '--email', 'x@example.com', '--password', 'password123'])).toBe(1);
      expect(err).toHaveBeenLastCalledWith('錯誤：帳號已存在：x@example.com');
      expect(await runCli(['run-daily', '--now', 'garbage'])).toBe(1);
      expect(await runCli(['run-daily', '--now', '2030-01-01T00:00:00Z'])).toBe(0);
      expect(log.mock.calls.at(-1)?.[0]).toContain('每日排程完成');
    } finally {
      err.mockRestore();
      log.mockRestore();
    }
  });
});
