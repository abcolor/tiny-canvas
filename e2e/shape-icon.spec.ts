import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, newBoard, waitForEditor } from './helpers';

// 形狀內嵌圖示的位置（上、下、左、右）：工具列選擇，另一個分頁一致
test('選擇形狀內圖示的位置', async ({ page, context }) => {
  await createUserAndLogin(page, 'shapeicon');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);

  const id = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 160, h: 80, text: '資料庫' }, { atViewportCenter: true });
    ed.select([a]);
    return a as string;
  });
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  // 沒有圖示時不顯示位置按鈕
  await expect(bar.getByRole('button', { name: '圖示位置' })).toHaveCount(0);

  await bar.getByRole('button', { name: '圖示', exact: true }).click();
  await page.getByRole('button', { name: 'Database', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await boardObjects(page)).find((o) => o.id === id)!.icon).toBe('Database');

  await bar.getByRole('button', { name: '圖示位置' }).click();
  await expect(page.getByRole('radio', { name: '圖示在文字上方' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: '圖示在文字左側' }).click();
  await expect.poll(async () => (await boardObjects(other)).find((o) => o.id === id)?.iconPosition).toBe('left');
});
