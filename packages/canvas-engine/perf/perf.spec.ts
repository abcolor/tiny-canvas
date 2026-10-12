import { expect, test } from '@playwright/test';

// p95 單幀繪製時間：5,000 物件 < 16 ms（60 fps）；20,000 物件 < 33 ms（30 fps）（見 SPEC.md 第 3.6、9 節）
const SCENARIOS = [
  { n: 5000, budget: 16 },
  { n: 20000, budget: 33 },
];

for (const s of SCENARIOS) {
  test(`${s.n} objects: p95 draw < ${s.budget}ms`, async ({ page }) => {
    await page.goto('http://localhost:5191/');
    await page.waitForFunction(() => (window as any).__perf);
    const gpu = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    const result = await page.evaluate((n) => (window as any).__perf.run(n), s.n);
    console.log(JSON.stringify({ scenario: s.n, budgetMs: s.budget, gpu, ...result }, null, 2));
    expect(result.objects).toBe(s.n);
    expect(result.drawP95).toBeLessThan(s.budget);
  });
}
