import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, MOD, newBoard, waitForEditor } from './helpers';

// 圖示浮動工具列的水平 / 垂直翻轉：另一個分頁一致、可以復原
test('圖示水平與垂直翻轉，另一個分頁一致', async ({ page, context }) => {
  await createUserAndLogin(page, 'iconflip');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);

  const id = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const id = ed.insert({ type: 'icon', iconName: 'ArrowRight', x: 0, y: 0, w: 48, h: 48 }, { atViewportCenter: true });
    ed.select([id]);
    return id as string;
  });
  const icon = async (p = page) => (await boardObjects(p)).find((o) => o.id === id)!;

  await page.getByRole('button', { name: '水平翻轉' }).click();
  await expect.poll(async () => (await icon()).flipX).toBe(true);
  await page.getByRole('button', { name: '垂直翻轉' }).click();
  await expect.poll(async () => (await icon()).flipY).toBe(true);
  await expect.poll(async () => {
    const o = await icon(other);
    return [o.flipX, o.flipY];
  }).toEqual([true, true]);

  // 復原最後一次翻轉
  await page.evaluate(() => (window as any).__tcEditor.focus());
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => Boolean((await icon(other)).flipY)).toBe(false);
  expect((await icon()).flipX).toBe(true);
});
