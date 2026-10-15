import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { addShapeByClick, boardObjects, createUserAndLogin, newBoard, waitForEditor } from './helpers';

// 白板匯出與匯入（見 docs/DECISIONS.md 2026-10-15「白板匯出與匯入」）
test('從卡片選單匯出 JSON，再匯入成新畫布；兩個分頁內容一致', async ({ page, context }) => {
  await createUserAndLogin(page, 'transfer');
  const sourceId = await newBoard(page, '備份來源');
  await addShapeByClick(page, 'r', 300, 260);
  await page.keyboard.press('Enter');
  await page.keyboard.type('重要流程');
  await page.keyboard.press('Escape');
  await addShapeByClick(page, 'o', 520, 300);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(2);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'synced');
  await page.waitForTimeout(1200);

  await page.getByRole('link', { name: '最近檔案' }).click();
  const card = page.getByRole('listitem').filter({ hasText: '備份來源' });
  await card.getByRole('button', { name: '更多' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: '匯出' }).click()]);
  expect(download.suggestedFilename()).toBe('備份來源.tinycanvas.json');
  const file = await download.path();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(data).toMatchObject({ format: 'tinycanvas-board', version: 1, title: '備份來源' });
  expect(data.objects).toHaveLength(2);

  // 匯入：出現第二張同名卡片
  await page.getByTestId('import-input').setInputFiles(file);
  await expect(page.getByText('已匯入「備份來源」')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: '備份來源' })).toHaveCount(2);

  // 匯入的畫布（不是原本那張）同時在兩個分頁開啟：內容相同，編輯後彼此同步
  const hrefs = await page.locator('a[href^="/b/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  const importedHref = [...new Set(hrefs)].find((h) => !h.endsWith(sourceId))!;
  expect(importedHref).toBeTruthy();
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  for (const tab of [tabA, tabB]) {
    await tab.goto(importedHref);
    await waitForEditor(tab);
    await expect.poll(async () => (await boardObjects(tab)).length).toBe(2);
    expect(JSON.stringify(await boardObjects(tab))).toContain('重要流程');
  }
  await addShapeByClick(tabA, 'r', 300, 450);
  await expect.poll(async () => (await boardObjects(tabB)).length).toBe(3);
  await tabA.close();
  await tabB.close();

  // 不是畫布檔案時提示錯誤，不建立檔案
  await page.getByTestId('import-input').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await expect(page.getByText('這不是 TinyCanvas 的畫布檔案')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: '備份來源' })).toHaveCount(2);
});
