import { describe, expect, it } from 'vitest';
import { icons } from 'lucide-react';
import tags from '../src/board/lucide-tags.json';
import { searchIcons } from '../src/board/iconKeywords';

const all = Object.keys(icons);

describe('圖示搜尋', () => {
  it('標籤資料涵蓋全部 lucide-react 圖示', () => {
    expect(Object.keys(tags).length).toBe(all.length);
  });

  it('以 Lucide 標籤搜尋（retry → RotateCcw，與 lucide.dev 一致）', () => {
    expect(searchIcons(all, 'retry', tags)).toContain('RotateCcw');
    expect(searchIcons(all, 'retry', null)).not.toContain('RotateCcw');
  });

  it('名稱相符排在標籤相符之前', () => {
    const r = searchIcons(all, 'database', tags);
    expect(r[0]).toBe('Database');
  });

  it('中文關鍵字與英文名稱（忽略大小寫與連字號）', () => {
    expect(searchIcons(all, '資料庫', tags)[0]).toBe('Database');
    expect(searchIcons(all, 'arrow-right', tags)).toContain('ArrowRight');
    expect(searchIcons(all, 'Arrow Right', tags)).toContain('ArrowRight');
  });
});
