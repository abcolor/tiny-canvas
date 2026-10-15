import { Inject, Injectable } from '@nestjs/common';
import { MAX_THUMBNAIL_BYTES, THUMBNAIL_MIME_TYPES } from '@tinycanvas/shared';
import type { File } from '@tinycanvas/db';
import { PrismaService } from '../prisma.service';
import { ApiException, notFound } from '../common/errors';
import { detectImage } from '../assets/assets.service';
import { LibraryService } from './library.service';

/**
 * 首頁卡片縮圖（見 docs/DECISIONS.md 2026-10-15）：前端以畫布引擎繪製後上傳，
 * 圖片存在 file_thumbnails，產生時間記在 files.thumbnail_at 供列表帶出
 */
@Injectable()
export class ThumbnailsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LibraryService) private readonly lib: LibraryService,
  ) {}

  async put(ownerId: string, fileId: string, buf: Buffer): Promise<File> {
    await this.lib.getFile(ownerId, fileId);
    if (buf.byteLength > MAX_THUMBNAIL_BYTES) throw new ApiException(413, 'too_large');
    const detected = detectImage(buf);
    if (!detected || !(THUMBNAIL_MIME_TYPES as readonly string[]).includes(detected.mime)) {
      throw new ApiException(415, 'unsupported_type');
    }
    const data = new Uint8Array(buf);
    return this.prisma.$transaction(async (tx) => {
      await tx.fileThumbnail.upsert({
        where: { fileId },
        create: { fileId, mime: detected.mime, data },
        update: { mime: detected.mime, data },
      });
      return tx.file.update({ where: { id: fileId }, data: { thumbnailAt: new Date() } });
    });
  }

  async remove(ownerId: string, fileId: string): Promise<File> {
    await this.lib.getFile(ownerId, fileId);
    return this.prisma.$transaction(async (tx) => {
      await tx.fileThumbnail.deleteMany({ where: { fileId } });
      return tx.file.update({ where: { id: fileId }, data: { thumbnailAt: null } });
    });
  }

  /** 垃圾桶內的檔案也可以讀取（垃圾桶頁面日後可能顯示） */
  async get(ownerId: string, fileId: string): Promise<{ mime: string; data: Uint8Array }> {
    await this.lib.getFile(ownerId, fileId, { includeTrashed: true });
    const t = await this.prisma.fileThumbnail.findUnique({ where: { fileId } });
    if (!t) throw notFound();
    return { mime: t.mime, data: t.data };
  }
}
