import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { zhTW } from '../src/i18n/zh-TW';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, readLocale } from '../src/i18n/locale';
import { dictionaries, format, locale, strings } from '../src/strings';

type Tree = { [k: string]: unknown };

/** 攤平成「路徑 → 值」；陣列視為葉節點 */
function flatten(o: Tree, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of flatten(v as Tree, p)) out.set(k2, v2);
    else out.set(p, v);
  }
  return out;
}

const tokens = (s: string) => [...s.matchAll(/\{\w+\}|Mod\+\w+/g)].map((m) => m[0]).sort();

describe('介面語系字典', () => {
  const flatEn = flatten(en);
  const flatZh = flatten(zhTW);

  it('中英文字典的鍵完全相同（含 Record 型別的 colors、canvas.wireframe）', () => {
    expect([...flatZh.keys()].sort()).toEqual([...flatEn.keys()].sort());
  });

  it('每個值都不是空字串，陣列長度一致', () => {
    for (const [k, v] of flatEn) {
      const z = flatZh.get(k);
      if (Array.isArray(v)) expect((z as unknown[]).length, k).toBe(v.length);
      else {
        expect(typeof v, k).toBe('string');
        expect((v as string).length, k).toBeGreaterThan(0);
        expect((z as string).length, k).toBeGreaterThan(0);
      }
    }
  });

  it('佔位符與快捷鍵字樣在各語系一致', () => {
    for (const [k, v] of flatEn) {
      if (typeof v !== 'string') continue;
      expect(tokens(flatZh.get(k) as string), k).toEqual(tokens(v));
    }
  });

  it('英文字典不含中文字（語言名稱除外，不在字典內）', () => {
    for (const [k, v] of flatEn) {
      const text = Array.isArray(v) ? v.join(' ') : String(v);
      expect(/[一-鿿]/.test(text), k).toBe(false);
    }
  });

  it('format 代入佔位符', () => {
    expect(format(en.history.copyTitle, { title: 'Plan' })).toBe('Copy of Plan');
    expect(format(zhTW.history.copyTitle, { title: '規劃' })).toBe('規劃 的副本');
  });
});

describe('語系選擇', () => {
  const store = (v: string | null) => ({ getItem: (k: string) => (k === LOCALE_STORAGE_KEY ? v : null) });

  it('預設為英文', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(readLocale(store(null))).toBe('en');
    expect(readLocale(undefined)).toBe('en');
  });

  it('讀取已儲存的語系，無效值退回英文', () => {
    expect(readLocale(store('zh-TW'))).toBe('zh-TW');
    expect(readLocale(store('en'))).toBe('en');
    expect(readLocale(store('fr'))).toBe('en');
  });

  it('localStorage 讀取丟出例外時退回英文', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readLocale(throwing)).toBe('en');
  });

  it('沒有 localStorage 的環境（Node）使用英文字典', () => {
    expect(locale).toBe('en');
    expect(strings).toBe(dictionaries.en);
  });
});
