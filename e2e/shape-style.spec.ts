import { expect, test } from '@playwright/test';
import { boardObjects, createUserAndLogin, newBoard } from './helpers';

// 形狀外觀（SPEC.md 第 4.1 節）：矩形 / 圓角 / 圓形切換、整個填滿 / 只有外框 / 虛線外框、透明背景
test('形狀外觀控制項', async ({ page }) => {
  await createUserAndLogin(page, 'style');
  await newBoard(page);
  const id = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 200, h: 100 }, { atViewportCenter: true });
    ed.select([a]);
    return a;
  });
  const obj = async () => (await boardObjects(page)).find((o) => o.id === id)!;
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });

  // 矩形 → 圓角 → 圓形
  await bar.getByRole('radio', { name: '圓角矩形' }).click();
  await expect.poll(async () => (await obj()).shapeKind).toBe('rounded');
  await bar.getByRole('radio', { name: '圓形' }).click();
  await expect.poll(async () => (await obj()).shapeKind).toBe('ellipse');

  // 新形狀預設「只有外框、不透明背景」（DECISIONS.md 2026-10-15）
  await expect(bar.getByRole('radio', { name: '只有外框' })).toHaveAttribute('aria-checked', 'true');
  await expect(bar.getByRole('button', { name: '透明背景' })).toHaveAttribute('aria-pressed', 'false');
  expect((await obj()).style).toMatchObject({ fillMode: 'outline', transparent: false });
  await bar.getByRole('radio', { name: '整個填滿' }).click();
  await expect.poll(async () => (await obj()).style.fillMode).toBe('solid');
  // 整個填滿時透明開關停用
  await expect(bar.getByRole('button', { name: '透明背景' })).toBeDisabled();
  // 切到虛線外框時背景維持不透明
  await bar.getByRole('radio', { name: '虛線外框' }).click();
  await expect.poll(async () => (await obj()).style.fillMode).toBe('dashed');
  expect((await obj()).style.transparent).toBe(false);

  // 透明開關
  await bar.getByRole('button', { name: '透明背景' }).click();
  await expect.poll(async () => (await obj()).style.transparent).toBe(true);
  await bar.getByRole('button', { name: '透明背景' }).click();
  await expect.poll(async () => (await obj()).style.transparent).toBe(false);

  // 顏色
  await bar.getByRole('button', { name: '顏色', exact: true }).click();
  await page.getByRole('option', { name: '青綠' }).click();
  await expect.poll(async () => (await obj()).style.stroke).toBe('#7fc4bd');
  expect((await obj()).style.fillMode).toBe('dashed');

  // 一次復原只還原上一個操作
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as any).__tcEditor.focus());
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect.poll(async () => (await obj()).style.stroke).not.toBe('#7fc4bd');
});

test('浮動工具列不會超出畫布右側', async ({ page }) => {
  await createUserAndLogin(page, 'barclamp');
  await newBoard(page);
  await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const host = document.querySelector('[data-testid="board-canvas"]') as HTMLElement;
    const p = ed.screenToWorld({ x: host.clientWidth - 60, y: 300 });
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: p.x - 50, y: p.y, w: 100, h: 60 });
    ed.select([a]);
  });
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  await expect(bar).toBeVisible();
  const bb = (await bar.boundingBox())!;
  const cb = (await page.getByTestId('board-canvas').boundingBox())!;
  expect(bb.x + bb.width).toBeLessThanOrEqual(cb.x + cb.width);
  expect(bb.x).toBeGreaterThanOrEqual(cb.x);
});

test('顏色選擇器：15 個預設色與自訂顏色', async ({ page }) => {
  await createUserAndLogin(page, 'palette');
  await newBoard(page);
  await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    ed.select([ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 200, h: 100 }, { atViewportCenter: true })]);
  });
  await page.getByRole('toolbar', { name: '樣式工具列' }).getByRole('button', { name: '顏色', exact: true }).click();
  const list = page.getByRole('listbox', { name: '顏色' });
  await expect(list.getByRole('option')).toHaveCount(15);
  await expect(list.getByRole('button', { name: '自訂顏色' })).toBeVisible();
  const names = await list.getByRole('option').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(names).toEqual(['白色', '淺灰', '灰色', '深灰', '藍色', '靛藍', '紫色', '洋紅', '青綠', '深綠', '褐灰', '玫瑰褐', '紅色', '橘色', '黃色']);
  // 色塊顏色與使用者指定的色盤一致（DECISIONS.md 2026-10-15）
  const colors = await list.getByRole('option').evaluateAll((els) => els.map((e) => getComputedStyle(e.firstElementChild as Element).backgroundColor));
  const hex = (c: string) => '#' + c.match(/\d+/g)!.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  expect(colors.map(hex)).toEqual([
    '#FFFFFF', '#D7DDE4', '#A3ACB5', '#848E97',
    '#78AADE', '#938CF0', '#945BCE', '#C577DA',
    '#7FC4BD', '#63A09A', '#ABA391', '#B99796',
    '#D5838D', '#E5AC7F', '#F0D78F',
  ]);
  // 新形狀預設白色（第 1 列第 1 格）
  await expect(list.getByRole('option', { name: '白色' })).toHaveAttribute('aria-selected', 'true');
  // 白色與淺灰的外框色相同，選擇後仍能分辨
  const stroke = () => page.evaluate(() => { const ed = (window as any).__tcEditor; return ed.model.store.get(ed.getState().selection[0]).style.stroke; });
  await list.getByRole('option', { name: '淺灰' }).click();
  await expect.poll(stroke).toBe('#d7dde4');
  await expect(list.getByRole('option', { name: '淺灰' })).toHaveAttribute('aria-selected', 'true');
  await expect(list.getByRole('option', { name: '白色' })).toHaveAttribute('aria-selected', 'false');
  await list.getByRole('option', { name: '白色' }).click();
  await expect.poll(stroke).toBe('#ffffff');
  await expect(list.getByRole('option', { name: '白色' })).toHaveAttribute('aria-selected', 'true');
});

test('工具列：外面有「複製一份」，複製樣式、套用樣式、鎖定在「更多」裡', async ({ page }) => {
  await createUserAndLogin(page, 'toolbar');
  await newBoard(page);
  const ids = await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    const a = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 160, h: 80, style: { fillMode: 'solid', stroke: '#d5475b' } }, { atViewportCenter: true });
    const b = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 400, y: 300, w: 160, h: 80 });
    ed.select([a]);
    return { a, b };
  });
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  for (const name of ['複製樣式', '套用樣式', '鎖定']) await expect(bar.getByRole('button', { name, exact: true })).toHaveCount(0);

  // 複製一份：移到空白處點一下放置
  await bar.getByRole('button', { name: '複製一份' }).click();
  const cb = (await page.getByTestId('board-canvas').boundingBox())!;
  await page.mouse.move(cb.x + 150, cb.y + 560, { steps: 4 });
  await page.mouse.click(cb.x + 150, cb.y + 560);
  await expect.poll(async () => (await boardObjects(page)).filter((o) => o.type === 'shape').length).toBe(3);

  // 複製樣式 → 選另一個 → 套用樣式
  await page.evaluate((a) => (window as any).__tcEditor.select([a]), ids.a);
  await bar.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '複製樣式' }).click();
  await page.evaluate((b) => (window as any).__tcEditor.select([b]), ids.b);
  await bar.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '套用樣式' }).click();
  await expect.poll(async () => (await boardObjects(page)).find((o) => o.id === ids.b)!.style.stroke).toBe('#d5475b');

  // 鎖定
  await bar.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '鎖定' }).click();
  await expect.poll(async () => (await boardObjects(page)).find((o) => o.id === ids.b)!.locked).toBe(true);
  await bar.getByRole('button', { name: '更多', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '解除鎖定' })).toBeVisible();
});
