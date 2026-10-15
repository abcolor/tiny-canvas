import type { SerializedValue } from '@tinycanvas/shared';

/** 自訂剪貼簿 MIME。跨畫布貼上時以它保留樣式（見 SPEC.md 第 3.2 節） */
export const CLIPBOARD_MIME = 'web application/x-tinycanvas+json';
export const CLIPBOARD_MARKER = 'tinycanvas/v1';

// 序列化程式移到 @tinycanvas/shared，與白板匯出入共用
export {
  serializeValue,
  deserializeValue,
  serializeObjectMap,
  buildObjectMap,
  type SerializedValue,
  type SerializedXml,
} from '@tinycanvas/shared';

export interface ClipboardPayload {
  kind: typeof CLIPBOARD_MARKER;
  /** 複製來源的檔案（用於判斷是否同一張畫布） */
  sourceDoc?: string;
  /** 每個物件 Y.Map 的序列化內容（含 id、parentId 等欄位） */
  objects: Record<string, SerializedValue>[];
  /** 複製時選取範圍的外接框（貼上定位用） */
  bounds: { x: number; y: number; w: number; h: number };
  /** 一起帶上的形狀內物件（carriedUnits）；貼上後不選取它們的複本 */
  carried?: string[];
}

export function parsePayload(data: string): ClipboardPayload | null {
  try {
    const p = JSON.parse(data);
    if (p && p.kind === CLIPBOARD_MARKER && Array.isArray(p.objects)) return p as ClipboardPayload;
  } catch {
    /* 不是我們的格式 */
  }
  return null;
}
