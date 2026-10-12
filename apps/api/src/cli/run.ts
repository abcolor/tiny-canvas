import { parseArgs } from 'node:util';
import { createPrisma } from '@tinycanvas/db';
import { loadConfig } from '../config';
import { createLogger } from '../common/logger';
import { DailyService } from '../daily/daily.service';
import { PrismaService } from '../prisma.service';
import { CliError, createUser, resetPassword } from './commands';
import { readPassword } from './prompt';

const USAGE = `用法：
  node dist/cli.js create-user --email <email> [--password <密碼>]
  node dist/cli.js reset-password --email <email> [--password <密碼>]
  node dist/cli.js run-daily [--now <ISO 時間>]
未提供 --password 時，從標準輸入讀取密碼。`;

async function askPassword(confirm: boolean): Promise<string> {
  const pw = await readPassword('請輸入密碼：');
  if (confirm && process.stdin.isTTY) {
    const again = await readPassword('請再次輸入密碼：');
    if (again !== pw) throw new CliError('兩次輸入的密碼不一致');
  }
  return pw;
}

/** CLI 進入點；回傳 exit code */
export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  let values: { email?: string; password?: string; now?: string };
  try {
    values = parseArgs({
      args: rest,
      options: { email: { type: 'string' }, password: { type: 'string' }, now: { type: 'string' } },
      strict: true,
    }).values;
  } catch {
    console.error(USAGE);
    return 2;
  }
  if (command !== 'create-user' && command !== 'reset-password' && command !== 'run-daily') {
    console.error(USAGE);
    return 2;
  }
  const prisma = createPrisma();
  try {
    if (command === 'run-daily') {
      const now = values.now ? new Date(values.now) : new Date();
      if (Number.isNaN(now.getTime())) throw new CliError('--now 不是有效的 ISO 時間');
      const config = loadConfig();
      const daily = new DailyService(config, prisma as PrismaService, createLogger('warn'));
      const r = await daily.run(now);
      console.log(
        `每日排程完成：檔案 ${r.files}、資料夾 ${r.folders}、版本 ${r.versions}、圖片 ${r.assets}、Session ${r.sessions}`,
      );
      return 0;
    }
    if (!values.email) throw new CliError('請以 --email 指定帳號');
    const password = values.password ?? (await askPassword(command === 'create-user' || command === 'reset-password'));
    if (command === 'create-user') {
      const user = await createUser(prisma, values.email, password);
      console.log(`已建立帳號：${user.email}`);
    } else {
      const user = await resetPassword(prisma, values.email, password);
      console.log(`已重設密碼並登出所有裝置：${user.email}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof CliError) console.error(`錯誤：${err.message}`);
    else console.error(`錯誤：${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}
