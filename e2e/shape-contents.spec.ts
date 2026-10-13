import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, MOD, newBoard, waitForEditor } from './helpers';

// 刪除形狀時，形狀內的物件一起刪除（DECISIONS.md 2026-10-13）
test('按 Delete 刪除形狀時一起刪除形狀內的物件，另一個分頁一致', async ({ page, context }) => {
  await createUserAndLogin(page, 'deleteinner');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);
  const ids = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 240, h: 160 }, { atViewportCenter: true });
    const o = ed.doc.getMap('objects').get(a);
    ed.insert({ type: 'icon', iconName: 'Star', x: o.get('x') + 20, y: o.get('y') + 20, w: 32, h: 32 });
    ed.insert({ type: 'shape', shapeKind: 'rectangle', x: o.get('x') + 100, y: o.get('y') + 60, w: 80, h: 50, text: '內部' });
    const out = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: o.get('x') + 400, y: o.get('y'), w: 80, h: 50 });
    ed.select([a]);
    return { a, out };
  });
  await expect.poll(async () => (await boardObjects(other)).length).toBe(4);

  await page.getByTestId('board-canvas').focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await boardObjects(page)).map((o) => o.id)).toEqual([ids.out]);
  await expect.poll(async () => (await boardObjects(other)).map((o) => o.id)).toEqual([ids.out]);

  // 一次復原全部恢復
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(4);
  await expect.poll(async () => (await boardObjects(other)).length).toBe(4);
});
