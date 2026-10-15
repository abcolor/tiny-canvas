import { expect, test, type Page } from '@playwright/test';
import { addShapeByClick, boardObjects, createUserAndLogin, newBoard, waitForEditor } from './helpers';

// 首頁卡片縮圖（見 docs/DECISIONS.md 2026-10-15）
const card = (page: Page, fileId: string) => page.locator('li', { has: page.locator(`[data-testid="file-thumbnail"][src*="${fileId}"]`) });
const thumbLoaded = async (page: Page, fileId: string) => {
  const img = page.locator(`[data-testid="file-thumbnail"][src*="${fileId}"]`);
  if ((await img.count()) === 0) return false;
  return img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0);
};

test('編輯後回到首頁，卡片顯示畫布縮圖；清空畫布後恢復圖示', async ({ page }) => {
  await createUserAndLogin(page, 'thumb');
  const fileId = await newBoard(page, '縮圖測試');
  await addShapeByClick(page, 'r', 300, 260);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(1);

  // 不等 2 秒的延遲，立即從側邊欄回到首頁：離開畫布時就要畫出縮圖
  await page.getByRole('link', { name: '最近檔案' }).click();
  await expect.poll(() => thumbLoaded(page, fileId)).toBe(true);
  const first = await card(page, fileId).getByTestId('file-thumbnail').getAttribute('src');

  // 清空畫布：縮圖刪除，卡片恢復成圖示
  await card(page, fileId).locator('button').first().click();
  await waitForEditor(page);
  await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    ed.selectAll();
  });
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await boardObjects(page)).length).toBe(0);
  await page.getByRole('link', { name: '最近檔案' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: '縮圖測試' })).toBeVisible();
  await expect(page.getByTestId('file-thumbnail')).toHaveCount(0, { timeout: 5000 });
  expect(first).toContain(fileId);
});

test('另一個分頁的編輯也會更新首頁縮圖', async ({ page, context }) => {
  await createUserAndLogin(page, 'thumb2');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);

  // 第二個分頁編輯；停止 2 秒後上傳縮圖
  await addShapeByClick(other, 'o', 400, 300);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(1);
  await other.waitForTimeout(3000);

  // 這個分頁沒有編輯，不會上傳；重新開啟首頁，看到的是另一個分頁產生的縮圖
  await page.goto('/');
  await expect.poll(() => thumbLoaded(page, fileId), { timeout: 10_000 }).toBe(true);
  const before = await card(page, fileId).getByTestId('file-thumbnail').getAttribute('src');

  // 再改一次：縮圖網址（帶產生時間）改變
  await addShapeByClick(other, 'r', 200, 200);
  await other.waitForTimeout(3000);
  await page.reload();
  await expect.poll(() => thumbLoaded(page, fileId), { timeout: 10_000 }).toBe(true);
  const after = await card(page, fileId).getByTestId('file-thumbnail').getAttribute('src');
  expect(after).not.toBe(before);
});
