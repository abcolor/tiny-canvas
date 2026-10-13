import { useEffect, useRef } from 'react';
import { isMod } from '@tinycanvas/ui';

export interface Hotkey {
  /** 例如 'Mod+K'、'Mod+Shift+E'、'/'、'W' */
  combo: string;
  handler: (e: KeyboardEvent) => void;
  /** 在輸入框或 contenteditable 內也觸發（預設 false） */
  allowInInput?: boolean;
}

export function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split('+');
  const key = parts[parts.length - 1].toLowerCase();
  const wantMod = parts.includes('Mod');
  const wantShift = parts.includes('Shift');
  const wantAlt = parts.includes('Alt');
  if (wantMod !== isMod(e)) return false;
  if (wantAlt !== e.altKey) return false;
  // 單一符號鍵（如 '/'）不檢查 Shift，避免不同鍵盤配置失效
  if (key.length === 1 && !/[a-z0-9]/.test(key)) return e.key === key && !e.altKey;
  if (wantShift !== e.shiftKey) return false;
  const k = e.key.toLowerCase();
  return k === key || e.code.toLowerCase() === `key${key}`;
}

/** 全域快捷鍵。編輯文字時（焦點在 contenteditable / 輸入框）預設不觸發 */
export function useHotkeys(hotkeys: Hotkey[]) {
  const ref = useRef(hotkeys);
  ref.current = hotkeys;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      for (const h of ref.current) {
        if (!matches(e, h.combo)) continue;
        if (!h.allowInInput && isEditable(e.target)) continue;
        e.preventDefault();
        h.handler(e);
        return;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
