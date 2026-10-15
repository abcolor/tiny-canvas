export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const GRID_SIZE = 8;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] as const;
/** 首頁卡片縮圖（見 docs/DECISIONS.md 2026-10-15）：前端繪製，WebP 為主，瀏覽器不支援時用 PNG */
export const THUMBNAIL_MIME_TYPES = ['image/webp', 'image/png'] as const;
export const MAX_THUMBNAIL_BYTES = 512 * 1024;

export const TRASH_RETENTION_DAYS = 30;
/** 自動快照的最小間隔（見 SPEC.md 第 5.5 節） */
export const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;
/** 檢視 token 有效期（見 SPEC.md 第 5.3 節） */
export const VIEW_TOKEN_TTL_SECONDS = 2 * 60 * 60;
export const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE = 'tc_session';
export const CSRF_HEADER = 'x-csrf-token';
export const LOGIN_RATE_LIMIT_PER_MINUTE = 10;
export const MAX_EXPORT_PIXELS = 8192;

/** 前端與 sync 之間，以 Session Cookie 驗證時送出的固定 token 值 */
export const SESSION_AUTH_TOKEN = 'session';
/** sync 因檔案進垃圾桶而關閉連線時使用的 close code / reason */
export const CLOSE_FILE_TRASHED = { code: 4404, reason: 'file-trashed' } as const;

/**
 * 文字大小（由大到小，見 SPEC.md 第 4.3 節）。樣式仍存數值（style.fontSize），
 * 介面以名稱顯示；不在表中的數值顯示最接近的名稱。預設 14 = S
 */
export const FONT_SIZE_SCALE: readonly { label: string; size: number }[] = [
  { label: '8XL', size: 128 },
  { label: '7XL', size: 96 },
  { label: '6XL', size: 80 },
  { label: '5XL', size: 64 },
  { label: '4XL', size: 48 },
  { label: '3XL', size: 40 },
  { label: 'XXL', size: 32 },
  { label: 'XL', size: 24 },
  { label: 'L', size: 20 },
  { label: 'M', size: 16 },
  { label: 'S', size: 14 },
  { label: 'XS', size: 12 },
];

/** 最接近 size 的字級在 FONT_SIZE_SCALE 中的索引 */
export function fontSizeIndex(size: number): number {
  let best = 0;
  FONT_SIZE_SCALE.forEach((s, i) => {
    if (Math.abs(s.size - size) < Math.abs(FONT_SIZE_SCALE[best].size - size)) best = i;
  });
  return best;
}

/** 富文本樣式（畫布繪製與編輯器 CSS 必須一致） */
export const RICH_TEXT_STYLE = {
  monoFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "Noto Sans TC Variable", monospace',
  /** 標題相對於物件字級的倍率 */
  headingScale: { 1: 1.6, 2: 1.35, 3: 1.15 } as Record<number, number>,
  inlineCodeBg: '#eef1f4',
  codeBlockBg: '#f3f5f7',
  highlight: '#fde68a',
  checkboxBorder: '#798897',
  checkboxChecked: '#0087dc',
} as const;
