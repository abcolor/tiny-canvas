import { expect, test } from '@playwright/test';
import { addShapeByClick, boardObjects, createUserAndLogin, newBoard } from './helpers';

// 中文輸入法組字（見 SPEC.md 第 9、10.2 節）：以 Chrome DevTools Protocol 模擬注音與倉頡的組字過程
test('注音與倉頡組字：組字中不觸發畫布快捷鍵，確認後文字只出現一次', async ({ page }) => {
  await createUserAndLogin(page, 'ime');
  await newBoard(page);
  await addShapeByClick(page, 'r', 300, 260);
  await expect.poll(async () => (await boardObjects(page)).length).toBe(1);
  await page.keyboard.press('Enter');
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeFocused();

  const cdp = await page.context().newCDPSession(page);
  const compose = async (steps: string[], commit: string) => {
    for (const s of steps) {
      await cdp.send('Input.imeSetComposition', { text: s, selectionStart: s.length, selectionEnd: s.length });
    }
    await cdp.send('Input.insertText', { text: commit });
  };

  // 注音：ㄓ → ㄓㄨ → ㄓㄨˋ → 注；ㄧ → ㄧㄣ → 音
  await compose(['ㄓ', 'ㄓㄨ', 'ㄓㄨˋ'], '注');
  await compose(['ㄧ', 'ㄧㄣ'], '音');
  // 倉頡：組字碼包含 r、o、t 等英文字母鍵，組字期間不可被當成畫布快捷鍵（R 矩形、O 圓形、T 文字）
  await compose(['卜', '卜口', '卜口竹'], '輸');
  await compose(['口', '口卜'], '入');

  await expect(editor).toHaveText('注音輸入');
  await page.keyboard.press('Escape');
  await expect.poll(async () => JSON.stringify(await boardObjects(page))).toContain('注音輸入');
  // 只有原本那一個形狀，組字沒有誤觸建立其他物件
  expect((await boardObjects(page)).length).toBe(1);
});
