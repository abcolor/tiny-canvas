import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export const isMac: boolean =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** 快捷鍵顯示用的 Mod 鍵名稱（macOS 為 ⌘，其他平台為 Ctrl） */
export const modLabel = isMac ? '⌘' : 'Ctrl';
export const altLabel = isMac ? '⌥' : 'Alt';
export const shiftLabel = isMac ? '⇧' : 'Shift';

/** 把 'Mod+Shift+Z' 轉成目前平台的顯示文字 */
export function shortcutLabel(combo: string): string {
  return combo
    .split('+')
    .map((k) => (k === 'Mod' ? modLabel : k === 'Alt' ? altLabel : k === 'Shift' ? shiftLabel : k))
    .join(isMac ? '' : '+');
}

/** 鍵盤事件是否按著 Mod 鍵 */
export function isMod(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}
