import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TRASH_RETENTION_DAYS } from '@tinycanvas/shared';
import { CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { LOGGER, type Logger } from '../common/logger';

const DAY_MS = 86_400_000;
/** 未被引用的圖片至少保留 24 小時，避免剛上傳、尚未寫進畫布的圖片被刪除 */
export const ASSET_GRACE_MS = DAY_MS;

export interface DailyResult {
  files: number;
  folders: number;
  versions: number;
  assets: number;
  sessions: number;
}

/** 每日排程（見 SPEC.md 第 7 節）。`now` 由呼叫端傳入，測試與 CLI 可以指定時間 */
@Injectable()
export class DailyService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Cron('30 3 * * *', { name: 'daily' })
  async scheduled(): Promise<void> {
    try {
      await this.run(new Date());
    } catch (err) {
      this.logger.error({ err }, 'daily job failed');
    }
  }

  async run(now: Date): Promise<DailyResult> {
    const trashCutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS);
    // 先刪檔案再刪資料夾：files.folder_id 為 ON DELETE SET NULL
    const files = await this.prisma.file.deleteMany({ where: { deletedAt: { lt: trashCutoff } } });
    const folders = await this.prisma.folder.deleteMany({ where: { deletedAt: { lt: trashCutoff } } });

    let versions = 0;
    if (this.config.versionRetentionDays > 0) {
      const cutoff = new Date(now.getTime() - this.config.versionRetentionDays * DAY_MS);
      versions = (await this.prisma.docVersion.deleteMany({ where: { label: null, createdAt: { lt: cutoff } } })).count;
    }

    const assetCutoff = new Date(now.getTime() - ASSET_GRACE_MS);
    const orphans = await this.prisma.$queryRaw<{ id: string; storage_key: string }[]>`
      SELECT a.id, a.storage_key FROM assets a
      WHERE a.created_at < ${assetCutoff}
        AND NOT EXISTS (SELECT 1 FROM files f WHERE a.id = ANY (f.asset_ids))
        AND NOT EXISTS (SELECT 1 FROM doc_versions v WHERE a.id = ANY (v.asset_ids))`;
    if (orphans.length) {
      await this.prisma.asset.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
      for (const o of orphans) {
        await fs.rm(path.join(this.config.storageDir, o.storage_key), { force: true }).catch((err) => {
          this.logger.warn({ err, assetId: o.id }, 'failed to remove asset file');
        });
      }
    }

    const sessions = await this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
    const result = {
      files: files.count,
      folders: folders.count,
      versions,
      assets: orphans.length,
      sessions: sessions.count,
    };
    this.logger.info({ ...result, now: now.toISOString() }, 'daily job done');
    return result;
  }
}
