import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { addShapeByClick, boardObjects, createUserAndLogin, MOD, newBoard, waitForEditor } from './helpers';

function pngSize(buf: Buffer): { w: number; h: number } {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// M5 驗收：未登入的人可以透過連結檢視，但 sync 服務拒絕其寫入；匯出 PNG
test('唯讀分享連結：訪客可檢視、寫入被拒絕、撤銷後失效', async ({ page, browser }) => {
  await createUserAndLogin(page, 'share');
  const fileId = await newBoard(page, '分享的畫布');
  await addShapeByClick(page, 'r', 300, 260);
  await page.keyboard.press('Enter');
  await page.keyboard.type('公開內容');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'synced');

  // 透過介面建立有密碼的分享連結
  await page.getByRole('button', { name: '分享', exact: true }).click();
  await page.getByLabel('密碼（選填）').fill('s3cret');
  await page.getByRole('button', { name: '建立分享連結' }).click();
  await expect(page.getByRole('button', { name: '複製連結' })).toBeVisible();
  const links = await page.evaluate(async (id) => (await fetch(`/api/files/${id}/share-links`)).json(), fileId);
  const token = links[0].token as string;
  await page.keyboard.press('Escape');

  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(`/s/${token}`);
  await expect(guest.getByText('這個分享連結需要密碼')).toBeVisible();
  await guest.getByLabel('密碼').fill('wrong');
  await guest.getByRole('button', { name: '檢視' }).click();
  await expect(guest.getByRole('alert')).toHaveText('密碼不正確');
  await guest.getByLabel('密碼').fill('s3cret');
  await guest.getByRole('button', { name: '檢視' }).click();
  await expect(guest.getByText('唯讀檢視')).toBeVisible();
  await guest.waitForFunction(() => Boolean((window as any).__tcEditor));
  await expect.poll(async () => JSON.stringify(await boardObjects(guest))).toContain('公開內容');

  // 介面上沒有編輯工具
  await expect(guest.getByRole('toolbar', { name: undefined }).getByRole('button', { name: '形狀', exact: true })).toHaveCount(0);

  // 繞過介面直接修改 Y.Doc：伺服器必須拒絕，擁有者看不到
  await guest.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const objs = ed.doc.getMap('objects');
    const first = objs.get([...objs.keys()][0]);
    first.set('x', 9999);
  });
  await page.waitForTimeout(2000);
  const ownerObjs = await boardObjects(page);
  expect(ownerObjs[0].x).not.toBe(9999);
  await page.reload();
  await waitForEditor(page);
  expect((await boardObjects(page))[0].x).not.toBe(9999);

  // 撤銷後連結失效
  await page.getByRole('button', { name: '分享', exact: true }).click();
  await page.getByRole('button', { name: '撤銷' }).click();
  await expect(page.getByText('已撤銷')).toBeVisible();
  const again = await guestCtx.newPage();
  await again.goto(`/s/${token}`);
  await expect(again.getByText('分享連結無效、已撤銷或已過期')).toBeVisible();
  await guestCtx.close();
});

test('匯出 PNG：整張畫布、2x、白色背景', async ({ page }) => {
  await createUserAndLogin(page, 'export');
  await newBoard(page, '匯出測試');
  await addShapeByClick(page, 'r', 300, 260);
  await addShapeByClick(page, 'o', 600, 360);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(2);

  await page.keyboard.press(`${MOD}+Shift+E`);
  await expect(page.getByRole('dialog', { name: '匯出 PNG' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('匯出測試.png');
  const buf = fs.readFileSync((await download.path())!);
  const { w, h } = pngSize(buf);

  // 尺寸應等於內容範圍加上內距後乘以 2
  const bounds = await page.evaluate(() => (window as any).__tcEditor.getContentBounds());
  expect(w).toBe(Math.ceil((bounds.w + 48) * 2));
  expect(h).toBe(Math.ceil((bounds.h + 48) * 2));
});
