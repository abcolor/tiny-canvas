// 所有介面文字集中在 i18n/ 底下的字典（見 SPEC.md 第 4.7 節）；這裡依目前語系選出一份。
// 語系在頁面載入時決定一次，切換語言會重新載入頁面，所以元件可以直接讀取 `strings`。
import { en, type Strings } from './i18n/en';
import { zhTW } from './i18n/zh-TW';
import { readLocale, type Locale } from './i18n/locale';

export type { Strings };
export const dictionaries: Record<Locale, Strings> = { en, 'zh-TW': zhTW };

export const locale: Locale = readLocale();
export const strings: Strings = dictionaries[locale];

/** 以 {name} 佔位符組字串 */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''));
}

/** 語言選單顯示的名稱：一律以該語言本身書寫，不隨介面語系變動 */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', 'zh-TW': '中文' };
