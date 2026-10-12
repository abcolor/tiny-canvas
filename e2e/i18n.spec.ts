import { expect, test } from '@playwright/test';
import { cli, PASSWORD, uniqueEmail } from './helpers';

// 這支測試驗證預設英文介面，不沿用 playwright.config.ts 預先寫入的中文語系
test.use({ storageState: { cookies: [], origins: [] } });

test('預設英文介面，切換成中文後保存在瀏覽器並套用到其他分頁', async ({ page, context }) => {
  const email = uniqueEmail('i18n');
  cli(['create-user', '--email', email, '--password', PASSWORD]);

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Log in to TinyCanvas' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();

  // 切換成中文：頁面重新載入後顯示中文
  await page.getByTestId('language-menu').click();
  await page.getByRole('menuitemcheckbox', { name: '中文' }).click();
  await expect(page.getByRole('heading', { name: '最近檔案' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tc:locale'))).toBe('zh-TW');

  // 同一個瀏覽器的另一個分頁也是中文
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByRole('heading', { name: '最近檔案' })).toBeVisible();

  // 切回英文，重新整理後維持英文
  await other.getByTestId('language-menu').click();
  await other.getByRole('menuitemcheckbox', { name: 'English' }).click();
  await expect(other.getByRole('heading', { name: 'Recent' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();
});

test('英文介面插入的線框圖元件使用英文預設文字', async ({ page }) => {
  const email = uniqueEmail('i18n-wf');
  cli(['create-user', '--email', email, '--password', PASSWORD]);
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('button', { name: 'New board' }).last().click();
  await expect(page).toHaveURL(/\/b\//);
  await page.waitForFunction(() => Boolean((window as any).__tcEditor));

  await page.evaluate(() => (window as any).__tcEditor.insertWithTool({ kind: 'wireframe', componentKind: 'button' }));
  const texts = await page.evaluate(() =>
    Object.values((window as any).__tcEditor.doc.getMap('objects').toJSON() as Record<string, any>)
      .filter((o) => o.type === 'wireframe')
      .map((o) => JSON.stringify(o.text)),
  );
  expect(texts.some((t) => t.includes('Button'))).toBe(true);
});
