import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadTestEnv } from './env';

/** 確保測試資料庫已套用所有遷移 */
export default function setup() {
  const env = loadTestEnv();
  const dbDir = path.resolve(__dirname, '../../../packages/db');
  execFileSync(path.join(dbDir, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: dbDir,
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    stdio: 'pipe',
  });
}
