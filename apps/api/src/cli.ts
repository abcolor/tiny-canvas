import 'reflect-metadata';
import { runCli } from './cli/run';

// 帳號管理與每日排程 CLI（見 SPEC.md 第 5.1、11.6 節）；不啟動 HTTP 伺服器
runCli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`錯誤：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
