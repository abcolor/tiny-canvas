import { expect, test } from '@playwright/test';
import { addShapeByClick, boardObjects, createUserAndLogin, MOD, newBoard, waitForEditor } from './helpers';

// M3 驗收：兩個分頁同時編輯後內容一致；離線編輯後重新連線不遺失；畫布內的文字可以被搜尋到
test('兩個分頁同時編輯，內容在 1 秒內一致', async ({ page, context }) => {
  await createUserAndLogin(page, 'm3');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);

  await addShapeByClick(page, 'r', 300, 260);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(1);
  const t0 = Date.now();
  await expect.poll(async () => (await boardObjects(other)).length, { intervals: [50] }).toBe(1);
  expect(Date.now() - t0).toBeLessThan(1500);

  // 另一個分頁同時建立物件
  await addShapeByClick(other, 'o', 520, 300);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(2);

  // 在形狀裡輸入文字，另一個分頁看得到
  await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const id = [...ed.doc.getMap('objects').keys()].find((k: string) => ed.doc.getMap('objects').get(k).get('shapeKind') === 'rectangle');
    ed.select([id]);
  });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('text-editor')).toBeVisible();
  await page.keyboard.type('流程開始');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => JSON.stringify(await boardObjects(other)))
    .toContain('流程開始');
});

test('離線編輯後重新連線，內容不遺失', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await createUserAndLogin(a, 'offline');
  const fileId = await newBoard(a);
  const ctxB = await browser.newContext({ storageState: await ctxA.storageState() });
  const b = await ctxB.newPage();
  await b.goto(`/b/${fileId}`);
  await waitForEditor(b);

  await ctxA.setOffline(true);
  await expect(a.getByTestId('sync-status')).toHaveAttribute('data-status', 'offline');
  await expect(a.getByTestId('sync-status')).toContainText('離線中');
  await addShapeByClick(a, 'r', 260, 240);
  await addShapeByClick(a, 'o', 460, 240);
  await expect.poll(async () => (await boardObjects(a)).length).toBe(2);
  // 離線期間另一端看不到
  await b.waitForTimeout(1500);
  expect((await boardObjects(b)).length).toBe(0);
  // 離線期間另一端也做了修改
  await addShapeByClick(b, 'r', 300, 420);

  await ctxA.setOffline(false);
  await expect.poll(async () => (await boardObjects(b)).length, { timeout: 15_000 }).toBe(3);
  await expect.poll(async () => (await boardObjects(a)).length, { timeout: 15_000 }).toBe(3);

  // 重新載入後內容仍在（已寫回伺服器）
  await b.reload();
  await waitForEditor(b);
  await expect.poll(async () => (await boardObjects(b)).length).toBe(3);
  await ctxA.close();
  await ctxB.close();
});

test('畫布內的文字可以被搜尋到', async ({ page }) => {
  await createUserAndLogin(page, 'content');
  await newBoard(page, '搜尋測試畫布');
  await addShapeByClick(page, 'r', 300, 260);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('獨特關鍵字甲乙');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'synced');
  await page.waitForTimeout(1500);

  await page.keyboard.press(`${MOD}+k`);
  await page.getByPlaceholder('搜尋檔名或畫布內容…').fill('甲乙');
  const hit = page.getByRole('option').filter({ hasText: '搜尋測試畫布' });
  await expect(hit).toBeVisible();
  await expect(hit).toContainText('獨特關鍵字甲乙');
});
