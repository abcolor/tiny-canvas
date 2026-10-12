// 介面語系：預設英文，使用者在語言選單切換後存在 localStorage，重新載入頁面套用（見 DECISIONS.md）。
export const LOCALES = ['en', 'zh-TW'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'tc:locale';

/** Intl API 使用的語系代碼 */
export const INTL_LOCALE: Record<Locale, string> = { en: 'en', 'zh-TW': 'zh-Hant' };
/** <html lang> 使用的語系代碼 */
export const HTML_LANG: Record<Locale, string> = { en: 'en', 'zh-TW': 'zh-Hant-TW' };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** 讀取已儲存的語系；沒有、無效或無法讀取 localStorage 時回傳預設英文 */
export function readLocale(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Locale {
  try {
    const v = storage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(v) ? v : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** 儲存語系並重新載入頁面，讓所有模組以新語系重新取得字串 */
export function setLocale(locale: Locale): void {
  try {
    safeStorage()?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // 無法寫入時（私密模式等）仍重新載入，維持目前語系
  }
  globalThis.location?.reload();
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
