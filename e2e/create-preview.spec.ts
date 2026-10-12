import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, newBoard } from './helpers';

// 以形狀工具拖曳建立時，預覽就是選擇的形狀，位置尺寸與放開後建立的形狀相同；預覽期間不寫入文件
test('拖曳建立形狀時預覽為選擇的形狀', async ({ page }) => {
  await createUserAndLogin(page, 'createpreview');
  await newBoard(page);
  await page.evaluate(() => (window as any).__tcEditor.setTool({ kind: 'shape', shapeKind: 'diamond' }));
  const c = (await page.getByTestId('board-canvas').boundingBox())!;
  await page.mouse.move(c.x + 300, c.y + 300);
  await page.mouse.down();
  await page.mouse.move(c.x + 480, c.y + 420, { steps: 6 });
  const preview = await page.evaluate(() => (window as any).__tcEditor.createPreview());
  expect(preview).toMatchObject({ type: 'shape', shapeKind: 'diamond' });
  expect(await boardObjects(page)).toHaveLength(0);
  // 右下角標示寬 × 高
  const label = await page.evaluate(() => (window as any).__tcEditor.sizeLabel());
  expect({ w: label.w, h: label.h }).toEqual({ w: preview.w, h: preview.h });
  await page.mouse.up();
  const [o] = await boardObjects(page);
  expect({ x: o.x, y: o.y, w: o.w, h: o.h, shapeKind: o.shapeKind }).toEqual({ x: preview.x, y: preview.y, w: preview.w, h: preview.h, shapeKind: 'diamond' });
  expect(await page.evaluate(() => (window as any).__tcEditor.createPreview())).toBeNull();
});

test('縮放時右下角標示寬 × 高', async ({ page }) => {
  await createUserAndLogin(page, 'resizelabel');
  await newBoard(page);
  const id = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 160, h: 80 }, { atViewportCenter: true });
    ed.select([a]);
    return a as string;
  });
  const c = (await page.getByTestId('board-canvas').boundingBox())!;
  const r = await page.evaluate((a) => (window as any).__tcEditor.getObjectScreenRect(a), id);
  await page.mouse.move(c.x + r.x + r.w, c.y + r.y + r.h);
  await page.mouse.down();
  await page.mouse.move(c.x + r.x + r.w + 60, c.y + r.y + r.h + 30, { steps: 6 });
  const label = await page.evaluate(() => (window as any).__tcEditor.sizeLabel());
  await page.mouse.up();
  const o = (await boardObjects(page)).find((x) => x.id === id)!;
  expect({ w: label.w, h: label.h }).toEqual({ w: o.w, h: o.h });
  expect(o.w).toBeGreaterThan(160);
  expect(await page.evaluate(() => (window as any).__tcEditor.sizeLabel())).toBeNull();
});
