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

// 形狀的圖示選擇器與圖示庫使用相同的搜尋：全部 Lucide 圖示、中文關鍵字與官方標籤（DECISIONS.md 2026-10-13）
test('形狀的圖示選擇器可以用標籤搜尋全部圖示', async ({ page, context }) => {
  await createUserAndLogin(page, 'shapeiconsearch');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);
  const id = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 160, h: 80 }, { atViewportCenter: true });
    ed.select([a]);
    return a as string;
  });
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  await bar.getByRole('button', { name: '圖示', exact: true }).click();
  const search = page.getByRole('textbox', { name: /搜尋圖示/ });

  // 「robot」是 Bot 的 Lucide 標籤，不是名稱
  await search.fill('robot');
  await expect(page.getByRole('button', { name: 'Bot', exact: true })).toBeVisible();

  // 不在常用清單內的圖示也找得到、可以放進形狀
  await search.fill('rabbit');
  await page.getByRole('button', { name: 'Rabbit', exact: true }).click();
  await expect.poll(async () => (await boardObjects(page)).find((o) => o.id === id)!.icon).toBe('Rabbit');
  await expect.poll(async () => (await boardObjects(other)).find((o) => o.id === id)?.icon).toBe('Rabbit');

  // 沒有結果時顯示提示
  await search.fill('zzzzqqqq');
  await expect(page.getByText('找不到符合的圖示')).toBeVisible();
});
