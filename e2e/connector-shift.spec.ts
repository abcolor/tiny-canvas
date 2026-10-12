import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, newBoard } from './helpers';

// 按住 Shift 拖曳連線端點或畫新連線時，角度限制為 0、45、90… 度
test('Shift 拖曳連線端點：角度吸到 45 度倍數', async ({ page }) => {
  await createUserAndLogin(page, 'shiftline');
  await newBoard(page);
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;

  // 兩端都懸空的直線
  const { id, from, to } = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const host = document.querySelector('[data-testid="board-canvas"]') as HTMLElement;
    const a = ed.screenToWorld({ x: host.clientWidth / 2 - 150, y: host.clientHeight / 2 });
    const id = ed.insert({ type: 'connector', x: 0, y: 0, w: 1, h: 1, routing: 'straight', from: { objectId: null, anchor: null, x: a.x, y: a.y }, to: { objectId: null, anchor: null, x: a.x + 200, y: a.y } });
    ed.select([id]);
    return { id, from: ed.worldToScreen(a), to: ed.worldToScreen({ x: a.x + 200, y: a.y }) };
  });
  const conn = async () => (await boardObjects(page)).find((o) => o.id === id)!;

  // 往右下拖到接近 45 度的位置
  await page.mouse.move(canvas.x + to.x, canvas.y + to.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(canvas.x + from.x + 150, canvas.y + from.y + 135, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  let c = await conn();
  expect(c.to.objectId).toBeNull();
  expect(c.to.x - c.from.x).toBeCloseTo(c.to.y - c.from.y, 3);
  expect(c.to.x).toBeGreaterThan(c.from.x);

  // 再拖到略高於水平的位置：吸成水平
  const end = await page.evaluate((cid) => {
    const ed = (window as any).__tcEditor;
    const o = ed.model.store.get(cid);
    return ed.worldToScreen({ x: o.to.x, y: o.to.y });
  }, id);
  await page.mouse.move(canvas.x + end.x, canvas.y + end.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(canvas.x + from.x + 220, canvas.y + from.y - 18, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  c = await conn();
  expect(c.to.y).toBeCloseTo(c.from.y, 3);
  expect(c.to.x).toBeGreaterThan(c.from.x + 150);
});

test('Shift 畫新連線：角度吸到 90 度', async ({ page }) => {
  await createUserAndLogin(page, 'shiftnew');
  await newBoard(page);
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  const sx = canvas.x + canvas.width / 2 - 100;
  const sy = canvas.y + canvas.height / 2 - 100;
  await page.mouse.click(sx - 200, sy - 100);
  await page.keyboard.press('l');
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(sx + 14, sy + 200, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const conns = (await boardObjects(page)).filter((o) => o.type === 'connector');
  expect(conns).toHaveLength(1);
  const c = conns[0];
  expect(c.to.x).toBeCloseTo(c.from.x, 3);
  expect(c.to.y).toBeGreaterThan(c.from.y + 150);
});
