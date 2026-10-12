import * as Y from 'yjs';
import { getObjects, objectCanonical, type YObject } from './doc';

export interface RestoreDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

/** 比對兩份文件的 objects，算出要把 current 變成 target 需要的差異 */
export function diffDocs(current: Y.Doc, target: Y.Doc): RestoreDiff {
  const cur = getObjects(current);
  const tgt = getObjects(target);
  const diff: RestoreDiff = { added: [], removed: [], changed: [] };
  cur.forEach((_m, id) => {
    if (!tgt.has(id)) diff.removed.push(id);
  });
  tgt.forEach((m, id) => {
    const c = cur.get(id);
    if (!c) diff.added.push(id);
    else if (objectCanonical(c) !== objectCanonical(m)) diff.changed.push(id);
  });
  return diff;
}

/**
 * 版本還原（見 SPEC.md 第 5.5 節）。不可用舊 state 覆蓋 CRDT，而是：
 * 1. 呼叫端把舊版本載入一個暫時的 Y.Doc（target）
 * 2. 比對 objects 算出差異
 * 3. 在 current 上以「一個 transaction」套用差異，origin 由呼叫端傳入（通常是 localOrigin，讓還原可以被復原）
 * 內容不同的物件，直接以舊版本的內容建立新的 Y.Map 放回同一個 key，不逐字比對富文本。
 */
export function restoreFromDoc(current: Y.Doc, target: Y.Doc, origin: unknown): RestoreDiff {
  const diff = diffDocs(current, target);
  const cur = getObjects(current);
  const tgt = getObjects(target);
  current.transact(() => {
    for (const id of diff.removed) cur.delete(id);
    for (const id of [...diff.added, ...diff.changed]) {
      cur.set(id, (tgt.get(id) as YObject).clone());
    }
  }, origin);
  return diff;
}

/** 從 Yjs 完整狀態建立暫時文件 */
export function docFromState(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}
