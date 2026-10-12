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
