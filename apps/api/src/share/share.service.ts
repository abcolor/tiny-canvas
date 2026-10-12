import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { File, ShareLink } from '@tinycanvas/db';
import { CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { badRequest, notFound } from '../common/errors';
import { LibraryService } from '../files/library.service';
import { hashPassword, verifyPassword } from '../auth/passwords';
import { signViewToken, verifyViewToken } from './view-token';

const isLinkValid = (l: ShareLink, now: Date) => !l.revokedAt && (!l.expiresAt || l.expiresAt > now);

/** 唯讀分享連結（見 SPEC.md 第 5.3 節） */
@Injectable()
export class ShareService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LibraryService) private readonly lib: LibraryService,
  ) {}

  async list(ownerId: string, fileId: string): Promise<ShareLink[]> {
    await this.lib.getFile(ownerId, fileId);
    return this.prisma.shareLink.findMany({ where: { fileId }, orderBy: { createdAt: 'desc' } });
  }

  async create(
    ownerId: string,
    fileId: string,
    data: { password?: string | null; expiresAt?: string | null },
  ): Promise<ShareLink> {
    await this.lib.getFile(ownerId, fileId);
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) throw badRequest('invalid_expiry');
    return this.prisma.shareLink.create({
      data: {
        fileId,
        token: randomBytes(32).toString('base64url'),
        passwordHash: data.password ? await hashPassword(data.password) : null,
        expiresAt,
      },
    });
  }

  async revoke(ownerId: string, fileId: string, linkId: string): Promise<void> {
    await this.lib.getFile(ownerId, fileId, { includeTrashed: true });
    const link = await this.prisma.shareLink.findFirst({ where: { id: linkId, fileId } });
    if (!link) throw notFound();
    if (!link.revokedAt) await this.prisma.shareLink.update({ where: { id: linkId }, data: { revokedAt: new Date() } });
  }

  /** 以 token 找到仍有效的連結與檔案；撤銷、過期、檔案在垃圾桶或已刪除時為 404 */
  async resolve(token: string, now = new Date()): Promise<{ link: ShareLink; file: File }> {
    const link = await this.prisma.shareLink.findUnique({ where: { token }, include: { file: true } });
    if (!link || !isLinkValid(link, now) || link.file.deletedAt) throw notFound();
    const { file, ...rest } = link;
    return { link: rest, file };
  }

  async checkPassword(link: ShareLink, password: string): Promise<boolean> {
    if (!link.passwordHash) return true;
    return verifyPassword(link.passwordHash, password);
  }

  issueViewToken(link: ShareLink): Promise<string> {
    return signViewToken(this.config.sessionSecret, { fileId: link.fileId, linkId: link.id });
  }

  /** 驗證檢視 token，並確認對應的連結仍然有效、檔案不在垃圾桶；回傳檔案 */
  async fileForViewToken(token: string, now = new Date()): Promise<File | null> {
    const claims = await verifyViewToken(this.config.sessionSecret, token, now);
    if (!claims) return null;
    const link = await this.prisma.shareLink.findUnique({ where: { id: claims.linkId }, include: { file: true } });
    if (!link || link.fileId !== claims.fileId || !isLinkValid(link, now) || link.file.deletedAt) return null;
    return link.file;
  }
}
