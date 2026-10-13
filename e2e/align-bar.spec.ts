import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, newBoard } from './helpers';

// 多選時浮動工具列只顯示對齊與等距分佈（SPEC.md 第 3.2 節）
test('多選：工具列的對齊與等距分佈', async ({ page }) => {
  await createUserAndLogin(page, 'alignbar');
  await newBoard(page);
  const ids = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 100, h: 60 }, { atViewportCenter: true });
    const o = ed.getObjectScreenRect(a);
    const w = ed.screenToWorld({ x: o.x, y: o.y });
    const b = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: w.x + 160, y: w.y + 40, w: 80, h: 40 });
    const c = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: w.x + 400, y: w.y - 30, w: 60, h: 60 });
    ed.select([a, b, c]);
    return [a, b, c] as string[];
  });
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  // 只有對齊、分佈、群組與「更多」，沒有樣式控制
  await expect(bar.getByRole('button', { name: '靠上對齊' })).toBeVisible();
  await expect(bar.getByRole('button', { name: '複製一份' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: '形狀', exact: true })).toHaveCount(0);

  await bar.getByRole('button', { name: '靠上對齊' }).click();
  let objs = await boardObjects(page);
  const top = Math.min(...ids.map((id) => objs.find((o) => o.id === id)!.y));
  for (const id of ids) expect(objs.find((o) => o.id === id)!.y).toBeCloseTo(top, 6);

  await bar.getByRole('button', { name: '水平等距分佈' }).click();
  objs = await boardObjects(page);
  const [a, b, c] = ids.map((id) => objs.find((o) => o.id === id)!).sort((p, q) => p.x - q.x);
  expect(b.x - (a.x + a.w)).toBeCloseTo(c.x - (b.x + b.w), 6);

  // 只選兩個時，等距分佈停用
  await page.evaluate((s) => (window as any).__tcEditor.select(s), ids.slice(0, 2));
  await expect(bar.getByRole('button', { name: '水平等距分佈' })).toBeDisabled();
});

// 群組 / 解除群組放在工具列外層，不在「更多」裡（右鍵選單仍保留）
test('多選：工具列外層的群組與解除群組', async ({ page }) => {
  await createUserAndLogin(page, 'groupbar');
  await newBoard(page);
  const ids = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 100, h: 60 }, { atViewportCenter: true });
    const o = ed.getObjectScreenRect(a);
    const w = ed.screenToWorld({ x: o.x, y: o.y });
    const b = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: w.x + 160, y: w.y, w: 100, h: 60 });
    ed.select([a, b]);
    return [a, b] as string[];
  });
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });

  await bar.getByRole('button', { name: '更多' }).click();
  await expect(page.getByRole('menuitem', { name: '群組', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await bar.getByRole('button', { name: '群組', exact: true }).click();
  let objs = await boardObjects(page);
  const group = objs.find((o) => o.type === 'group');
  expect(group).toBeTruthy();
  for (const id of ids) expect(objs.find((o) => o.id === id)!.parentId).toBe(group!.id);

  // 選取群組後，工具列外層顯示解除群組，「更多」裡沒有
  await expect(bar.getByRole('button', { name: '群組', exact: true })).toHaveCount(0);
  await bar.getByRole('button', { name: '更多' }).click();
  await expect(page.getByRole('menuitem', { name: '解除群組' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await bar.getByRole('button', { name: '解除群組' }).click();
  objs = await boardObjects(page);
  expect(objs.some((o) => o.type === 'group')).toBe(false);
  for (const id of ids) expect(objs.find((o) => o.id === id)!.parentId).toBeNull();
});
