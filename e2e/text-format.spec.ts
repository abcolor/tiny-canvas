import { expect, test, type Page } from '@playwright/test';
import { boardObjects, createUserAndLogin, MOD, newBoard } from './helpers';

// 文字格式（SPEC.md 第 4.3 節）
async function shapeWithText(page: Page, text: string) {
  return page.evaluate((t) => {
    const ed = (window as any).__tcEditor;
    const id = ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 0, y: 0, w: 260, h: 140, text: t }, { atViewportCenter: true });
    ed.select([id]);
    return id as string;
  }, text);
}
const textXml = async (page: Page, id: string) => (await boardObjects(page)).find((o) => o.id === id)!.text as string;

test('只選取物件時：字級、粗體、更多格式、段落樣式套用到整段文字', async ({ page }) => {
  await createUserAndLogin(page, 'textobj');
  await newBoard(page);
  const id = await shapeWithText(page, '第一項\n第二項');
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });

  // 字級：預設 S，+ 兩次 → M → L（20），− 一次 → M（16），從選單直接選 3XL（40）
  await expect(bar.getByTestId('font-size')).toHaveText('S');
  await bar.getByRole('button', { name: '放大文字' }).click();
  await bar.getByRole('button', { name: '放大文字' }).click();
  await expect(bar.getByTestId('font-size')).toHaveText('L');
  expect((await boardObjects(page)).find((o) => o.id === id)!.style.fontSize).toBe(20);
  await bar.getByRole('button', { name: '縮小文字' }).click();
  await expect(bar.getByTestId('font-size')).toHaveText('M');
  await bar.getByTestId('font-size').click();
  await page.getByRole('menuitemcheckbox', { name: /3XL/ }).click();
  await expect.poll(async () => (await boardObjects(page)).find((o) => o.id === id)!.style.fontSize).toBe(40);

  // 粗體
  await bar.getByRole('button', { name: '粗體' }).click();
  await expect.poll(() => textXml(page, id)).toContain('<bold>第一項</bold>');
  await expect(bar.getByRole('button', { name: '粗體' })).toHaveAttribute('aria-pressed', 'true');

  // 更多格式：刪除線
  await bar.getByRole('button', { name: '更多文字格式' }).click();
  await page.getByRole('menuitemcheckbox', { name: /刪除線/ }).click();
  await expect.poll(() => textXml(page, id)).toContain('strike');

  // 段落樣式：核取清單
  await bar.getByTestId('block-type').click();
  await page.getByRole('menuitem', { name: /核取清單/ }).click();
  await expect.poll(async () => (await textXml(page, id)).toLowerCase()).toContain('<tasklist>');

  // 一次 Mod+Z 還原段落樣式
  await page.evaluate(() => (window as any).__tcEditor.focus());
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => (await textXml(page, id)).toLowerCase()).not.toContain('<tasklist>');
  expect(await textXml(page, id)).toContain('strike');
});

test('編輯中：快捷鍵作用於選取的文字，Markdown 快速輸入', async ({ page }) => {
  await createUserAndLogin(page, 'textedit');
  await newBoard(page);
  const id = await shapeWithText(page, '');
  await page.evaluate(() => (window as any).__tcEditor.focus());
  await page.keyboard.press('Enter');
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeFocused();

  await page.keyboard.type('# 標題');
  await page.keyboard.press('Enter');
  await page.keyboard.type('* 項目');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] 待辦');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('重點文字');
  // 選取「重點文字」後螢光標記
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
  // ProseMirror 在瀏覽器非同步的 selectionchange 事件後才更新選取範圍
  await page.waitForTimeout(100);
  await page.keyboard.press(`${MOD}+Shift+h`);
  await page.keyboard.press('Escape');

  const xml = await textXml(page, id);
  expect(xml).toContain('<heading level="1">標題</heading>');
  // Y.XmlElement.toString() 會把節點名稱轉成小寫
  expect(xml).toMatch(/<bulletList><listItem><paragraph>項目<\/paragraph>/i);
  expect(xml).toMatch(/<taskList><taskItem checked="false"><paragraph>待辦<\/paragraph>/i);
  expect(xml).toContain('<highlight>重點文字</highlight>');
});

test('文字物件的工具列沒有邊框顏色，形狀有', async ({ page }) => {
  await createUserAndLogin(page, 'nostroke');
  await newBoard(page);
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    ed.select([ed.insert({ type: 'text', x: 0, y: 0, w: 120, h: 20, text: '文字' }, { atViewportCenter: true })]);
  });
  await expect(bar.getByTestId('font-size')).toBeVisible();
  await expect(bar.getByRole('button', { name: '邊框', exact: true })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: '顏色', exact: true })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: '文字顏色' })).toBeVisible();
  // 第一個子元素不是分隔線
  expect(await bar.evaluate((el) => (el.firstElementChild as HTMLElement).className.includes('w-px'))).toBe(false);

  await page.evaluate(() => {
    const ed = (window as any).__tcEditor;
    ed.select([ed.insert({ type: 'shape', shapeKind: 'rectangle', x: 300, y: 0, w: 120, h: 60 })]);
  });
  await expect(bar.getByRole('button', { name: '顏色', exact: true })).toBeVisible();
});

// 文字顏色：白色與兩種較深的灰另外指定文字色，其他顏色使用外框色（DECISIONS.md 2026-10-15）
test('文字顏色選單：白色、灰色與深灰使用指定的文字色', async ({ page }) => {
  await createUserAndLogin(page, 'textcolor');
  await newBoard(page);
  const id = await shapeWithText(page, '文字');
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  const color = async () => (await boardObjects(page)).find((o) => o.id === id)!.style.textColor;
  for (const [name, expected] of [
    ['白色', '#ffffff'],
    ['灰色', '#7c8796'],
    ['深灰', '#2c3743'],
    ['藍色', '#4685d1'],
  ] as const) {
    await bar.getByRole('button', { name: '文字顏色' }).click();
    await page.getByRole('listbox', { name: '文字顏色' }).getByRole('option', { name, exact: true }).click();
    await expect.poll(color).toBe(expected);
    await page.keyboard.press('Escape');
  }
});

// 用文字工具加入的文字預設為最深的灰色（DECISIONS.md 2026-10-15）
test('加入文字時預設為最深的灰色', async ({ page }) => {
  await createUserAndLogin(page, 'textdefault');
  await newBoard(page);
  const canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  await page.getByTestId('board-canvas').click({ position: { x: 400, y: 300 } });
  await page.keyboard.press('t');
  await page.mouse.click(canvas.x + 300, canvas.y + 250);
  await page.keyboard.type('預設顏色');
  await page.keyboard.press('Escape');
  const t = (await boardObjects(page)).find((o) => o.type === 'text')!;
  expect(t.style?.textColor).toBeUndefined();
  expect(await page.evaluate(() => (window as any).__tcEditor.getState().selection)).toEqual([t.id]);
  const bar = page.getByRole('toolbar', { name: '樣式工具列' });
  await bar.getByRole('button', { name: '文字顏色' }).click();
  await expect(page.getByRole('listbox', { name: '文字顏色' }).getByRole('option', { name: '深灰', exact: true })).toHaveAttribute('aria-selected', 'true');
});
