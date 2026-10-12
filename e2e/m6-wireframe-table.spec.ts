import { expect, test, type Page } from '@playwright/test';
import { WIREFRAME_KINDS } from '../packages/shared/src/model/types';
import { boardObjects, createUserAndLogin, newBoard } from './helpers';

async function rect(page: Page, id: string) {
  return page.evaluate((i) => (window as any).__tcEditor.getObjectScreenRect(i), id);
}
async function canvasOrigin(page: Page) {
  const box = await page.getByTestId('board-canvas').boundingBox();
  return { x: box!.x, y: box!.y };
}

// M6 驗收：元件庫全部可用；裝置框遵循區塊規則；表格可以增刪列與欄
test('線框圖元件庫、裝置框歸屬規則', async ({ page }) => {
  await createUserAndLogin(page, 'm6');
  await newBoard(page);

  // 指令面板插入手機裝置框
  await page.keyboard.press('/');
  await page.getByPlaceholder('插入元件…（輸入名稱搜尋）').fill('手機');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await boardObjects(page)).filter((o) => o.frameKind === 'phone').length).toBe(1);
  const frame = (await boardObjects(page)).find((o) => o.frameKind === 'phone')!;

  // W 開啟元件庫，插入按鈕
  await page.evaluate(() => (window as any).__tcEditor.clearSelection());
  await page.keyboard.press('w');
  await expect(page.getByRole('dialog', { name: '線框圖元件庫' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '按鈕', exact: true }).click();
  await expect.poll(async () => (await boardObjects(page)).filter((o) => o.componentKind === 'button').length).toBe(1);
  const button = (await boardObjects(page)).find((o) => o.componentKind === 'button')!;

  // 拖出裝置框外，再拖進裝置框內：歸屬依中心點判定
  const o = await canvasOrigin(page);
  const fr = await rect(page, frame.id);
  let br = await rect(page, button.id);
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(o.x + from.x, o.y + from.y);
    await page.mouse.down();
    await page.mouse.move(o.x + (from.x + to.x) / 2, o.y + (from.y + to.y) / 2, { steps: 5 });
    await page.mouse.move(o.x + to.x, o.y + to.y, { steps: 5 });
    await page.mouse.up();
  };
  await drag({ x: br.x + br.w / 2, y: br.y + br.h / 2 }, { x: fr.x + fr.w + 200, y: fr.y + fr.h / 2 });
  await expect.poll(async () => (await boardObjects(page)).find((x) => x.id === button.id)!.parentId).toBeNull();
  br = await rect(page, button.id);
  await drag({ x: br.x + br.w / 2, y: br.y + br.h / 2 }, { x: fr.x + fr.w / 2, y: fr.y + fr.h / 2 });
  await expect.poll(async () => (await boardObjects(page)).find((x) => x.id === button.id)!.parentId).toBe(frame.id);

  // 移動裝置框時，裡面的按鈕一起移動
  const before = (await boardObjects(page)).find((x) => x.id === button.id)!;
  await page.evaluate((id) => (window as any).__tcEditor.select([id]), frame.id);
  await page.evaluate(() => (window as any).__tcEditor.focus());
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await boardObjects(page)).find((x) => x.id === button.id)!.x).toBeGreaterThan(before.x);

  // 元件庫的全部元件都能插入並繪製（不拋出錯誤）
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluate((kinds) => {
    const ed = (window as any).__tcEditor;
    for (const k of kinds) ed.insertWithTool({ kind: 'wireframe', componentKind: k });
    ed.zoomToFit();
  }, WIREFRAME_KINDS);
  await page.waitForTimeout(500);
  const all = await boardObjects(page);
  for (const k of WIREFRAME_KINDS) expect(all.some((x) => x.componentKind === k), k).toBe(true);
  expect(errors).toEqual([]);
});

test('表格：插入、編輯儲存格、增刪列與欄', async ({ page }) => {
  await createUserAndLogin(page, 'table');
  await newBoard(page);
  await page.keyboard.press('/');
  await page.getByPlaceholder('插入元件…（輸入名稱搜尋）').fill('表格');
  await page.getByRole('option').filter({ hasText: /^表格$/ }).first().click();
  await expect.poll(async () => (await boardObjects(page)).filter((o) => o.type === 'table').length).toBe(1);
  const table = () => boardObjects(page).then((all) => all.find((o) => o.type === 'table')!);
  const t0 = await table();
  expect(t0.rows.length).toBe(3);
  expect(t0.columns.length).toBe(3);

  // 雙擊第一格輸入文字，Tab 移到下一格
  const r = await rect(page, t0.id);
  const o = await canvasOrigin(page);
  const cellW = r.w / 3;
  const cellH = r.h / 3;
  await page.mouse.dblclick(o.x + r.x + cellW / 2, o.y + r.y + cellH / 2);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('姓名');
  const cellBefore = await page.evaluate(() => (window as any).__tcEditor.getState().editing.cellKey);
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => (window as any).__tcEditor.getState().editing?.cellKey)).not.toBe(cellBefore);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('電話');
  await page.keyboard.press('Escape');
  const t1 = await table();
  const k = (row: number, col: number) => `${t1.rows[row].id}:${t1.columns[col].id}`;
  expect(t1.cells[k(0, 0)]).toContain('姓名');
  expect(t1.cells[k(0, 1)]).toContain('電話');

  // 右鍵選單新增列與欄、刪除欄
  await page.mouse.click(o.x + r.x + cellW / 2, o.y + r.y + cellH * 1.5, { button: 'right' });
  await page.getByRole('menuitem', { name: '在下方插入列' }).click();
  await expect.poll(async () => (await table()).rows.length).toBe(4);
  await page.mouse.click(o.x + r.x + cellW / 2, o.y + r.y + cellH * 1.5, { button: 'right' });
  await page.getByRole('menuitem', { name: '在右側插入欄' }).click();
  await expect.poll(async () => (await table()).columns.length).toBe(4);
  await page.mouse.click(o.x + r.x + cellW / 2, o.y + r.y + cellH * 1.5, { button: 'right' });
  await page.getByRole('menuitem', { name: '刪除欄' }).click();
  await expect.poll(async () => (await table()).columns.length).toBe(3);
  // 刪除欄後，原本的儲存格內容不會錯位
  const t2 = await table();
  const firstRowTexts = t2.columns.map((c: { id: string }) => t2.cells[`${t2.rows[0].id}:${c.id}`]).join('|');
  expect(firstRowTexts).toContain('電話');
});

test('圖示：從工具列的圖示庫以中文搜尋插入、更換圖示、快捷鍵 I', async ({ page }) => {
  await createUserAndLogin(page, 'icon');
  await newBoard(page);
  await page.getByRole('button', { name: '圖示', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '圖示庫' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill('資料庫');
  await dialog.getByRole('option', { name: 'Database', exact: true }).click();
  await expect.poll(async () => (await boardObjects(page)).filter((o) => o.type === 'icon').length).toBe(1);
  const icon = (await boardObjects(page)).find((o) => o.type === 'icon')!;
  expect(icon.iconName).toBe('Database');

  // 用滑鼠點選圖示（先取消選取，再點圖示中央）
  await page.evaluate(() => (window as any).__tcEditor.clearSelection());
  const ir = await rect(page, icon.id);
  const io = await canvasOrigin(page);
  await page.mouse.click(io.x + ir.x + ir.w / 2, io.y + ir.y + ir.h / 2);
  await expect.poll(() => page.evaluate(() => (window as any).__tcEditor.getState().selection)).toEqual([icon.id]);
  // 拖曳移動
  const before = icon.x;
  await page.mouse.move(io.x + ir.x + ir.w / 2, io.y + ir.y + ir.h / 2);
  await page.mouse.down();
  await page.mouse.move(io.x + ir.x + ir.w / 2 + 80, io.y + ir.y + ir.h / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await boardObjects(page)).find((o) => o.id === icon.id)!.x).toBeGreaterThan(before + 40);

  // 選取後可以更換
  await page.getByRole('button', { name: '更換圖示' }).click();
  const replace = page.getByRole('dialog', { name: '更換圖示' });
  await replace.getByRole('textbox').fill('server');
  await replace.getByRole('option', { name: 'Server', exact: true }).click();
  await expect.poll(async () => (await boardObjects(page)).find((o) => o.id === icon.id)!.iconName).toBe('Server');

  // 快捷鍵 I 也能開啟圖示庫；英文名稱搜尋
  await page.evaluate(() => (window as any).__tcEditor.clearSelection());
  await page.evaluate(() => (window as any).__tcEditor.focus());
  await page.keyboard.press('i');
  await expect(page.getByRole('dialog', { name: '圖示庫' })).toBeVisible();
  await page.getByRole('dialog').getByRole('textbox').fill('rocket');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await boardObjects(page)).filter((o) => o.type === 'icon').length).toBe(2);

  // 以 Lucide 標籤搜尋：retry 是 RotateCcw 的標籤（與 lucide.dev 相同）
  await page.evaluate(() => (window as any).__tcEditor.focus());
  await page.keyboard.press('i');
  await page.getByRole('dialog').getByRole('textbox').fill('retry');
  await page.getByRole('dialog').getByRole('option', { name: 'RotateCcw', exact: true }).click();
  await expect.poll(async () => (await boardObjects(page)).some((o) => o.iconName === 'RotateCcw')).toBe(true);
});

test('形狀內的物件跟著形狀移動（滑鼠拖曳與方向鍵）', async ({ page }) => {
  await createUserAndLogin(page, 'carry');
  await newBoard(page);
  const ids = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 320, h: 200 }, { atViewportCenter: true });
    const o = ed.doc.getMap('objects').get(a);
    const ax = o.get('x');
    const ay = o.get('y');
    const icon = ed.insert({ type: 'icon', iconName: 'Database', x: ax + 20, y: ay + 20, w: 48, h: 48 });
    const outside = ed.insert({ type: 'shape', shapeKind: 'ellipse', x: ax + 400, y: ay, w: 96, h: 96 });
    ed.clearSelection();
    return { a, icon, outside };
  });
  const before = Object.fromEntries((await boardObjects(page)).map((o) => [o.id, o]));
  const r = await rect(page, ids.a);
  const o = await canvasOrigin(page);
  // 從矩形右下方（不是圖示的位置）拖曳
  const sx = o.x + r.x + r.w - 40;
  const sy = o.y + r.y + r.h - 30;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 60, sy + 40, { steps: 6 });
  await page.mouse.move(sx + 120, sy + 80, { steps: 6 });
  await page.mouse.up();
  const after = Object.fromEntries((await boardObjects(page)).map((x) => [x.id, x]));
  const dx = after[ids.a].x - before[ids.a].x;
  const dy = after[ids.a].y - before[ids.a].y;
  expect(dx).toBeGreaterThan(80);
  expect(after[ids.icon].x - before[ids.icon].x).toBe(dx);
  expect(after[ids.icon].y - before[ids.icon].y).toBe(dy);
  expect(after[ids.outside].x).toBe(before[ids.outside].x);

  // 方向鍵微調
  await page.keyboard.press('Shift+ArrowLeft');
  const nudged = Object.fromEntries((await boardObjects(page)).map((x) => [x.id, x]));
  expect(nudged[ids.icon].x).toBe(after[ids.icon].x - 8);
  expect(nudged[ids.a].x).toBe(after[ids.a].x - 8);
});
