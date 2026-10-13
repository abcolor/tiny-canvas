import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, newBoard } from './helpers';

// 調整大小時，移動中的邊吸到附近物件的邊並顯示對齊參考線（DECISIONS.md 2026-10-13）
test('縮放形狀時吸附附近物件並顯示參考線', async ({ page }) => {
  await createUserAndLogin(page, 'resizeguide');
  await newBoard(page);
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  const { a, bx } = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 120, h: 70 }, { atViewportCenter: true });
    const o = ed.doc.getMap('objects').get(a);
    // 參考物件的左邊刻意不在格線上，才能分辨是吸到物件而不是格線
    const bx = o.get('x') + 203;
    ed.insert({ type: 'shape', shapeKind: 'rectangle', x: bx, y: o.get('y') + 150, w: 100, h: 60 });
    ed.select([a]);
    return { a, bx };
  });
  const toScreen = (p: { x: number; y: number }) =>
    page.evaluate((q) => (window as any).__tcEditor.worldToScreen(q), p).then((s) => ({ x: canvas.x + s.x, y: canvas.y + s.y }));
  const before = (await boardObjects(page)).find((o) => o.id === a)!;
  const handle = await toScreen({ x: before.x + before.w, y: before.y + before.h / 2 });
  const target = await toScreen({ x: bx - 2, y: before.y + before.h / 2 });

  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  const guides = await page.evaluate(() => (window as any).__tcEditor.guides);
  expect(guides).toContainEqual(expect.objectContaining({ axis: 'x', pos: bx }));
  await page.mouse.up();

  const after = (await boardObjects(page)).find((o) => o.id === a)!;
  expect(after.x).toBe(before.x);
  expect(after.x + after.w).toBeCloseTo(bx, 6);
  // 放開後參考線消失
  expect(await page.evaluate(() => (window as any).__tcEditor.guides)).toEqual([]);
});
