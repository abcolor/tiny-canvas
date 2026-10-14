import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, newBoard } from './helpers';

// 對齊參考線：調整大小時移動中的邊吸到附近物件、移動時多側同時顯示（DECISIONS.md 2026-10-13）
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

// 移動時同一個方向有多條線對齊（例如同寬物件的左、中、右）時，全部顯示參考線
test('移動形狀時多側同時顯示參考線', async ({ page }) => {
  await createUserAndLogin(page, 'moveguides');
  await newBoard(page);
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  const { a, bx } = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 120, h: 70 }, { atViewportCenter: true });
    const o = ed.doc.getMap('objects').get(a);
    // 同寬、在正下方，左邊刻意不在格線上
    const bx = o.get('x') + 3;
    ed.insert({ type: 'shape', shapeKind: 'rectangle', x: bx, y: o.get('y') + 200, w: 120, h: 60 });
    ed.select([a]);
    return { a, bx };
  });
  const toScreen = (p: { x: number; y: number }) =>
    page.evaluate((q) => (window as any).__tcEditor.worldToScreen(q), p).then((s) => ({ x: canvas.x + s.x, y: canvas.y + s.y }));
  const before = (await boardObjects(page)).find((o) => o.id === a)!;
  const start = await toScreen({ x: before.x + before.w / 2, y: before.y + before.h / 2 });
  const end = await toScreen({ x: before.x + before.w / 2 + 2, y: before.y + before.h / 2 + 20 });

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  const xs = (await page.evaluate(() => (window as any).__tcEditor.guides))
    .filter((g: { axis: string }) => g.axis === 'x')
    .map((g: { pos: number }) => g.pos)
    .sort((p: number, q: number) => p - q);
  expect(xs).toEqual([bx, bx + 60, bx + 120]);
  await page.mouse.up();

  const after = (await boardObjects(page)).find((o) => o.id === a)!;
  expect(after.x).toBeCloseTo(bx, 6);
});

// 移動時的等距提示：與鄰居的間距等於鄰居與上一個物件的間距時吸附並顯示（DECISIONS.md 2026-10-14）
test('移動形狀時顯示等距提示並吸附', async ({ page }) => {
  await createUserAndLogin(page, 'gapguides');
  await newBoard(page);
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  const { c, top } = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 200, h: 70 }, { atViewportCenter: true });
    const o = ed.doc.getMap('objects').get(a);
    const x = o.get('x');
    const y = o.get('y');
    // a、b 上下間距 40；c 在 b 下方 64
    ed.insert({ type: 'shape', shapeKind: 'rectangle', x, y: y + 110, w: 200, h: 70 });
    const c = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: x + 20, y: y + 244, w: 160, h: 60 });
    ed.select([c]);
    return { c, top: y };
  });
  const toScreen = (p: { x: number; y: number }) =>
    page.evaluate((q) => (window as any).__tcEditor.worldToScreen(q), p).then((s) => ({ x: canvas.x + s.x, y: canvas.y + s.y }));
  const before = (await boardObjects(page)).find((o) => o.id === c)!;
  const start = await toScreen({ x: before.x + before.w / 2, y: before.y + before.h / 2 });
  // 往上拖 22：與 b 的間距約 42，吸到 40
  const end = await toScreen({ x: before.x + before.w / 2, y: before.y + before.h / 2 - 22 });

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  const gaps = (await page.evaluate(() => (window as any).__tcEditor.guides))
    .filter((g: { gap?: boolean }) => g.gap)
    .map((g: { from: number; to: number }) => [g.from - top, g.to - top]);
  expect(gaps).toEqual([
    [180, 220],
    [70, 110],
  ]);
  await page.mouse.up();
  expect((await boardObjects(page)).find((o) => o.id === c)!.y).toBeCloseTo(top + 220, 6);
});

// 中心對齊線與等距提示線重疊時，等距提示線往右移開（DECISIONS.md 2026-10-14）
test('同寬置中排列時，等距提示線不被中心對齊線擋住', async ({ page }) => {
  await createUserAndLogin(page, 'gapoffset');
  await newBoard(page);
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  const { c, left } = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 200, h: 70 }, { atViewportCenter: true });
    const o = ed.doc.getMap('objects').get(a);
    const x = o.get('x');
    const y = o.get('y');
    ed.insert({ type: 'shape', shapeKind: 'rectangle', x, y: y + 110, w: 200, h: 70 });
    const c = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: x + 3, y: y + 244, w: 200, h: 70 });
    ed.select([c]);
    return { c, left: x };
  });
  const toScreen = (p: { x: number; y: number }) =>
    page.evaluate((q) => (window as any).__tcEditor.worldToScreen(q), p).then((s) => ({ x: canvas.x + s.x, y: canvas.y + s.y }));
  const before = (await boardObjects(page)).find((o) => o.id === c)!;
  const start = await toScreen({ x: before.x + before.w / 2, y: before.y + before.h / 2 });
  const end = await toScreen({ x: before.x + before.w / 2 - 2, y: before.y + before.h / 2 - 22 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  const { guides, zoom } = await page.evaluate(() => ({ guides: (window as any).__tcEditor.guides, zoom: (window as any).__tcEditor.getState().camera.zoom }));
  const center = left + 100;
  // 中心對齊線仍在中央
  expect(guides.some((g: any) => !g.gap && g.axis === 'x' && Math.abs(g.pos - center) < 1e-6)).toBe(true);
  // 等距提示線移到右邊 12 px（螢幕距離）
  const gaps = guides.filter((g: any) => g.gap);
  expect(gaps).toHaveLength(2);
  for (const g of gaps) expect(g.pos).toBeCloseTo(center + 12 / zoom, 6);
  await page.mouse.up();
});
