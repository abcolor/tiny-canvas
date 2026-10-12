import { expect, test } from '@playwright/test';
import { cli, createUserAndLogin, login, PASSWORD, uniqueEmail } from './helpers';

// M1 驗收：用 CLI 建立帳號 → 登入 → 建立資料夾與檔案 → 刪除後從垃圾桶還原；排程以測試時鐘驗證
test('CLI 建帳號、登入、資料夾與檔案、垃圾桶還原', async ({ page }) => {
  await createUserAndLogin(page, 'm1');

  // 建立資料夾
  await page.getByRole('button', { name: '新增資料夾' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('專案資料夾');
  await dialog.getByRole('button', { name: '建立' }).click();
  await expect(page.getByRole('navigation').getByRole('button', { name: '專案資料夾' })).toBeVisible();

  // 在資料夾內建立畫布
  await page.getByRole('navigation').getByRole('button', { name: '專案資料夾' }).hover();
  await page.getByRole('navigation').getByRole('treeitem').filter({ hasText: '專案資料夾' }).getByRole('button', { name: '更多' }).first().click();
  await page.getByRole('menuitem', { name: '新增畫布' }).click();
  await expect(page).toHaveURL(/\/b\//);

  // 改名
  await page.getByTitle('重新命名').click();
  await page.getByRole('dialog').getByRole('textbox').fill('流程圖草稿');
  await page.getByRole('dialog').getByRole('button', { name: '儲存' }).click();
  await expect(page.getByTitle('重新命名')).toHaveText('流程圖草稿');

  // 刪除資料夾（連同檔案進垃圾桶）
  const folderRow = page.getByRole('navigation').getByRole('treeitem').filter({ hasText: '專案資料夾' }).first();
  await folderRow.getByRole('button', { name: '更多' }).first().click();
  await page.getByRole('menuitem', { name: '移到垃圾桶' }).click();
  await expect(page.getByRole('navigation').getByRole('button', { name: '專案資料夾' })).toHaveCount(0);

  // 從垃圾桶還原
  await page.getByRole('link', { name: '垃圾桶' }).click();
  const item = page.getByRole('listitem').filter({ hasText: '專案資料夾' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: '還原' }).click();
  await expect(page.getByRole('navigation').getByRole('button', { name: '專案資料夾' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: '專案資料夾' }).click();
  await expect(page.getByRole('navigation').getByRole('link', { name: '流程圖草稿' })).toBeVisible();
});

test('檔名搜尋（Mod+K）可以找到中文檔名', async ({ page }) => {
  await createUserAndLogin(page, 'search');
  await page.getByRole('button', { name: '新增畫布' }).last().click();
  await expect(page).toHaveURL(/\/b\//);
  await page.getByTitle('重新命名').click();
  await page.getByRole('dialog').getByRole('textbox').fill('季度營運流程');
  await page.getByRole('dialog').getByRole('button', { name: '儲存' }).click();
  await page.goto('/');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.getByPlaceholder('搜尋檔名或畫布內容…').fill('營運');
  await expect(page.getByRole('option').filter({ hasText: '季度營運流程' })).toBeVisible();
});

test('重設密碼與每日排程（測試時鐘）', async ({ page }) => {
  const email = uniqueEmail('daily');
  cli(['create-user', '--email', email, '--password', PASSWORD]);
  cli(['reset-password', '--email', email, '--password', 'another-password-1']);
  await login(page, email, 'another-password-1');

  await page.getByRole('button', { name: '新增畫布' }).last().click();
  await expect(page).toHaveURL(/\/b\//);
  await page.getByRole('link', { name: '最近檔案' }).click();
  const card = page.getByRole('listitem').filter({ hasText: '未命名畫布' }).first();
  await card.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '移到垃圾桶' }).click();
  await page.getByRole('link', { name: '垃圾桶' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: '未命名畫布' })).toHaveCount(1);

  // 29 天後還在，31 天後被永久刪除
  const in29 = new Date(Date.now() + 29 * 86400_000).toISOString();
  const in31 = new Date(Date.now() + 31 * 86400_000).toISOString();
  cli(['run-daily', '--now', in29]);
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: '未命名畫布' })).toHaveCount(1);
  cli(['run-daily', '--now', in31]);
  // 以 31 天後的時鐘執行，原本的 Session（30 天）也一併過期被清除，需要重新登入
  await page.reload();
  await expect(page.getByRole('heading', { name: '登入 TinyCanvas' })).toBeVisible();
  await login(page, email, 'another-password-1');
  await page.getByRole('link', { name: '垃圾桶' }).click();
  await expect(page.getByText('垃圾桶是空的')).toBeVisible();
});
