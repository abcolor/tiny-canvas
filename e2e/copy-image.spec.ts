import { expect, test } from '@playwright/test';
import { createUserAndLogin, newBoard } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

// 多選時工具列的「複製為圖片」：選取範圍畫成透明背景的 3x PNG 放進剪貼簿
test('多選時複製為圖片，剪貼簿裡是透明背景的 PNG', async ({ page }) => {
  await createUserAndLogin(page, 'copyimg');
  await newBoard(page);
  await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 100, h: 60, style: { fillMode: 'solid' } }, { atViewportCenter: true });
    const r = ed.getObjectScreenRect(a);
    const w = ed.screenToWorld({ x: r.x, y: r.y });
    const b = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: w.x + 200, y: w.y, w: 100, h: 60, style: { fillMode: 'solid' } });
    ed.select([a, b]);
  });
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  await bar.getByRole('button', { name: '複製為圖片' }).click();
  await expect(page.getByText('已複製為圖片，可以貼到其他軟體')).toBeVisible();

  const info = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const blob = await items[0].getType('image/png');
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const corner = ctx.getImageData(0, 0, 1, 1).data[3];
    const center = ctx.getImageData(Math.floor(bmp.width * 0.2), Math.floor(bmp.height / 2), 1, 1).data[3];
    return { types: items[0].types, w: bmp.width, h: bmp.height, corner, center };
  });
  expect(info.types).toContain('image/png');
  // 兩個形狀橫跨 300 × 60，加上四周 24 的留白，3x
  expect(info.w).toBeGreaterThanOrEqual(3 * (300 + 48) - 6);
  expect(info.h).toBeGreaterThanOrEqual(3 * (60 + 48) - 6);
  expect(info.corner).toBe(0);
  expect(info.center).toBe(255);
});

// 連線標籤超出線條範圍時，複製的圖片要包含整個標籤，不能被切掉（DECISIONS.md 2026-10-14）
test('複製為圖片時，連線上的長標籤不會被截斷', async ({ page }) => {
  await createUserAndLogin(page, 'copyimglabel');
  await newBoard(page);
  await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 100, h: 60, style: { fillMode: 'solid' } }, { atViewportCenter: true });
    const r = ed.getObjectScreenRect(a);
    const w = ed.screenToWorld({ x: r.x, y: r.y });
    const b = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: w.x, y: w.y + 200, w: 100, h: 60, style: { fillMode: 'solid' } });
    // 約 200 px 寬的標籤，比兩個形狀（100 px）寬很多
    const c = ed.insert({ type: 'connector', x: 0, y: 0, w: 1, h: 1, routing: 'straight', from: { objectId: a, anchor: 'bottom' }, to: { objectId: b, anchor: 'top' }, label: '這是一段比形狀寬很多的連線標籤' });
    ed.select([a, b, c]);
  });
  await page.getByRole('toolbar', { name: '樣式工具列' }).getByRole('button', { name: '複製為圖片' }).click();
  await expect(page.getByText('已複製為圖片，可以貼到其他軟體')).toBeVisible();

  const info = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const bmp = await createImageBitmap(await items[0].getType('image/png'));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    // 找出有內容的最左、最右欄
    let minX = bmp.width;
    let maxX = -1;
    for (let y = 0; y < bmp.height; y++) {
      for (let x = 0; x < bmp.width; x++) {
        if (data[(y * bmp.width + x) * 4 + 3] > 0) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    return { w: bmp.width, minX, maxX };
  });
  // 標籤比形狀寬：圖片寬度要大於只算形狀時的 3 × (100 + 48)
  expect(info.w).toBeGreaterThan(3 * (100 + 48) + 150);
  // 左右兩側都留有空白，表示標籤沒有被切到邊緣
  expect(info.minX).toBeGreaterThan(30);
  expect(info.w - 1 - info.maxX).toBeGreaterThan(30);
});
