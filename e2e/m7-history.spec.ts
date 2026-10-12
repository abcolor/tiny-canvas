import { expect, test } from '@playwright/test';
import { addShapeByClick, boardObjects, createUserAndLogin, MOD, newBoard, waitForEditor } from './helpers';

// M7 驗收：可以預覽並還原舊版本；還原後另一個開啟中的分頁同步更新；還原可用 Mod+Z 復原
test('命名版本、預覽、還原、另一分頁同步、Mod+Z 復原還原', async ({ page, context }) => {
  await createUserAndLogin(page, 'history');
  const fileId = await newBoard(page, '版本測試');
  await addShapeByClick(page, 'r', 300, 260);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(1);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'synced');
  await page.waitForTimeout(1200);

  // 命名目前版本
  await page.getByRole('button', { name: '版本歷史' }).click();
  await page.getByLabel('為目前版本命名').fill('第一版');
  await page.getByRole('button', { name: '儲存' }).click();
  await expect(page.getByRole('complementary').getByText('第一版')).toBeVisible();

  // 之後的修改：再加兩個形狀
  await addShapeByClick(page, 'o', 520, 260);
  await addShapeByClick(page, 'r', 300, 460);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(3);

  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);
  await expect.poll(async () => (await boardObjects(other)).length).toBe(3);

  // 預覽並還原
  await page.getByRole('complementary').getByText('第一版').click();
  await expect(page.getByText('正在預覽：')).toBeVisible();
  await page.getByTestId('restore-version').click();
  await expect(page.getByText('正在預覽：')).toHaveCount(0);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(1);
  await expect.poll(async () => (await boardObjects(other)).length).toBe(1);

  // 還原本身可以用 Mod+Z 復原
  await page.evaluate(() => (window as any).__tcEditor.focus());
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(3);
  await expect.poll(async () => (await boardObjects(other)).length).toBe(3);
});

test('另存成複本', async ({ page }) => {
  await createUserAndLogin(page, 'copy');
  await newBoard(page, '原始畫布');
  await addShapeByClick(page, 'r', 300, 260);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'synced');
  await page.getByRole('button', { name: '版本歷史' }).click();
  await page.getByLabel('為目前版本命名').fill('快照');
  await page.getByRole('button', { name: '儲存' }).click();
  await page.getByRole('complementary').getByText('快照').click();
  await page.getByRole('button', { name: '另存成複本' }).click();
  await expect(page.getByTitle('重新命名')).toHaveText('原始畫布 的副本');
  await waitForEditor(page);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(1);
});
