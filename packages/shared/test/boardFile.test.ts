import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  BoardFileError,
  boardFileSchema,
  createObjectMap,
  docCanonical,
  docFromBoardObjects,
  getObjects,
  serializeBoardObjects,
  type NewObjectInput,
} from '../src';

function makeDoc(objs: NewObjectInput[]): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const o of objs) getObjects(doc).set(o.id!, createObjectMap(o));
  });
  return doc;
}

const sample = (): Y.Doc =>
  makeDoc([
    { id: 's1', type: 'shape', x: 0, y: 0, w: 100, h: 60, shapeKind: 'rectangle', text: '流程開始', style: { fill: '#fff' } },
    { id: 't1', type: 'text', x: 200, y: 0, w: 100, h: 20, text: 'hello', parentId: 's1' },
    { id: 'c1', type: 'connector', x: 0, y: 0, w: 0, h: 0, from: { id: 's1' }, to: { x: 300, y: 300 }, label: '是' },
    { id: 'i1', type: 'image', x: 0, y: 100, w: 50, h: 50, assetId: 'old-asset', naturalWidth: 10, naturalHeight: 10 },
    { id: 'w1', type: 'wireframe', x: 0, y: 200, w: 120, h: 40, componentKind: 'checkbox', props: { checked: true } },
    {
      id: 'tb',
      type: 'table',
      x: 0,
      y: 300,
      w: 200,
      h: 80,
      columns: [{ id: 'a', w: 100 }],
      rows: [{ id: 'r', h: 40 }],
      cells: { 'r:a': '格子' },
    },
  ]);

describe('白板匯出檔', () => {
  it('序列化後重建，內容完全相同（含富文本、表格、線框圖 props）', () => {
    const doc = sample();
    const json = JSON.parse(JSON.stringify(serializeBoardObjects(doc)));
    const back = docFromBoardObjects(json);
    expect(docCanonical(back)).toBe(docCanonical(doc));
  });

  it('依 id 排序，同樣內容輸出相同', () => {
    expect(serializeBoardObjects(sample()).map((o) => o.id)).toEqual(['c1', 'i1', 's1', 't1', 'tb', 'w1']);
    expect(JSON.stringify(serializeBoardObjects(sample()))).toBe(JSON.stringify(serializeBoardObjects(sample())));
  });

  it('圖片 id 換成匯入後的新 id', () => {
    const back = docFromBoardObjects(serializeBoardObjects(sample()), new Map([['old-asset', 'new-asset']]));
    expect(getObjects(back).get('i1')!.get('assetId')).toBe('new-asset');
  });

  it('id 重複、缺少或類型不明時拒絕', () => {
    const objs = serializeBoardObjects(sample());
    expect(() => docFromBoardObjects([...objs, objs[0]!])).toThrow(BoardFileError);
    expect(() => docFromBoardObjects([{ ...objs[0]!, id: 5 }])).toThrow(BoardFileError);
    expect(() => docFromBoardObjects([{ ...objs[0]!, type: 'sticky' }])).toThrow(BoardFileError);
  });

  it('檔案格式驗證', () => {
    const ok = { format: 'tinycanvas-board', version: 1, title: 'A', objects: [], assets: [] };
    expect(boardFileSchema.safeParse(ok).success).toBe(true);
    expect(boardFileSchema.safeParse({ ...ok, format: 'other' }).success).toBe(false);
    expect(boardFileSchema.safeParse({ ...ok, version: 2 }).success).toBe(false);
    expect(boardFileSchema.safeParse({ ...ok, title: '  ' }).success).toBe(false);
    expect(boardFileSchema.parse({ format: 'tinycanvas-board', version: 1, title: 'A', objects: [] }).assets).toEqual([]);
  });
});
