import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import * as Y from 'yjs';
import {
  BOARD_FILE_FORMAT,
  BOARD_FILE_VERSION,
  BoardFileError,
  boardFileSchema,
  docFromBoardObjects,
  docFromState,
  extractAssetIds,
  extractSearchText,
  serializeBoardObjects,
  type BoardFile,
  type BoardFileAsset,
} from '@tinycanvas/shared';
import type { File } from '@tinycanvas/db';
import { PrismaService } from '../prisma.service';
import { ApiException, badRequest } from '../common/errors';
import { AssetsService } from '../assets/assets.service';
import { contentHash } from '../versions/versions.service';
import { LibraryService } from './library.service';

const invalidFile = (message?: string) => badRequest('invalid_board_file', message);

/**
 * 單張白板的 JSON 匯出與匯入（見 docs/DECISIONS.md 2026-10-15「白板匯出與匯入」）。
 * 匯出檔內嵌圖片，匯入時建立新檔案與新的圖片，不覆寫既有資料
 */
@Injectable()
export class TransferService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LibraryService) private readonly lib: LibraryService,
    @Inject(AssetsService) private readonly assets: AssetsService,
  ) {}

  async exportBoard(ownerId: string, fileId: string): Promise<BoardFile> {
    const file = await this.lib.getFile(ownerId, fileId);
    const row = await this.prisma.document.findUnique({ where: { fileId }, select: { state: true } });
    const doc = row ? docFromState(row.state) : new Y.Doc();
    const ids = extractAssetIds(doc);
    const rows = ids.length ? await this.prisma.asset.findMany({ where: { id: { in: ids }, ownerId } }) : [];
    const assets: BoardFileAsset[] = [];
    for (const a of rows) {
      const data = await fs.readFile(this.assets.filePath(a.storageKey)).catch(() => null);
      if (data) assets.push({ id: a.id, mime: a.mime, data: data.toString('base64') });
    }
    return {
      format: BOARD_FILE_FORMAT,
      version: BOARD_FILE_VERSION,
      title: file.title,
      exportedAt: new Date().toISOString(),
      objects: serializeBoardObjects(doc),
      assets,
    };
  }

  async importBoard(ownerId: string, buf: Buffer, folderId: string | null): Promise<File> {
    await this.lib.assertTargetFolder(ownerId, folderId);
    let json: unknown;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      throw invalidFile('not json');
    }
    const parsed = boardFileSchema.safeParse(json);
    if (!parsed.success) throw invalidFile(parsed.error.issues[0]?.message);
    const data = parsed.data;

    // 先驗證物件再上傳圖片，檔案有問題時不留下圖片
    try {
      docFromBoardObjects(data.objects);
    } catch (e) {
      if (e instanceof BoardFileError) throw invalidFile(e.message);
      throw e;
    }
    const assetIds = new Map<string, string>();
    for (const a of data.assets) {
      try {
        const created = await this.assets.upload(ownerId, a.mime, Buffer.from(a.data, 'base64'));
        assetIds.set(a.id, created.id);
      } catch (e) {
        // 個別圖片無法匯入時略過（畫布上顯示無法載入），其他內容照常匯入
        if (!(e instanceof ApiException)) throw e;
      }
    }
    const doc = docFromBoardObjects(data.objects, assetIds);
    return this.prisma.file.create({
      data: {
        ownerId,
        folderId,
        type: 'board',
        title: data.title,
        searchText: extractSearchText(doc),
        assetIds: extractAssetIds(doc),
        document: { create: { state: new Uint8Array(Y.encodeStateAsUpdate(doc)), contentHash: contentHash(doc) } },
      },
    });
  }
}
