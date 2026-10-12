import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, MOD, newBoard, waitForEditor } from './helpers';

// 折線中間線段的控制點：拖曳平移線段、另一個分頁同步、重設路線（DECISIONS.md 2026-10-12）
test('拖曳折線中間的控制點平移線段，另一個分頁一致', async ({ page, context }) => {
  await createUserAndLogin(page, 'segment');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);

  // 兩個並排的形狀，連線從 a 的上緣接到 b 的上緣（ㄇ 字形，中間是一段水平線）
  const c = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 100, h: 60 }, { atViewportCenter: true });
    const r = ed.getObjectScreenRect(a);
    const w = ed.screenToWorld({ x: r.x, y: r.y });
    const b = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: w.x + 240, y: w.y, w: 100, h: 60 });
    const c = ed.insert({ type: 'connector', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: a, anchor: 'top' }, to: { objectId: b, anchor: 'top' } });
    ed.select([c]);
    return c as string;
  });
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  const seg = await page.evaluate((id) => {
    const ed = (window as any).__tcEditor;
    const pts = ed.model.routes.get(ed.model.store.get(id)).points;
    return { mid: ed.worldToScreen({ x: (pts[1].x + pts[2].x) / 2, y: pts[1].y }), y: pts[1].y, n: pts.length };
  }, c);
  expect(seg.n).toBe(4);

  // 往上拖 80px
  await page.mouse.move(canvas.x + seg.mid.x, canvas.y + seg.mid.y);
  await page.mouse.down();
  await page.mouse.move(canvas.x + seg.mid.x, canvas.y + seg.mid.y - 40, { steps: 4 });
  await page.mouse.move(canvas.x + seg.mid.x, canvas.y + seg.mid.y - 80, { steps: 4 });
  await page.mouse.up();

  const zoom = await page.evaluate(() => (window as any).__tcEditor.getState().camera.zoom);
  const conn = (await boardObjects(page)).find((o) => o.id === c)!;
  expect(conn.waypoints).toHaveLength(2);
  expect(conn.waypoints[0].y).toBe(conn.waypoints[1].y);
  expect(Math.abs(conn.waypoints[0].y - (seg.y - 80 / zoom))).toBeLessThanOrEqual(4);
  // 另一個分頁看到同樣的路線
  await expect.poll(async () => JSON.stringify((await boardObjects(other)).find((o) => o.id === c)?.waypoints)).toBe(JSON.stringify(conn.waypoints));

  // 一次 Mod+Z 復原
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => (await boardObjects(page)).find((o) => o.id === c)!.waypoints).toEqual([]);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(async () => (await boardObjects(page)).find((o) => o.id === c)!.waypoints).toHaveLength(2);

  // 「更多」→ 重設路線
  await page.evaluate((id) => (window as any).__tcEditor.select([id]), c);
  await page.getByRole('toolbar', { name: '樣式工具列' }).getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '重設路線（自動路由）' }).click();
  await expect.poll(async () => (await boardObjects(other)).find((o) => o.id === c)!.waypoints).toEqual([]);
});

// 沒有先選取連線，直接在折線中間線段上按住拖曳：拖曳該線段，而不是整條移動後彈回原位
test('未選取時直接拖曳折線中間線段', async ({ page }) => {
  await createUserAndLogin(page, 'segdirect');
  await newBoard(page);
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  // a 右邊接到 b 上緣，手動路線為 ㄣ 字形（垂直段在兩個形狀之間）
  const c = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 115, h: 70 }, { atViewportCenter: true });
    const r = ed.getObjectScreenRect(a);
    const w = ed.screenToWorld({ x: r.x, y: r.y });
    const b = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: w.x + 247, y: w.y + 158, w: 115, h: 70 });
    const c = ed.insert({ type: 'connector', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: a, anchor: 'right' }, to: { objectId: b, anchor: 'top' }, waypoints: [{ x: w.x + 177, y: w.y + 35 }, { x: w.x + 177, y: w.y + 120 }] });
    ed.select([]);
    return c as string;
  });
  const route = () =>
    page.evaluate((id) => {
      const ed = (window as any).__tcEditor;
      const o = ed.model.store.get(id);
      return { pts: ed.model.routes.get(o).points.map((p: any) => ed.worldToScreen(p)), zoom: ed.getState().camera.zoom, selection: ed.getState().selection };
    }, c);
  const before = await route();
  expect(before.pts).toHaveLength(5);
  const mid = { x: before.pts[1].x, y: (before.pts[1].y + before.pts[2].y) / 2 };

  // 單擊只選取，不改路線
  await page.mouse.click(canvas.x + mid.x, canvas.y + mid.y);
  await expect.poll(async () => (await route()).selection).toEqual([c]);
  await page.evaluate(() => (window as any).__tcEditor.select([]));
  const wp0 = (await boardObjects(page)).find((o) => o.id === c)!.waypoints;

  // 往右拖 90px：垂直段跟著移動並留在新位置
  await page.mouse.move(canvas.x + mid.x, canvas.y + mid.y);
  await page.mouse.down();
  await page.mouse.move(canvas.x + mid.x + 45, canvas.y + mid.y, { steps: 3 });
  await page.mouse.move(canvas.x + mid.x + 90, canvas.y + mid.y, { steps: 3 });
  await page.mouse.up();
  const after = await route();
  expect(Math.abs(after.pts[1].x - (before.pts[1].x + 90))).toBeLessThanOrEqual(5 * after.zoom + 1);
  expect(after.pts[2].x).toBeCloseTo(after.pts[1].x, 3);
  const conn = (await boardObjects(page)).find((o) => o.id === c)!;
  expect(conn.waypoints).not.toEqual(wp0);
  expect(conn.from.anchor).toBe('right');
  expect(conn.to.anchor).toBe('top');
});

// 拖曳中間線段對齊相鄰的平行線段：共線的線段合併（四段變兩段），控制點跟著更新，另一個分頁一致
test('拖曳線段對齊後合併成較少的線段', async ({ page, context }) => {
  await createUserAndLogin(page, 'segmerge');
  const fileId = await newBoard(page);
  const other = await context.newPage();
  await other.goto(`/b/${fileId}`);
  await waitForEditor(other);
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  // a 右邊 → 往右 → 往上繞一個小彎 → 往右 → 往下接到 b 上緣（四段）
  const c = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 120, h: 70 }, { atViewportCenter: true });
    const o = ed.doc.getMap('objects').get(a);
    const x = o.get('x');
    const y = o.get('y');
    const b = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: x + 240, y: y + 180, w: 120, h: 70 });
    const c = ed.insert({ type: 'connector', x: 0, y: 0, w: 1, h: 1, routing: 'orthogonal', from: { objectId: a, anchor: { u: 1, v: 0.37 } }, to: { objectId: b, anchor: 'top' }, waypoints: [{ x: x + 230, y: y + 26 }, { x: x + 230, y: y - 30 }, { x: x + 300, y: y - 30 }] });
    ed.select([c]);
    return c as string;
  });
  const route = () =>
    page.evaluate((id) => {
      const ed = (window as any).__tcEditor;
      return ed.model.routes.get(ed.model.store.get(id)).points.map((p: any) => ed.worldToScreen(p));
    }, c);
  const before = await route();
  expect(before).toHaveLength(5);
  // 拖曳上方的水平短段，放在第一段附近（差幾個像素）
  const mid = { x: (before[2].x + before[3].x) / 2, y: before[2].y };
  await page.mouse.move(canvas.x + mid.x, canvas.y + mid.y);
  await page.mouse.down();
  await page.mouse.move(canvas.x + mid.x, canvas.y + mid.y + 20, { steps: 3 });
  await page.mouse.move(canvas.x + mid.x, canvas.y + before[0].y - 4, { steps: 3 });
  await page.mouse.up();

  const after = await route();
  expect(after).toHaveLength(3);
  expect(after[1].y).toBeCloseTo(after[0].y, 3);
  expect(after[2].x).toBeCloseTo(after[1].x, 3);
  // 剩下的路線沒有中間線段，控制點也跟著消失
  await expect.poll(async () => (await boardObjects(other)).find((o) => o.id === c)!.waypoints).toEqual([]);
});
