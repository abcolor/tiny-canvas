import type { AssetDto, FileDto, FolderDto, ShareLinkDto } from '@tinycanvas/shared';
import { notFound } from './errors';
import type { Asset, File, Folder, ShareLink } from '@tinycanvas/db';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toFolderDto(f: Folder): FolderDto {
  return {
    id: f.id,
    parentId: f.parentId,
    name: f.name,
    isTabbed: f.isTabbed,
    sortKey: f.sortKey,
    createdAt: f.createdAt.toISOString(),
    deletedAt: iso(f.deletedAt),
  };
}

export function toFileDto(f: File): FileDto {
  return {
    id: f.id,
    folderId: f.folderId,
    type: 'board',
    title: f.title,
    isFavorite: f.isFavorite,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    deletedAt: iso(f.deletedAt),
  };
}

export function toShareLinkDto(l: ShareLink): ShareLinkDto {
  return {
    id: l.id,
    token: l.token,
    hasPassword: l.passwordHash !== null,
    expiresAt: iso(l.expiresAt),
    revokedAt: iso(l.revokedAt),
    createdAt: l.createdAt.toISOString(),
  };
}

export function toAssetDto(a: Asset): AssetDto {
  return { id: a.id, mime: a.mime, size: a.size, width: a.width, height: a.height };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

/** 路徑參數必須是 UUID，否則視為不存在（避免 Prisma 因格式錯誤丟 500） */
export class UuidPipe {
  transform(value: unknown): string {
    if (!isUuid(value)) throw notFound();
    return value.toLowerCase();
  }
}
