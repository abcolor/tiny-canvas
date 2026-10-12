import { defineConfig, devices } from '@playwright/test';

// E2E：在獨立的資料庫（tinycanvas_e2e）與埠上啟動 api、sync、web
const WEB_PORT = 5373;
const API_PORT = 3100;
const SYNC_PORT = 4100;
const env = {
  DATABASE_URL: 'postgresql://tinycanvas:tinycanvas@localhost:54329/tinycanvas_e2e',
  PUBLIC_URL: `http://localhost:${WEB_PORT}`,
  STORAGE_LOCAL_DIR: '.data/e2e-files',
  ALLOW_SIGNUP: 'false',
  LOG_LEVEL: 'warn',
  // 整套 E2E 在一分鐘內會登入超過 10 次；正式環境維持預設的每分鐘 10 次
  LOGIN_RATE_LIMIT: '1000',
  WEB_PORT: String(WEB_PORT),
  API_PORT: String(API_PORT),
  SYNC_PORT: String(SYNC_PORT),
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    locale: 'zh-TW',
    // 介面預設英文；既有 E2E 以中文介面文字定位元素，所以預設寫入中文語系（i18n.spec.ts 會清掉）
    storageState: {
      cookies: [],
      origins: [{ origin: `http://localhost:${WEB_PORT}`, localStorage: [{ name: 'tc:locale', value: 'zh-TW' }] }],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: './e2e/global-setup.ts',
  webServer: [
    {
      command: 'pnpm --filter @tinycanvas/api dev',
      url: `http://localhost:${API_PORT}/api/healthz`,
      env: { ...env, PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @tinycanvas/sync dev',
      url: `http://localhost:${SYNC_PORT}/healthz`,
      env: { ...env, PORT: String(SYNC_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @tinycanvas/web dev',
      url: `http://localhost:${WEB_PORT}`,
      env,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
