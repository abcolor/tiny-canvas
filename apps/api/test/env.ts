import fs from 'node:fs';
import path from 'node:path';

/** 讀取 repo 根目錄的 dev.env，並把 DATABASE_URL 換成測試資料庫 */
export function loadTestEnv(): Record<string, string> {
  const file = path.resolve(__dirname, '../../../dev.env');
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  const testUrl = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL is not set');
  env.DATABASE_URL = testUrl;
  return env;
}
