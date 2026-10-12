import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES } from '@tinycanvas/shared';
import type { Asset } from '@tinycanvas/db';
import { CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { ApiException, notFound } from '../common/errors';
import { ShareService } from '../share/share.service';

const RASTER_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** SVG 必須是文字、開頭為 <svg 或 <?xml，且含有 <svg */
function looksLikeSvg(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  const text = buf.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  return (text.startsWith('<svg') || text.startsWith('<?xml')) && text.includes('<svg');
}

/** 依實際內容判斷圖片類型；不是允許的格式時回傳 null */
export function detectImage(buf: Buffer): { mime: string; width: number | null; height: number | null } | null {
  let dims: { type?: string; width?: number; height?: number } | null = null;
  try {
    dims = imageSize(buf);
  } catch {
    dims = null;
  }
  const raster = dims?.type ? RASTER_TYPES[dims.type] : undefined;
  if (raster) return { mime: raster, width: dims?.width ?? null, height: dims?.height ?? null };
  if (looksLikeSvg(buf)) {
    const ok = dims?.type === 'svg';
    return { mime: 'image/svg+xml', width: ok ? (dims?.width ?? null) : null, height: ok ? (dims?.height ?? null) : null };
  }
  return null;
}

/** 上傳圖片的儲存與讀取權限（見 SPEC.md 第 4.4、5.3 節） */
@Injectable()
export class AssetsService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ShareService) private readonly share: ShareService,
  ) {}

  filePath(storageKey: string): string {
    return path.join(this.config.storageDir, storageKey);
  }

  async upload(ownerId: string, declaredMime: string, buf: Buffer): Promise<Asset> {
    if (buf.byteLength > MAX_UPLOAD_BYTES) throw new ApiException(413, 'too_large');
    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(declaredMime)) {
      throw new ApiException(415, 'unsupported_type');
    }
    const detected = detectImage(buf);
    if (!detected) throw new ApiException(415, 'unsupported_type');
    const id = randomUUID();
    const storageKey = `${ownerId}/${id}`;
    const target = this.filePath(storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buf);
    try {
      return await this.prisma.asset.create({
        data: {
          id,
          ownerId,
          storageKey,
          mime: detected.mime,
          size: buf.byteLength,
          width: detected.width,
          height: detected.height,
        },
      });
    } catch (err) {
      await fs.rm(target, { force: true });
      throw err;
    }
  }

  /**
   * 讀取權限：(a) Session 使用者是擁有者；或 (b) 檢視 token 有效、分享連結仍有效，
   * 且圖片在被分享檔案的 asset_ids 內。其餘一律 404
   */
  async authorize(id: string, userId: string | undefined, bearer: string | undefined): Promise<Asset> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw notFound();
    if (userId && asset.ownerId === userId) return asset;
    if (bearer) {
      const file = await this.share.fileForViewToken(bearer);
      if (file && file.assetIds.includes(asset.id)) return asset;
    }
    throw notFound();
  }
}
