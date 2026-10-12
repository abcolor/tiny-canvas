import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import * as Y from 'yjs';
import {
  docCanonical,
  docFromState,
  extractAssetIds,
  extractSearchText,
  type VersionDto,
  type VersionListResponse,
} from '@tinycanvas/shared';
import type { File } from '@tinycanvas/db';
import { PrismaService } from '../prisma.service';
import { badRequest, notFound } from '../common/errors';
import { LibraryService } from '../files/library.service';

export const VERSION_PAGE_SIZE = 30;
const TITLE_MAX = 200;

export const contentHash = (doc: Y.Doc) => createHash('sha256').update(docCanonical(doc)).digest('hex');

interface Cursor {
  t: string;
  id: string;
}
const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(s: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (typeof c?.t === 'string' && typeof c?.id === 'string' && !Number.isNaN(Date.parse(c.t))) return c;
  } catch {
    // 交給下方統一處理
  }
  throw badRequest('invalid_cursor');
}

interface VersionRow {
  id: string;
  label: string | null;
  created_at: Date;
  size: number;
}

/** 版本歷史（見 SPEC.md 第 5.5 節）。doc_versions.state 為 gzip 壓縮的 Yjs 完整狀態 */
@Injectable()
export class VersionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LibraryService) private readonly lib: LibraryService,
  ) {}

  /** 由新到舊、以游標分頁（增量載入）；size 為壓縮後的位元組數 */
  async list(ownerId: string, fileId: string, cursor?: string): Promise<VersionListResponse> {
    await this.lib.getFile(ownerId, fileId);
    const c = cursor ? decodeCursor(cursor) : null;
    const rows = c
      ? await this.prisma.$queryRaw<VersionRow[]>`
          SELECT id, label, created_at, octet_length(state)::int AS size FROM doc_versions
          WHERE file_id = ${fileId}::uuid AND (created_at, id) < (${new Date(c.t)}::timestamptz, ${c.id}::uuid)
          ORDER BY created_at DESC, id DESC LIMIT ${VERSION_PAGE_SIZE + 1}`
      : await this.prisma.$queryRaw<VersionRow[]>`
          SELECT id, label, created_at, octet_length(state)::int AS size FROM doc_versions
          WHERE file_id = ${fileId}::uuid
          ORDER BY created_at DESC, id DESC LIMIT ${VERSION_PAGE_SIZE + 1}`;
    const page = rows.slice(0, VERSION_PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      versions: page.map(toVersionDto),
      nextCursor:
        rows.length > VERSION_PAGE_SIZE && last ? encodeCursor({ t: last.created_at.toISOString(), id: last.id }) : null,
    };
  }

  /** 以目前文件建立命名版本；尚無 documents 資料列時使用空白文件 */
  async createNamed(ownerId: string, fileId: string, label: string, clientState?: string): Promise<VersionDto> {
    const file = await this.lib.getFile(ownerId, fileId);
    const document = await this.prisma.document.findUnique({ where: { fileId } });
    let state: Uint8Array;
    let hash: string;
    let assetIds = file.assetIds;
    if (clientState) {
      // 合併前端送來的狀態（CRDT 合併，不會遺失任一方的內容）
      const updates: Uint8Array[] = [Buffer.from(clientState, 'base64')];
      if (document) updates.unshift(document.state);
      let doc: Y.Doc;
      try {
        state = Y.mergeUpdates(updates);
        doc = docFromState(state);
      } catch {
        throw badRequest('invalid_state');
      }
      hash = contentHash(doc);
      assetIds = extractAssetIds(doc);
    } else if (document) {
      state = document.state;
      hash = document.contentHash;
    } else {
      const empty = new Y.Doc();
      state = Y.encodeStateAsUpdate(empty);
      hash = contentHash(empty);
    }
    const compressed = gzipSync(state);
    const v = await this.prisma.docVersion.create({
      data: { fileId, state: compressed, contentHash: hash, assetIds, label },
    });
    return { id: v.id, label: v.label, createdAt: v.createdAt.toISOString(), size: compressed.byteLength };
  }

  /** 解壓後的 Yjs 完整狀態 */
  async getState(ownerId: string, fileId: string, versionId: string): Promise<Buffer> {
    await this.lib.getFile(ownerId, fileId);
    const v = await this.prisma.docVersion.findFirst({ where: { id: versionId, fileId } });
    if (!v) throw notFound();
    return gunzipSync(v.state);
  }

  /** 把某個版本另存成同一資料夾內的新檔案 */
  async copy(ownerId: string, fileId: string, versionId: string, title?: string): Promise<File> {
    const source = await this.lib.getFile(ownerId, fileId);
    const state = await this.getState(ownerId, fileId, versionId);
    const doc = docFromState(state);
    const newTitle = (title ?? `${source.title} 的副本`).slice(0, TITLE_MAX);
    return this.prisma.file.create({
      data: {
        ownerId,
        folderId: source.folderId,
        type: source.type,
        title: newTitle,
        searchText: extractSearchText(doc),
        assetIds: extractAssetIds(doc),
        document: { create: { state: new Uint8Array(state), contentHash: contentHash(doc) } },
      },
    });
  }
}

function toVersionDto(r: VersionRow): VersionDto {
  return { id: r.id, label: r.label, createdAt: r.created_at.toISOString(), size: Number(r.size) };
}
