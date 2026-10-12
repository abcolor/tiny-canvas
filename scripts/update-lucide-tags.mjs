#!/usr/bin/env node
// 從與 lucide-react 同版本的 lucide-static 抽出圖示標籤（tags.json），
// 產生圖示庫搜尋用的 apps/web/src/board/lucide-tags.json。
// 升級 lucide-react 後執行：node scripts/update-lucide-tags.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webPkg = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8'));
const version = webPkg.dependencies['lucide-react'];
const out = join(root, 'apps/web/src/board/lucide-tags.json');

const dir = mkdtempSync(join(tmpdir(), 'lucide-static-'));
try {
  const file = execFileSync('npm', ['pack', `lucide-static@${version}`, '--silent'], { cwd: dir, encoding: 'utf8' }).trim();
  execFileSync('tar', ['xzf', file, 'package/tags.json'], { cwd: dir });
  const tags = JSON.parse(readFileSync(join(dir, 'package/tags.json'), 'utf8'));

  // 與 lucide-react 的元件命名相同：kebab-case → PascalCase（arrow-down-0-1 → ArrowDown01）
  const toPascal = (s) => s.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  const require = createRequire(join(root, 'apps/web/package.json'));
  const { icons } = require('lucide-react');
  const result = {};
  const missing = [];
  for (const [name, list] of Object.entries(tags)) {
    const pascal = toPascal(name);
    if (!(pascal in icons)) {
      missing.push(name);
      continue;
    }
    // 以空白連接，縮小檔案；搜尋時以子字串比對
    result[pascal] = list.join(' | ');
  }
  writeFileSync(out, JSON.stringify(result) + '\n');
  console.log(`lucide-static@${version}: ${Object.keys(result).length} 個圖示寫入 ${out}`);
  if (missing.length) console.warn(`lucide-react 找不到 ${missing.length} 個：${missing.join(', ')}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
