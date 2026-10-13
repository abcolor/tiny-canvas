import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, MOD, newBoard, waitForEditor } from './helpers';

// 「複製一份」：副本跟著游標（左上角對齊游標），點按左鍵放置；Esc 取消
test('點按「複製一份」後在指定位置放置副本', async ({ page }) => {
  await createUserAndLogin(page, 'place');
  await newBoard(page);
  const id = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 160, h: 80, text: '原本' }, { atViewportCenter: true });
    ed.select([a]);
    return a as string;
  });
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;

  await bar.getByRole('button', { name: '複製一份' }).click();
  await expect(page.getByText('在想放置的位置點按左鍵')).toBeVisible();
  // 移動期間不寫入文件
  const target = { x: canvas.x + 200, y: canvas.y + 520 };
  await page.mouse.move(target.x - 60, target.y - 40, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 4 });
  expect((await boardObjects(page)).length).toBe(1);
  await page.mouse.down();
  await page.mouse.up();

  const objs = await boardObjects(page);
  expect(objs.length).toBe(2);
  const copy = objs.find((o) => o.id !== id)!;
  const world = await page.evaluate(([x, y]) => (window as any).__tcEditor.screenToWorld({ x, y }), [target.x - canvas.x, target.y - canvas.y]);
  // 左上角在游標位置（吸附 8px 格線）
  expect(Math.abs(copy.x - world.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(copy.y - world.y)).toBeLessThanOrEqual(4);
  expect(copy.text).toContain('原本');
  await expect(page.getByText('在想放置的位置點按左鍵')).toHaveCount(0);
  // 新的副本被選取
  expect(await page.evaluate(() => (window as any).__tcEditor.getState().selection)).toEqual([copy.id]);

  // 一次 Mod+Z 移除副本
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(1);
});

test('放置中按 Esc 取消', async ({ page }) => {
  await createUserAndLogin(page, 'placeesc');
  await newBoard(page);
  await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    ed.select([ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 160, h: 80 }, { atViewportCenter: true })]);
  });
  await page.getByRole('toolbar', { name: '樣式工具列' }).getByRole('button', { name: '複製一份' }).click();
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + 300, canvas.y + 500, { steps: 4 });
  await page.keyboard.press('Escape');
  await expect(page.getByText('在想放置的位置點按左鍵')).toHaveCount(0);
  await page.mouse.click(canvas.x + 300, canvas.y + 500);
  expect((await boardObjects(page)).length).toBe(1);
});

test('放置中對齊附近物件的邊（智慧參考線）', async ({ page }) => {
  await createUserAndLogin(page, 'placesnap');
  await newBoard(page);
  const orig = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 160, h: 80 }, { atViewportCenter: true });
    ed.select([a]);
    return a as string;
  });
  // 移到不在 8px 格線上的位置，確保對齊結果來自參考線而非格線
  const o0 = (await boardObjects(page)).find((x) => x.id === orig)!;
  await page.evaluate(([id, x]) => (window as any).__tcEditor.updateObject(id, { x }), [orig, Math.round(o0.x / 8) * 8 + 3] as const);
  const o = (await boardObjects(page)).find((x) => x.id === orig)!;
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  // 游標在原物件左邊緣右側 3px、下方 200px
  const at = await page.evaluate(([x, y]) => (window as any).__tcEditor.worldToScreen({ x, y }), [o.x + 3, o.y + o.h + 200]);
  await page.getByRole('toolbar', { name: '樣式工具列' }).getByRole('button', { name: '複製一份' }).click();
  await page.mouse.move(canvas.x + at.x - 40, canvas.y + at.y - 40, { steps: 4 });
  await page.mouse.move(canvas.x + at.x, canvas.y + at.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
  const copy = (await boardObjects(page)).find((x) => x.id !== orig)!;
  expect(copy.x).toBeCloseTo(o.x, 6);
});

// 複製形狀時，形狀內的物件一起複製（DECISIONS.md 2026-10-13）
test('「複製一份」與 Mod+D 一起複製形狀內的物件，另一個分頁一致', async ({ page, context }) => {
  await createUserAndLogin(page, 'placeinner');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);
  const ids = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 240, h: 160 }, { atViewportCenter: true });
    const o = ed.doc.getMap('objects').get(a);
    const icon = ed.insert({ type: 'icon', iconName: 'Star', x: o.get('x') + 20, y: o.get('y') + 20, w: 32, h: 32 });
    const inner = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: o.get('x') + 100, y: o.get('y') + 60, w: 80, h: 50, text: '內部' });
    ed.select([a]);
    return { a, icon, inner };
  });
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;

  await bar.getByRole('button', { name: '複製一份' }).click();
  await page.mouse.move(canvas.x + 120, canvas.y + 480, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();

  const objs = await boardObjects(page);
  expect(objs.length).toBe(6);
  const copy = objs.find((o) => o.type === 'shape' && o.w === 240 && o.id !== ids.a)!;
  const src = objs.find((o) => o.id === ids.a)!;
  const dx = copy.x - src.x;
  const dy = copy.y - src.y;
  // 形狀內物件的複本相對位置不變
  for (const id of [ids.icon, ids.inner]) {
    const orig = objs.find((o) => o.id === id)!;
    const dup = objs.find((o) => o.id !== id && o.type === orig.type && o.w === orig.w && Math.abs(o.x - (orig.x + dx)) < 1e-6 && Math.abs(o.y - (orig.y + dy)) < 1e-6);
    expect(dup).toBeTruthy();
  }
  expect(objs.filter((o) => typeof o.text === 'string' && o.text.includes('內部')).length).toBe(2);
  // 只選取形狀的複本
  expect(await page.evaluate(() => (window as any).__tcEditor.getState().selection)).toEqual([copy.id]);
  await expect.poll(async () => (await boardObjects(other)).length).toBe(6);

  // Mod+D 同樣一起複製；一次復原全部移除
  await page.evaluate((id) => (window as any).__tcEditor.select([id]), ids.a);
  await page.keyboard.press(`${MOD}+d`);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(9);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(6);
  await expect.poll(async () => (await boardObjects(other)).length).toBe(6);
});
