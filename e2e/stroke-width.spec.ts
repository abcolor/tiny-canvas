import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, newBoard, waitForEditor } from './helpers';

// 邊框 / 線條粗細是工具列上的獨立按鈕，不在顏色選單裡（DECISIONS.md 2026-10-13）
test('工具列的粗細按鈕：形狀、連線、圖示，另一個分頁一致', async ({ page, context }) => {
  await createUserAndLogin(page, 'strokewidth');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);

  const ids = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 100, h: 60 }, { atViewportCenter: true });
    const r = ed.getObjectScreenRect(a);
    const w = ed.screenToWorld({ x: r.x, y: r.y });
    const b = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: w.x + 240, y: w.y, w: 100, h: 60 });
    const c = ed.insert({ type: 'connector', x: 0, y: 0, w: 1, h: 1, routing: 'straight', from: { objectId: a, anchor: 'right' }, to: { objectId: b, anchor: 'left' } });
    const i = ed.insert({ type: 'icon', iconName: 'Star', x: w.x, y: w.y + 160, w: 32, h: 32 });
    ed.select([a]);
    return { a, c, i };
  });
  const width = async (p: typeof page, id: string) => (await boardObjects(p)).find((o) => o.id === id)?.style?.strokeWidth;
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });

  // 形狀：顏色選單裡沒有粗細
  await bar.getByRole('button', { name: '顏色', exact: true }).click();
  await expect(page.getByRole('listbox', { name: '顏色' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '3', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await bar.getByRole('button', { name: '邊框粗細' }).click();
  await page.getByRole('menuitem', { name: '4', exact: true }).click();
  await expect.poll(() => width(page, ids.a)).toBe(4);
  await expect.poll(() => width(other, ids.a)).toBe(4);

  // 連線
  await page.evaluate((id) => (window as any).__tcEditor.select([id]), ids.c);
  await bar.getByRole('button', { name: '邊框粗細' }).click();
  await page.getByRole('menuitem', { name: '3', exact: true }).click();
  await expect.poll(() => width(other, ids.c)).toBe(3);

  // 圖示：線條粗細
  await page.evaluate((id) => (window as any).__tcEditor.select([id]), ids.i);
  await bar.getByRole('button', { name: '線條粗細' }).click();
  await page.getByRole('menuitem', { name: '2.5', exact: true }).click();
  await expect.poll(() => width(other, ids.i)).toBe(2.5);
});
