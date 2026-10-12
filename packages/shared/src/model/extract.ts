import * as Y from 'yjs';
import { getObjects } from './doc';
import { fragmentToPlain } from './richtext';

/**
 * 從畫布抽出所有可搜尋的純文字（形狀與文字物件、區塊標題、連線標籤、表格儲存格、線框圖文字）。
 * sync 服務寫回文件時用它更新 files.search_text（見 SPEC.md 第 8.1 節）。
 */
export function extractSearchText(doc: Y.Doc): string {
  const parts: string[] = [];
  getObjects(doc).forEach((m) => {
    const text = m.get('text');
    if (text instanceof Y.XmlFragment) parts.push(fragmentToPlain(text));
    for (const key of ['title', 'label', 'targetTitle']) {
      const v = m.get(key);
      if (typeof v === 'string' && v) parts.push(v);
    }
    const cells = m.get('cells');
    if (cells instanceof Y.Map) {
      cells.forEach((f) => {
        if (f instanceof Y.XmlFragment) parts.push(fragmentToPlain(f));
      });
    }
  });
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 抽出所有 image 物件引用的 assetId（去重），用於 files.asset_ids 與 doc_versions.asset_ids */
export function extractAssetIds(doc: Y.Doc): string[] {
  const ids = new Set<string>();
  getObjects(doc).forEach((m) => {
    if (m.get('type') !== 'image') return;
    const id = m.get('assetId');
    if (typeof id === 'string' && UUID_RE.test(id)) ids.add(id.toLowerCase());
  });
  return Array.from(ids).sort();
}
