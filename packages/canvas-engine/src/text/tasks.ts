import * as Y from 'yjs';

const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

/**
 * 依文件順序列出會產生 'task' 區塊的 taskItem 元素。走訪方式與 shared 的 readRichText 相同，
 * 因此第 n 個元素對應排版結果中 ordinal = n 的核取方塊。
 */
export function taskItems(fragment: Y.XmlFragment): Y.XmlElement[] {
  const out: Y.XmlElement[] = [];
  const walkList = (list: Y.XmlElement) => {
    const isTask = list.nodeName === 'taskList';
    for (const item of list.toArray()) {
      if (!(item instanceof Y.XmlElement) || (item.nodeName !== 'listItem' && item.nodeName !== 'taskItem')) continue;
      let first = true;
      for (const part of item.toArray()) {
        if (!(part instanceof Y.XmlElement)) continue;
        if (LISTS.has(part.nodeName)) walkList(part);
        else {
          if (first && isTask) out.push(item);
          first = false;
        }
      }
    }
  };
  for (const child of fragment.toArray()) {
    if (child instanceof Y.XmlElement && LISTS.has(child.nodeName)) walkList(child);
  }
  return out;
}

export function isTaskChecked(item: Y.XmlElement): boolean {
  const v = item.getAttribute('checked') as unknown;
  return v === true || v === 'true';
}
