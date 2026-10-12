import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

export const E2E_DB = 'postgresql://tinycanvas:tinycanvas@localhost:54329/tinycanvas_e2e';

/** 執行 api 的 CLI（與正式環境的 `node dist/cli.js` 相同指令），指向 E2E 資料庫 */
export function cli(args: string[]): string {
  return execFileSync('pnpm', ['--silent', '--filter', '@tinycanvas/api', 'cli', ...args], {
    env: { ...process.env, DATABASE_URL: E2E_DB, STORAGE_LOCAL_DIR: '.data/e2e-files', LOG_LEVEL: 'warn' },
    encoding: 'utf8',
  });
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

export const PASSWORD = 'correct-horse-battery';

export async function createUserAndLogin(page: Page, prefix = 'user'): Promise<string> {
  const email = uniqueEmail(prefix);
  cli(['create-user', '--email', email, '--password', PASSWORD]);
  await login(page, email);
  return email;
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('密碼').fill(password);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page.getByRole('heading', { name: '最近檔案' })).toBeVisible();
}

export const isMac = process.platform === 'darwin';
export const MOD = isMac ? 'Meta' : 'Control';

/** 畫布上所有物件（讀自頁面中的 Y.Doc） */
export async function boardObjects(page: Page): Promise<Record<string, any>[]> {
  return page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    if (!ed) return [];
    return Object.values(ed.doc.getMap('objects').toJSON()) as Record<string, any>[];
  });
}

export async function waitForEditor(page: Page) {
  await page.waitForFunction(() => Boolean((window as any).__tcEditor));
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', /synced|saving/);
}

/** 新增一張畫布並開啟，回傳檔案 id */
export async function newBoard(page: Page, title?: string): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: '新增畫布' }).last().click();
  await expect(page).toHaveURL(/\/b\//);
  const id = page.url().split('/b/')[1];
  await waitForEditor(page);
  if (title) {
    await page.getByTitle('重新命名').click();
    await page.getByRole('dialog').getByRole('textbox').fill(title);
    await page.getByRole('dialog').getByRole('button', { name: '儲存' }).click();
  }
  return id;
}

/** 以工具列建立形狀：選工具後在畫布上點一下 */
export async function addShapeByClick(page: Page, key: string, x: number, y: number) {
  await page.getByTestId('board-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(key);
  await page.getByTestId('board-canvas').click({ position: { x, y } });
}
