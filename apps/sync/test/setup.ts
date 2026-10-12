import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 從 repo 根目錄的 dev.env 讀取 SYNC_TEST_DATABASE_URL 等設定（已存在的環境變數優先）
const envFile = resolve(__dirname, '../../../dev.env');
if (!process.env.SYNC_TEST_DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.SYNC_TEST_DATABASE_URL) throw new Error('SYNC_TEST_DATABASE_URL is not set');
