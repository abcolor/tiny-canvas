import { defineConfig } from '@playwright/test';

// 效能測試：必須以 headed Chromium（啟用 GPU）在開發機上執行（見 SPEC.md 第 3.6 節）
export default defineConfig({
  testDir: '.',
  testMatch: /perf\.spec\.ts$/,
  timeout: 300_000,
  workers: 1,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: false,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: Number(process.env.PERF_DPR ?? 1),
    launchOptions: {
      args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-zero-copy'],
    },
  },
  webServer: {
    command: 'vite --config perf/vite.config.ts',
    cwd: '..',
    url: 'http://localhost:5191',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
