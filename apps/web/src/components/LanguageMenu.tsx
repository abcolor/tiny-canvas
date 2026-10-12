import { Languages } from 'lucide-react';
import {
  IconButton,
  locale,
  LOCALE_NAMES,
  LOCALES,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuTrigger,
  setLocale,
  strings,
} from '@tinycanvas/ui';

/** 切換介面語系；選擇後儲存並重新載入頁面 */
export function LanguageMenu({ side = 'top' }: { side?: 'top' | 'bottom' }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label={strings.app.language} tooltipSide={side} data-testid="language-menu">
          <Languages className="h-4 w-4" />
        </IconButton>
      </MenuTrigger>
      <MenuContent side={side} align="end" className="min-w-[140px]">
        {LOCALES.map((l) => (
          <MenuCheckboxItem key={l} checked={l === locale} onCheckedChange={() => l !== locale && setLocale(l)}>
            {LOCALE_NAMES[l]}
          </MenuCheckboxItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
