// REST API 的回應格式（前後端共用）

export interface MeResponse {
  user: { id: string; email: string; name: string };
  csrfToken: string;
}
export interface AuthConfigResponse {
  allowSignup: boolean;
}

export interface FolderDto {
  id: string;
  parentId: string | null;
  name: string;
  isTabbed: boolean;
  sortKey: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface FileDto {
  id: string;
  folderId: string | null;
  type: 'board';
  title: string;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** 首頁卡片縮圖的產生時間；沒有縮圖時為 null。讀取網址帶上此值，可長期快取 */
  thumbnailAt: string | null;
}

export interface SearchResultDto {
  file: FileDto;
  /** 內容命中時，命中位置附近的文字片段 */
  snippet: string | null;
  score: number;
}

export interface VersionDto {
  id: string;
  label: string | null;
  createdAt: string;
  size: number;
}
export interface VersionListResponse {
  versions: VersionDto[];
  /** 下一頁的游標；沒有更多時為 null（增量載入） */
  nextCursor: string | null;
}

export interface ShareLinkDto {
  id: string;
  token: string;
  hasPassword: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface SharedInfoResponse {
  fileId: string;
  title: string;
  requiresPassword: boolean;
  /** 無密碼時直接附上檢視 token */
  viewToken: string | null;
}
export interface UnlockResponse {
  viewToken: string;
}

export interface AssetDto {
  id: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface ApiError {
  error: string;
  message?: string;
}

/** GET /api/files?trash=true：垃圾桶內最上層的項目 */
export interface TrashResponse {
  files: FileDto[];
  folders: FolderDto[];
}
