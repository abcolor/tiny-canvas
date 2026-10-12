import { Inject, Injectable } from '@nestjs/common';
import type { File, Folder } from '@tinycanvas/db';
import { PrismaService } from '../prisma.service';
import { ApiException, badRequest, notFound } from '../common/errors';

/** 收集 root 以下（含 root）的資料夾 id；filter 決定是否繼續往下走 */
function collectSubtree(root: Folder, all: Folder[], filter: (f: Folder) => boolean = () => true): Folder[] {
  const byParent = new Map<string, Folder[]>();
  for (const f of all) {
    if (!f.parentId) continue;
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  const out: Folder[] = [root];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of byParent.get(cur.id) ?? []) {
      if (!filter(child)) continue;
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

const sameTime = (a: Date | null, b: Date | null) => !!a && !!b && a.getTime() === b.getTime();

/**
 * 資料夾與檔案的存取、垃圾桶與還原（見 SPEC.md 第 5.2 節）。
 * 所有查詢都限定擁有者；別人的 id 一律視為不存在（404）。
 */
@Injectable()
export class LibraryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ---------- 資料夾 ----------

  async getFolder(ownerId: string, id: string, opts: { includeTrashed?: boolean } = {}): Promise<Folder> {
    const f = await this.prisma.folder.findFirst({ where: { id, ownerId } });
    if (!f || (f.deletedAt && !opts.includeTrashed)) throw notFound();
    return f;
  }

  /** 移入目標資料夾前檢查：必須是自己的、不在垃圾桶內 */
  async assertTargetFolder(ownerId: string, folderId: string | null | undefined): Promise<void> {
    if (!folderId) return;
    const f = await this.prisma.folder.findFirst({ where: { id: folderId, ownerId, deletedAt: null } });
    if (!f) throw notFound();
  }

  listFolders(ownerId: string) {
    return this.prisma.folder.findMany({
      where: { ownerId, deletedAt: null },
      orderBy: [{ sortKey: 'asc' }, { name: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createFolder(ownerId: string, data: { name: string; parentId?: string | null; isTabbed?: boolean }) {
    await this.assertTargetFolder(ownerId, data.parentId);
    return this.prisma.folder.create({
      data: { ownerId, name: data.name, parentId: data.parentId ?? null, isTabbed: data.isTabbed ?? false },
    });
  }

  async updateFolder(
    ownerId: string,
    id: string,
    data: { name?: string; parentId?: string | null; isTabbed?: boolean; sortKey?: string },
  ) {
    await this.getFolder(ownerId, id);
    if (data.parentId !== undefined && data.parentId !== null) {
      if (data.parentId === id) throw badRequest('folder_cycle');
      await this.assertTargetFolder(ownerId, data.parentId);
      // 往上走訪新的上層資料夾，若遇到自己就是循環
      let cur: string | null = data.parentId;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        if (cur === id) throw badRequest('folder_cycle');
        seen.add(cur);
        const p: { parentId: string | null } | null = await this.prisma.folder.findFirst({
          where: { id: cur, ownerId },
          select: { parentId: true },
        });
        cur = p?.parentId ?? null;
      }
    }
    return this.prisma.folder.update({ where: { id }, data });
  }

  /** 資料夾移到垃圾桶：自己、所有子資料夾與其中的檔案使用同一個 deleted_at */
  async trashFolder(ownerId: string, id: string, now = new Date()): Promise<void> {
    const root = await this.getFolder(ownerId, id);
    const all = await this.prisma.folder.findMany({ where: { ownerId, deletedAt: null } });
    const ids = collectSubtree(root, all).map((f) => f.id);
    await this.prisma.$transaction([
      this.prisma.folder.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: now } }),
      this.prisma.file.updateMany({ where: { folderId: { in: ids }, deletedAt: null }, data: { deletedAt: now } }),
    ]);
  }

  /** 永久刪除垃圾桶內的資料夾，連同子資料夾與其中所有檔案 */
  async purgeFolder(ownerId: string, id: string): Promise<void> {
    const root = await this.getFolder(ownerId, id, { includeTrashed: true });
    if (!root.deletedAt) throw badRequest('not_in_trash');
    const all = await this.prisma.folder.findMany({ where: { ownerId } });
    const ids = collectSubtree(root, all).map((f) => f.id);
    await this.prisma.$transaction([
      // files.folder_id 是 ON DELETE SET NULL，必須先刪檔案，否則會掉回根目錄
      this.prisma.file.deleteMany({ where: { ownerId, folderId: { in: ids } } }),
      this.prisma.folder.deleteMany({ where: { ownerId, id: { in: ids } } }),
    ]);
  }

  /** 還原資料夾及同一時間進垃圾桶的子資料夾與檔案；上層仍在垃圾桶時改放到根目錄 */
  async restoreFolder(ownerId: string, id: string): Promise<Folder> {
    const root = await this.getFolder(ownerId, id, { includeTrashed: true });
    if (!root.deletedAt) return root;
    const ts = root.deletedAt;
    const all = await this.prisma.folder.findMany({ where: { ownerId } });
    const ids = collectSubtree(root, all, (f) => sameTime(f.deletedAt, ts)).map((f) => f.id);
    const parent = root.parentId ? all.find((f) => f.id === root.parentId) : null;
    const moveToRoot = !!root.parentId && (!parent || parent.deletedAt !== null);
    const [, , restored] = await this.prisma.$transaction([
      this.prisma.folder.updateMany({ where: { id: { in: ids }, deletedAt: ts }, data: { deletedAt: null } }),
      this.prisma.file.updateMany({ where: { folderId: { in: ids }, deletedAt: ts }, data: { deletedAt: null } }),
      this.prisma.folder.update({
        where: { id },
        data: moveToRoot ? { parentId: null, deletedAt: null } : { deletedAt: null },
      }),
    ]);
    return restored;
  }

  // ---------- 檔案 ----------

  async getFile(ownerId: string, id: string, opts: { includeTrashed?: boolean } = {}): Promise<File> {
    const f = await this.prisma.file.findFirst({ where: { id, ownerId } });
    if (!f || (f.deletedAt && !opts.includeTrashed)) throw notFound();
    return f;
  }

  async listFiles(ownerId: string, folderId: string | null) {
    if (folderId) await this.getFolder(ownerId, folderId);
    return this.prisma.file.findMany({
      where: { ownerId, folderId, deletedAt: null },
      orderBy: [{ title: 'asc' }, { createdAt: 'asc' }],
    });
  }

  listFavorites(ownerId: string) {
    return this.prisma.file.findMany({
      where: { ownerId, isFavorite: true, deletedAt: null },
      orderBy: [{ title: 'asc' }, { createdAt: 'asc' }],
    });
  }

  listRecent(ownerId: string, limit = 20) {
    return this.prisma.file.findMany({
      where: { ownerId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
  }

  /**
   * 垃圾桶只列出最上層的項目：上層資料夾不是在同一時間進垃圾桶的資料夾，
   * 以及所在資料夾不是在同一時間進垃圾桶的檔案（同一批刪除的內容由資料夾代表）
   */
  async listTrash(ownerId: string): Promise<{ files: File[]; folders: Folder[] }> {
    const folders = await this.prisma.folder.findMany({ where: { ownerId }, orderBy: { deletedAt: 'desc' } });
    const byId = new Map(folders.map((f) => [f.id, f]));
    const trashedFolders = folders.filter(
      (f) => f.deletedAt && !(f.parentId && sameTime(byId.get(f.parentId)?.deletedAt ?? null, f.deletedAt)),
    );
    const files = await this.prisma.file.findMany({
      where: { ownerId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
    const trashedFiles = files.filter(
      (f) => !(f.folderId && sameTime(byId.get(f.folderId)?.deletedAt ?? null, f.deletedAt)),
    );
    return { files: trashedFiles, folders: trashedFolders };
  }

  async createFile(ownerId: string, data: { title: string; folderId?: string | null }) {
    await this.assertTargetFolder(ownerId, data.folderId);
    return this.prisma.file.create({
      data: { ownerId, title: data.title, folderId: data.folderId ?? null, type: 'board' },
    });
  }

  async updateFile(ownerId: string, id: string, data: { title?: string; folderId?: string | null; isFavorite?: boolean }) {
    await this.getFile(ownerId, id);
    if (data.folderId !== undefined) await this.assertTargetFolder(ownerId, data.folderId);
    return this.prisma.file.update({ where: { id }, data });
  }

  async trashFile(ownerId: string, id: string, now = new Date()): Promise<void> {
    const f = await this.getFile(ownerId, id, { includeTrashed: true });
    if (f.deletedAt) return;
    await this.prisma.file.update({ where: { id }, data: { deletedAt: now } });
  }

  async purgeFile(ownerId: string, id: string): Promise<void> {
    const f = await this.getFile(ownerId, id, { includeTrashed: true });
    if (!f.deletedAt) throw new ApiException(400, 'not_in_trash');
    await this.prisma.file.delete({ where: { id } });
  }

  /** 還原檔案；所在資料夾仍在垃圾桶（或已不存在）時改放到根目錄 */
  async restoreFile(ownerId: string, id: string): Promise<File> {
    const f = await this.getFile(ownerId, id, { includeTrashed: true });
    if (!f.deletedAt) return f;
    let folderId = f.folderId;
    if (folderId) {
      const folder = await this.prisma.folder.findFirst({ where: { id: folderId, ownerId, deletedAt: null } });
      if (!folder) folderId = null;
    }
    return this.prisma.file.update({ where: { id }, data: { deletedAt: null, folderId } });
  }
}
