import * as Y from 'yjs';
import { createObjectMap, getObjects, readObject, type FrameKind, type NewObjectInput } from '@tinycanvas/shared';
import { frameInsets } from '../src/frames';
import { EditorModel } from '../src/model';
import type { Measurer } from '../src/text/layout';
import { isCJK } from '../src/text/layout';

/** 測試用量測：CJK 為 1em，其餘字元 0.5em（字級取自 font 字串） */
export const mockMeasurer: Measurer = {
  measure(text: string, font: string) {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 14);
    let w = 0;
    for (const ch of text) w += isCJK(ch.codePointAt(0)!) ? size : size * 0.5;
    return w;
  },
};

export function makeDoc(objs: NewObjectInput[] = []): Y.Doc {
  const doc = new Y.Doc();
  const m = getObjects(doc);
  doc.transact(() => {
    for (const o of objs) m.set(o.id!, createObjectMap(o));
  });
  return doc;
}

export function makeModel(objs: NewObjectInput[] = [], opts: { measurer?: Measurer; extraTrackedOrigins?: unknown[] } = {}) {
  const doc = makeDoc(objs);
  const model = new EditorModel({ doc, measurer: opts.measurer ?? null, extraTrackedOrigins: opts.extraTrackedOrigins });
  return { doc, model };
}

export const rect = (id: string, x: number, y: number, extra: Partial<NewObjectInput> = {}): NewObjectInput => ({
  type: 'shape',
  id,
  x,
  y,
  w: 100,
  h: 60,
  shapeKind: 'rectangle',
  ...extra,
});

let frameKind: FrameKind | null = null;
/** 讓 section() 產生裝置框（測試同一套區塊規則） */
export function setSectionFrameKind(k: FrameKind | null) {
  frameKind = k;
}

/**
 * 建立區塊。給的 x/y/w/h 是「內容區」（拖入判定的範圍）；
 * 裝置框會依外框與介面列往外擴，讓同一組規則測試對一般區塊與裝置框都成立。
 */
export const section = (id: string, x: number, y: number, w: number, h: number, extra: Partial<NewObjectInput> = {}): NewObjectInput => {
  const i = frameInsets(frameKind);
  return {
    type: 'section',
    id,
    x: x - i.left,
    y: y - i.top,
    w: w + i.left + i.right,
    h: h + i.top + i.bottom,
    title: 'S',
    frameKind,
    ...extra,
  };
};

export function raw(doc: Y.Doc, id: string) {
  const m = getObjects(doc).get(id);
  return m ? readObject(m) : null;
}

/** 計算 doc 產生的 transaction 數量（依 origin） */
export function countTransactions(doc: Y.Doc) {
  const list: unknown[] = [];
  const h = (tr: Y.Transaction) => {
    if (tr.changed.size > 0) list.push(tr.origin);
  };
  doc.on('afterTransaction', h);
  return { list, stop: () => doc.off('afterTransaction', h) };
}
