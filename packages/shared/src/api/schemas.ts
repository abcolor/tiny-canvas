import { z } from 'zod';

// REST API 的請求格式（前後端共用），見 SPEC.md 第 8.3 節

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(200),
});

const uuid = z.string().uuid();

export const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: uuid.nullable().optional(),
  isTabbed: z.boolean().optional(),
});
export const updateFolderSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  parentId: uuid.nullable().optional(),
  isTabbed: z.boolean().optional(),
  sortKey: z.string().min(1).max(100).optional(),
});

export const createFileSchema = z.object({
  title: z.string().trim().min(1).max(200),
  folderId: uuid.nullable().optional(),
});
export const updateFileSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  folderId: uuid.nullable().optional(),
  isFavorite: z.boolean().optional(),
});

export const createVersionSchema = z.object({
  label: z.string().trim().min(1).max(200),
  /**
   * 前端目前的 Yjs 完整狀態（base64）。sync 寫回資料庫有約 1 秒的延遲，
   * 帶上這個欄位可以確保命名版本包含使用者剛剛做的修改；api 會與資料庫中的狀態合併。
   */
  state: z.string().max(16 * 1024 * 1024).optional(),
});
export const copyVersionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export const createShareLinkSchema = z.object({
  password: z.string().min(1).max(200).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export const unlockSchema = z.object({
  password: z.string().max(200),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
});
