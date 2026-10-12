import { expect, test } from '@playwright/test';
import { createUserAndLogin, newBoard } from './helpers';

// 側邊欄收合時，「展開側邊欄」按鈕不可遮住畫布名稱，且與名稱、儲存狀態垂直置中對齊
test('側邊欄收合時畫布名稱不被展開按鈕遮住', async ({ page }) => {
  await createUserAndLogin(page, 'collapse');
  await newBoard(page);
  await page.getByRole('button', { name: '收合側邊欄' }).click();
  const expand = (await page.getByRole('button', { name: '展開側邊欄' }).boundingBox())!;
  const title = (await page.getByTitle('重新命名').boundingBox())!;
  expect(title.x).toBeGreaterThanOrEqual(expand.x + expand.width + 4);
  const status = (await page.getByText('已儲存', { exact: true }).boundingBox())!;
  const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
  expect(Math.abs(mid(title) - mid(expand))).toBeLessThanOrEqual(0.5);
  expect(Math.abs(mid(status) - mid(expand))).toBeLessThanOrEqual(1);
});
