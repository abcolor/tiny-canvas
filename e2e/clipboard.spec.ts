import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, MOD, newBoard, waitForEditor } from './helpers';

// 鍵盤複製、剪下、貼上（SPEC.md 第 3.2 節）。點過工具列按鈕、焦點不在畫布上時也要有效（DECISIONS.md 2026-10-13）
test('Mod+C / Mod+V / Mod+X：點過工具列後仍然有效，另一個分頁一致', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await createUserAndLogin(page, 'clipkeys');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  const id = await page.evaluate(() => (window as any).__tcEditor.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 160, h: 80 }, { atViewportCenter: true }));
  const r = await page.evaluate((i) => (window as any).__tcEditor.getObjectScreenRect(i), id);
  const count = async (p = page) => (await boardObjects(p)).length;
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });

  // 點選後直接操作
  await page.mouse.click(canvas.x + r.x + r.w / 2, canvas.y + r.y + r.h / 2);
  await page.keyboard.press(`${MOD}+c`);
  await page.keyboard.press(`${MOD}+v`);
  await expect.poll(() => count()).toBe(2);
  await expect.poll(() => count(other)).toBe(2);

  // 點過浮動工具列的按鈕後，焦點在按鈕上
  await bar.getByRole('button', { name: '透明背景' }).click();
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('透明背景');
  await page.keyboard.press(`${MOD}+c`);
  await page.keyboard.press(`${MOD}+v`);
  await expect.poll(() => count()).toBe(3);

  // 剪下
  await bar.getByRole('button', { name: '透明背景' }).click();
  await page.keyboard.press(`${MOD}+x`);
  await expect.poll(() => count()).toBe(2);
  await expect.poll(() => count(other)).toBe(2);
});

test('在輸入框中複製貼上文字時，不會複製或貼上畫布物件', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await createUserAndLogin(page, 'clipinput');
  await newBoard(page);
  await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    ed.select([ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 160, h: 80 }, { atViewportCenter: true })]);
  });
  await page.getByRole('toolbar', { name: '樣式工具列' }).getByRole('button', { name: '圖示', exact: true }).click();
  const search = page.getByRole('textbox', { name: /搜尋圖示/ });
  await search.fill('rabbit');
  await search.press(`${MOD}+a`);
  await search.press(`${MOD}+c`);
  await search.press('End');
  await search.press(`${MOD}+v`);
  await expect(search).toHaveValue('rabbitrabbit');
  expect((await boardObjects(page)).length).toBe(1);
});

// 點過工具列後，焦點不在畫布上時快捷鍵仍作用在畫布（DECISIONS.md 2026-10-13）
test('點過工具列後 Delete、Mod+Z、Mod+D 仍然有效，另一個分頁一致', async ({ page, context }) => {
  await createUserAndLogin(page, 'toolbarkeys');
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
  const count = async (p = page) => (await boardObjects(p)).length;
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });

  // Mod+D
  await bar.getByRole('button', { name: '透明背景' }).click();
  await page.keyboard.press(`${MOD}+d`);
  await expect.poll(() => count()).toBe(2);

  // Delete：工具列跟著消失，焦點回到畫布，Mod+Z 也能直接復原
  await page.evaluate((i) => (window as any).__tcEditor.select([i]), id);
  await bar.getByRole('button', { name: '透明背景' }).click();
  await page.keyboard.press('Delete');
  await expect.poll(() => count()).toBe(1);
  await expect.poll(() => count(other)).toBe(1);
  expect(await page.evaluate(() => document.activeElement === (window as any).__tcEditor.element)).toBe(true);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => count()).toBe(2);
  await expect.poll(() => count(other)).toBe(2);

  // Enter 留給按鈕本身：按下工具列按鈕，不會開始編輯文字
  await page.evaluate((i) => (window as any).__tcEditor.select([i]), id);
  await bar.getByRole('button', { name: '透明背景' }).focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__tcEditor.getState().editing)).toBeFalsy();
});

test('在輸入框中按 Backspace 不會刪除畫布物件', async ({ page }) => {
  await createUserAndLogin(page, 'inputkeys');
  await newBoard(page);
  await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    ed.select([ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 160, h: 80 }, { atViewportCenter: true })]);
  });
  await page.getByRole('toolbar', { name: '樣式工具列' }).getByRole('button', { name: '圖示', exact: true }).click();
  const search = page.getByRole('textbox', { name: /搜尋圖示/ });
  await search.fill('abc');
  await search.press('Backspace');
  await search.press('Delete');
  await expect(search).toHaveValue('ab');
  expect((await boardObjects(page)).length).toBe(1);
});
