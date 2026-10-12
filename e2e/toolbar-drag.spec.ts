import { expect, test } from '@playwright/test';
import { createUserAndLogin, newBoard } from './helpers';

// 拖曳物件或線段期間隱藏浮動工具列，放開後再顯示（DECISIONS.md 2026-10-12）
test('拖曳形狀、折線線段時隱藏浮動工具列', async ({ page }) => {
  await createUserAndLogin(page, 'bardrag');
  await newBoard(page);
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  const ids = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 120, h: 70 }, { atViewportCenter: true });
    const o = ed.doc.getMap('objects').get(a);
    const x = o.get('x');
    const y = o.get('y');
    const b = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: x + 240, y: y + 180, w: 120, h: 70 });
    const c = ed.insert({ type: 'connector', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: a, anchor: 'right' }, to: { objectId: b, anchor: 'top' }, waypoints: [{ x: x + 180, y: y + 35 }, { x: x + 180, y: y + 120 }, { x: x + 300, y: y + 120 }] });
    ed.select([a]);
    return { a, c };
  });
  const rect = await page.evaluate((id) => (window as any).__tcEditor.getObjectScreenRect(id), ids.a);
  const center = { x: canvas.x + rect.x + rect.w / 2, y: canvas.y + rect.y + rect.h / 2 };
  await expect(bar).toBeVisible();

  // 拖曳形狀
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 20, center.y + 10, { steps: 4 });
  await expect(bar).toBeHidden();
  await page.mouse.move(center.x + 40, center.y + 20, { steps: 4 });
  await expect(bar).toBeHidden();
  await page.mouse.up();
  await expect(bar).toBeVisible();

  // 拖曳折線中間的垂直線段
  await page.evaluate((id) => (window as any).__tcEditor.select([id]), ids.c);
  await expect(bar).toBeVisible();
  const pts = await page.evaluate((id) => {
    const ed = (window as any).__tcEditor;
    return ed.model.routes.get(ed.model.store.get(id)).points.map((p: any) => ed.worldToScreen(p));
  }, ids.c);
  const mid = { x: canvas.x + (pts[1].x + pts[2].x) / 2, y: canvas.y + (pts[1].y + pts[2].y) / 2 };
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 30, mid.y, { steps: 4 });
  await expect(bar).toBeHidden();
  await page.mouse.up();
  await expect(bar).toBeVisible();

  // 單擊（沒有拖曳）不會讓工具列閃爍消失
  await page.mouse.click(mid.x + 30, mid.y);
  await expect(bar).toBeVisible();
});
