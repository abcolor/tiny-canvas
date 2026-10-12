import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createTestApp, signup, type TestApp } from './helpers';
import { DailyService } from '../src/daily/daily.service';

let t: TestApp;
let daily: DailyService;
beforeAll(async () => {
  t = await createTestApp();
  daily = t.app.get(DailyService);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const NOW = new Date('2026-06-01T03:30:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const DAY = 86_400_000;
const HOUR = 3_600_000;
const STATE = new Uint8Array(gzipSync(Buffer.from([0, 0])));

async function makeAsset(ownerId: string, createdAt: Date) {
  const id = crypto.randomUUID();
  const storageKey = `${ownerId}/${id}`;
  const p = path.join(t.config.storageDir, storageKey);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'x');
  await t.prisma.asset.create({ data: { id, ownerId, storageKey, mime: 'image/png', size: 1, createdAt } });
  return { id, path: p };
}

describe('每日排程', () => {
  it('永久刪除進垃圾桶超過 30 天的檔案與資料夾', async () => {
    const { userId } = await signup(t);
    const oldFolder = await t.prisma.folder.create({ data: { ownerId: userId, name: 'old', deletedAt: ago(31 * DAY) } });
    const oldFile = await t.prisma.file.create({
      data: { ownerId: userId, title: 'in old', folderId: oldFolder.id, deletedAt: ago(31 * DAY) },
    });
    const recentTrash = await t.prisma.file.create({ data: { ownerId: userId, title: 'r', deletedAt: ago(29 * DAY) } });
    const alive = await t.prisma.file.create({ data: { ownerId: userId, title: 'alive' } });

    const r = await daily.run(NOW);
    expect(r).toMatchObject({ files: 1, folders: 1 });
    expect(await t.prisma.folder.findUnique({ where: { id: oldFolder.id } })).toBeNull();
    expect(await t.prisma.file.findUnique({ where: { id: oldFile.id } })).toBeNull();
    expect(await t.prisma.file.findUnique({ where: { id: recentTrash.id } })).not.toBeNull();
    expect(await t.prisma.file.findUnique({ where: { id: alive.id } })).not.toBeNull();
  });

  it('依 VERSION_RETENTION_DAYS 刪除過期的自動版本，保留命名版本', async () => {
    const { userId } = await signup(t);
    const f = await t.prisma.file.create({ data: { ownerId: userId, title: 'f' } });
    const mk = (label: string | null, createdAt: Date) =>
      t.prisma.docVersion.create({ data: { fileId: f.id, state: STATE, contentHash: 'h', label, createdAt } });
    const oldAuto = await mk(null, ago(10 * DAY));
    const oldNamed = await mk('命名', ago(10 * DAY));
    const newAuto = await mk(null, ago(2 * DAY));

    t.config.versionRetentionDays = 0;
    expect((await daily.run(NOW)).versions).toBe(0);
    expect(await t.prisma.docVersion.count()).toBe(3);

    t.config.versionRetentionDays = 7;
    expect((await daily.run(NOW)).versions).toBe(1);
    const left = (await t.prisma.docVersion.findMany()).map((v) => v.id).sort();
    expect(left).toEqual([oldNamed.id, newAuto.id].sort());
    expect(left).not.toContain(oldAuto.id);
  });

  it('清除未被引用且超過 24 小時的圖片；doc_versions 與垃圾桶內檔案的引用仍保留', async () => {
    const { userId } = await signup(t);
    const orphan = await makeAsset(userId, ago(25 * HOUR));
    const young = await makeAsset(userId, ago(23 * HOUR));
    const inFile = await makeAsset(userId, ago(5 * DAY));
    const inTrashedFile = await makeAsset(userId, ago(5 * DAY));
    const inVersion = await makeAsset(userId, ago(5 * DAY));

    await t.prisma.file.create({ data: { ownerId: userId, title: 'a', assetIds: [inFile.id] } });
    await t.prisma.file.create({
      data: { ownerId: userId, title: 'b', assetIds: [inTrashedFile.id], deletedAt: ago(1 * DAY) },
    });
    const g = await t.prisma.file.create({ data: { ownerId: userId, title: 'c' } });
    await t.prisma.docVersion.create({
      data: { fileId: g.id, state: STATE, contentHash: 'h', assetIds: [inVersion.id] },
    });

    const r = await daily.run(NOW);
    expect(r.assets).toBe(1);
    const ids = (await t.prisma.asset.findMany()).map((a) => a.id).sort();
    expect(ids).toEqual([young.id, inFile.id, inTrashedFile.id, inVersion.id].sort());
    expect(fs.existsSync(orphan.path)).toBe(false);
    expect(fs.existsSync(young.path)).toBe(true);
    expect(fs.existsSync(inVersion.path)).toBe(true);
  });

  it('檔案被永久刪除後，它引用的圖片在同一次排程中被清除', async () => {
    const { userId } = await signup(t);
    const a = await makeAsset(userId, ago(40 * DAY));
    await t.prisma.file.create({ data: { ownerId: userId, title: 'x', assetIds: [a.id], deletedAt: ago(31 * DAY) } });
    const r = await daily.run(NOW);
    expect(r).toMatchObject({ files: 1, assets: 1 });
    expect(fs.existsSync(a.path)).toBe(false);
  });

  it('刪除過期的 Session', async () => {
    const { userId } = await signup(t);
    await t.prisma.session.create({
      data: { id: 'expired', userId, csrfToken: 'x', expiresAt: ago(1000) },
    });
    await t.prisma.session.create({
      data: { id: 'valid', userId, csrfToken: 'x', expiresAt: new Date(NOW.getTime() + DAY) },
    });
    await daily.run(NOW);
    const ids = (await t.prisma.session.findMany({ where: { id: { in: ['expired', 'valid'] } } })).map((s) => s.id);
    expect(ids).toEqual(['valid']);
  });
});
