import * as Y from 'yjs';
import { z } from 'zod';
import { getObjects, isKnownType, readObject } from './doc';
import { buildObjectMap, serializeObjectMap, type SerializedValue } from './serialize';

/**
 * 單張白板的 JSON 匯出檔（見 docs/DECISIONS.md 2026-10-15「白板匯出與匯入」）。
 * 物件以剪貼簿相同的序列化格式保存 Y 結構（含富文本），圖片以 base64 內嵌，檔案可以獨立還原。
 */
export const BOARD_FILE_FORMAT = 'tinycanvas-board';
export const BOARD_FILE_VERSION = 1;
/** 匯入檔上限：圖片以 base64 內嵌，單張圖片最多 10 MB */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const MAX_IMPORT_OBJECTS = 50_000;

export interface BoardFileAsset {
  id: string;
  mime: string;
  /** base64 */
  data: string;
}

export interface BoardFile {
  format: typeof BOARD_FILE_FORMAT;
  version: typeof BOARD_FILE_VERSION;
  title: string;
  exportedAt: string;
  objects: Record<string, SerializedValue>[];
  assets: BoardFileAsset[];
}

export const boardFileSchema = z.object({
  format: z.literal(BOARD_FILE_FORMAT),
  version: z.literal(BOARD_FILE_VERSION),
  title: z.string().trim().min(1).max(200),
  exportedAt: z.string().optional(),
  objects: z.array(z.record(z.string(), z.unknown())).max(MAX_IMPORT_OBJECTS),
  assets: z
    .array(z.object({ id: z.string().min(1).max(100), mime: z.string().max(100), data: z.string() }))
    .default([]),
});

export class BoardFileError extends Error {}

/** 依 id 排序序列化所有物件（同樣的內容得到同樣的輸出） */
export function serializeBoardObjects(doc: Y.Doc): Record<string, SerializedValue>[] {
  const objs = getObjects(doc);
  return Array.from(objs.keys())
    .sort()
    .map((id) => serializeObjectMap(objs.get(id)!));
}

/**
 * 由匯出檔的物件建立新的 Yjs 文件。assetIds 把匯出檔內的圖片 id 換成匯入後的新 id。
 * 物件 id 重複、類型不明或欄位無法讀取時丟出 BoardFileError
 */
export function docFromBoardObjects(objects: Record<string, unknown>[], assetIds: Map<string, string> = new Map()): Y.Doc {
  const doc = new Y.Doc();
  const map = getObjects(doc);
  const seen = new Set<string>();
  doc.transact(() => {
    for (const raw of objects) {
      const s = raw as Record<string, SerializedValue>;
      const id = s.id;
      if (typeof id !== 'string' || !id || seen.has(id)) throw new BoardFileError('invalid object id');
      if (!isKnownType(s.type)) throw new BoardFileError(`unknown object type: ${String(s.type)}`);
      seen.add(id);
      const fields = typeof s.assetId === 'string' && assetIds.has(s.assetId) ? { ...s, assetId: assetIds.get(s.assetId)! } : s;
      try {
        map.set(id, buildObjectMap(fields));
      } catch {
        throw new BoardFileError(`invalid object: ${id}`);
      }
      if (!readObject(map.get(id)!)) throw new BoardFileError(`invalid object: ${id}`);
    }
  });
  return doc;
}
