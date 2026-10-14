import { expect, test, type Page } from '@playwright/test';
import { boardObjects, createUserAndLogin, newBoard } from './helpers';

// 連接點（SPEC.md 第 3.4 節）：指標靠近形狀外框時出現沿邊跟隨的圓點，可從外框任一點拉出連線
async function setup(page: Page, prefix: string) {
  await createUserAndLogin(page, prefix);
  await newBoard(page);
  const ids = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 200, h: 100 }, { atViewportCenter: true });
    const o = ed.doc.getMap('objects').get(a);
    const b = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: o.get('x'), y: o.get('y') + 300, w: 200, h: 100 });
    ed.clearSelection();
    return { a, b };
  });
  const box = (await page.getByTestId('board-canvas').boundingBox())!;
  const r = await page.evaluate((i) => (window as any).__tcEditor.getObjectScreenRect(i), ids.a);
  const center = { x: box.x + r.x + r.w / 2, y: box.y + r.y + r.h / 2 };
  // 右邊上方 1/4 處（任意點，不吸附中點）、上邊中點外側一點點（懸停時外框內外 2 px 內才出現連接點）
  const rightDot = { x: box.x + r.x + r.w + 1, y: box.y + r.y + r.h / 4 };
  const topDot = { x: center.x, y: box.y + r.y - 1 };
  const rb = await page.evaluate((i) => (window as any).__tcEditor.getObjectScreenRect(i), ids.b);
  const bCenter = { x: box.x + rb.x + rb.w / 2, y: box.y + rb.y + rb.h / 2 };
  return { ids, center, rightDot, topDot, bCenter, bLeft: box.x + rb.x, bTop: box.y + rb.y, bW: rb.w, right: box.x + r.x + r.w };
}

/** 從形狀中央移到外框附近 */
async function hoverDot(page: Page, center: { x: number; y: number }, dot: { x: number; y: number }) {
  await page.mouse.move(center.x, center.y);
  await page.mouse.move(dot.x, dot.y, { steps: 10 });
  await expect.poll(() => page.evaluate(() => (document.querySelector('[data-tinycanvas="board"]') as HTMLElement).style.cursor)).toBe('crosshair');
}

test('在外框上單擊不拖曳：只選取形狀，不建立連線', async ({ page }) => {
  const s = await setup(page, 'dotclick');
  await hoverDot(page, s.center, s.rightDot);
  await page.mouse.down();
  await page.mouse.up();
  const objs = await boardObjects(page);
  expect(objs.some((o) => o.type === 'connector')).toBe(false);
  await expect.poll(() => page.evaluate(() => (window as any).__tcEditor.getState().selection)).toEqual([s.ids.a]);
});

test('從外框任意點拖到另一個形狀的外框：兩端固定在該點', async ({ page }) => {
  const s = await setup(page, 'dotany');
  await hoverDot(page, s.center, s.rightDot);
  await page.mouse.down();
  await page.mouse.move(s.rightDot.x + 60, s.rightDot.y, { steps: 5 });
  // 目標形狀上邊、從左算起 1/4 處
  await page.mouse.move(s.bLeft + s.bW / 4, s.bTop + 2, { steps: 10 });
  await page.mouse.up();
  const conn = (await boardObjects(page)).find((o) => o.type === 'connector')!;
  expect(conn.from.objectId).toBe(s.ids.a);
  expect(conn.from.anchor.u).toBeCloseTo(1, 1);
  expect(conn.from.anchor.v).toBeCloseTo(0.25, 1);
  expect(conn.to.objectId).toBe(s.ids.b);
  expect(conn.to.anchor.u).toBeCloseTo(0.25, 1);
  expect(conn.to.anchor.v).toBeCloseTo(0, 1);
});

test('從上邊中點拖到另一個形狀內部：起點吸附為中點，終點自動選邊', async ({ page }) => {
  const s = await setup(page, 'dotdrag');
  await hoverDot(page, s.center, s.topDot);
  await page.mouse.down();
  await page.mouse.move(s.topDot.x, s.topDot.y - 60, { steps: 5 });
  await page.mouse.move(s.bCenter.x, s.bCenter.y, { steps: 10 });
  await page.mouse.up();
  const conn = (await boardObjects(page)).find((o) => o.type === 'connector')!;
  expect(conn.from).toMatchObject({ objectId: s.ids.a, anchor: 'top' });
  expect(conn.to).toMatchObject({ objectId: s.ids.b, anchor: null });
});

test('從連接點拖到空白處：出現快速選單，選擇後建立形狀與連線', async ({ page }) => {
  const s = await setup(page, 'dotquick');
  await hoverDot(page, s.center, s.rightDot);
  await page.mouse.down();
  await page.mouse.move(s.rightDot.x + 100, s.rightDot.y, { steps: 5 });
  await page.mouse.move(s.rightDot.x + 220, s.rightDot.y - 20, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('建立下一個形狀')).toBeVisible();
  await page.getByRole('button', { name: '菱形（決策）' }).click();
  const objs = await boardObjects(page);
  const diamond = objs.find((o) => o.shapeKind === 'diamond')!;
  expect(diamond).toBeTruthy();
  const conn = objs.find((o) => o.type === 'connector')!;
  expect(conn.from.objectId).toBe(s.ids.a);
  expect(conn.to.objectId).toBe(diamond.id);
});

// 懸停時只在外框內外約 2 px 內出現連接點，避免一靠近物件就吸附（DECISIONS.md 2026-10-14）
test('懸停：外框內外 2 px 內才出現連接點', async ({ page }) => {
  const s = await setup(page, 'dotrange');
  const cursor = () => page.evaluate(() => (document.querySelector('[data-tinycanvas="board"]') as HTMLElement).style.cursor);
  const y = s.rightDot.y;
  await page.mouse.move(s.center.x, s.center.y);
  // 外側 6 px、內側 6 px：沒有連接點
  await page.mouse.move(s.right + 6, y, { steps: 5 });
  expect(await cursor()).not.toBe('crosshair');
  await page.mouse.move(s.right - 6, y, { steps: 5 });
  expect(await cursor()).not.toBe('crosshair');
  // 外框上、外側 2 px：出現連接點
  await page.mouse.move(s.right, y, { steps: 3 });
  await expect.poll(cursor).toBe('crosshair');
  await page.mouse.move(s.right + 2, y, { steps: 2 });
  await expect.poll(cursor).toBe('crosshair');
});
