import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, MOD, newBoard, waitForEditor } from './helpers';

// 刪除形狀時，形狀內的物件一起刪除（DECISIONS.md 2026-10-13）
test('按 Delete 刪除形狀時一起刪除形狀內的物件，另一個分頁一致', async ({ page, context }) => {
  await createUserAndLogin(page, 'deleteinner');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);
  const ids = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 240, h: 160 }, { atViewportCenter: true });
    const o = ed.doc.getMap('objects').get(a);
    ed.insert({ type: 'icon', iconName: 'Star', x: o.get('x') + 20, y: o.get('y') + 20, w: 32, h: 32 });
    ed.insert({ type: 'shape', shapeKind: 'rectangle', x: o.get('x') + 100, y: o.get('y') + 60, w: 80, h: 50, text: '內部' });
    const out = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: o.get('x') + 400, y: o.get('y'), w: 80, h: 50 });
    ed.select([a]);
    return { a, out };
  });
  await expect.poll(async () => (await boardObjects(other)).length).toBe(4);

  await page.getByTestId('board-canvas').focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await boardObjects(page)).map((o) => o.id)).toEqual([ids.out]);
  await expect.poll(async () => (await boardObjects(other)).map((o) => o.id)).toEqual([ids.out]);

  // 一次復原全部恢復
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(4);
  await expect.poll(async () => (await boardObjects(other)).length).toBe(4);
});

// 縮放、旋轉形狀時，形狀內的物件留在畫面上（抬到即時圖層，畫在形狀上方）（DECISIONS.md 2026-10-13）
test('縮放、旋轉形狀時形狀內的物件不會被蓋住', async ({ page }) => {
  await createUserAndLogin(page, 'resizeinner');
  await newBoard(page);
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  const ids = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 240, h: 160, style: { fillMode: 'solid', stroke: '#2888d7' } }, { atViewportCenter: true });
    const o = ed.doc.getMap('objects').get(a);
    const inner = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: o.get('x') + 40, y: o.get('y') + 40, w: 80, h: 50 });
    const below = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: o.get('x') + 400, y: o.get('y'), w: 80, h: 50 });
    ed.select([a]);
    return { a, inner, below };
  });
  const toScreen = (p: { x: number; y: number }) =>
    page.evaluate((q) => (window as any).__tcEditor.worldToScreen(q), p).then((s) => ({ x: canvas.x + s.x, y: canvas.y + s.y }));
  const live = (id: string) => page.evaluate((i) => (window as any).__tcEditor.renderer.hidden.has(i), id);
  const a = (await boardObjects(page)).find((o) => o.id === ids.a)!;

  // 縮放：拖右下角把手
  const corner = await toScreen({ x: a.x + a.w, y: a.y + a.h });
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 5 });
  expect(await live(ids.a)).toBe(true);
  expect(await live(ids.inner)).toBe(true);
  // 不重疊的物件不受影響
  expect(await live(ids.below)).toBe(false);
  await page.mouse.up();
  expect(await live(ids.inner)).toBe(false);
  const inner = (await boardObjects(page)).find((o) => o.id === ids.inner)!;
  expect(inner).toMatchObject({ w: 80, h: 50 });

  // 旋轉：拖旋轉把手（handles() 回傳畫布座標）。浮動工具列會蓋住形狀上方的旋轉把手，這裡先隱藏
  await page.addStyleTag({ content: '[role="toolbar"][aria-label="樣式工具列"] { display: none !important; }' });
  const rot = await page.evaluate(() => (window as any).__tcEditor.handles().find((h: any) => h.kind === 'rotate').p);
  await page.mouse.move(canvas.x + rot.x, canvas.y + rot.y);
  await page.mouse.down();
  await page.mouse.move(canvas.x + rot.x + 80, canvas.y + rot.y + 30, { steps: 5 });
  expect(await live(ids.a)).toBe(true);
  expect(await live(ids.inner)).toBe(true);
  await page.mouse.up();
  expect(await live(ids.inner)).toBe(false);
  expect((await boardObjects(page)).find((o) => o.id === ids.a)!.rotation).not.toBe(0);
});
