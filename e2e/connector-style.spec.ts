import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, newBoard, waitForEditor } from './helpers';

// 連線工具列上的實線 / 虛線按鈕；顏色選單只保留顏色與粗細
test('連線的實線 / 虛線切換，另一個分頁一致', async ({ page, context }) => {
  await createUserAndLogin(page, 'linestyle');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);

  const id = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 100, h: 60 }, { atViewportCenter: true });
    const r = ed.getObjectScreenRect(a);
    const w = ed.screenToWorld({ x: r.x, y: r.y });
    const b = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: w.x + 240, y: w.y, w: 100, h: 60 });
    const c = ed.insert({ type: 'connector', x: 0, y: 0, w: 1, h: 1, routing: 'straight', from: { objectId: a, anchor: 'right' }, to: { objectId: b, anchor: 'left' } });
    ed.select([c]);
    return c as string;
  });
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  const group = bar.getByRole('radiogroup', { name: '線條樣式' });

  await expect(group.getByRole('radio', { name: '實線' })).toHaveAttribute('aria-checked', 'true');
  await group.getByRole('radio', { name: '虛線' }).click();
  await expect(group.getByRole('radio', { name: '虛線' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await boardObjects(page)).find((o) => o.id === id)?.dashed).toBe(true);
  await expect.poll(async () => (await boardObjects(other)).find((o) => o.id === id)?.dashed).toBe(true);

  await group.getByRole('radio', { name: '實線' }).click();
  await expect.poll(async () => (await boardObjects(other)).find((o) => o.id === id)?.dashed).toBe(false);

  // 顏色選單不再放線條樣式
  await bar.getByRole('button', { name: '邊框', exact: true }).click();
  await expect(page.getByRole('listbox', { name: '邊框' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '點線' })).toHaveCount(0);
});
