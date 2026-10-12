import * as Y from 'yjs';
import type { TextBlock, TextRun } from './types';

// Y.XmlFragment 的結構由 y-prosemirror 決定：節點是 Y.XmlElement（nodeName 為 ProseMirror 節點名稱），
// 文字是 Y.XmlText，粗體等 mark 存成文字的格式屬性（屬性名稱為 mark 名稱，值為 mark 的 attrs）。
// 編輯器允許的節點：paragraph、heading（1–3）、bulletList、orderedList、listItem、taskList、taskItem、
// codeBlock、hardBreak；mark：bold、italic、strike、code、highlight、link。

function runsFromElement(el: Y.XmlElement | Y.XmlFragment): TextRun[] {
  const runs: TextRun[] = [];
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as Array<{ insert: unknown; attributes?: Record<string, any> }>) {
        if (typeof op.insert !== 'string') continue;
        const run: TextRun = { text: op.insert };
        const a = op.attributes;
        if (a?.bold) run.bold = true;
        if (a?.italic) run.italic = true;
        if (a?.strike) run.strike = true;
        if (a?.code) run.code = true;
        if (a?.highlight) run.highlight = typeof a.highlight === 'object' && a.highlight.color ? String(a.highlight.color) : true;
        if (a?.link) run.link = typeof a.link === 'object' ? a.link.href : String(a.link);
        runs.push(run);
      }
    } else if (child instanceof Y.XmlElement && child.nodeName === 'hardBreak') {
      runs.push({ text: '\n' });
    } else if (child instanceof Y.XmlElement) {
      runs.push(...runsFromElement(child));
    }
  }
  return runs;
}

function textRuns(t: Y.XmlText): TextRun[] {
  const wrapper = { toArray: () => [t] } as unknown as Y.XmlElement;
  return runsFromElement(wrapper);
}

function walk(el: Y.XmlFragment | Y.XmlElement, out: TextBlock[]): void {
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) {
      out.push({ kind: 'paragraph', runs: textRuns(child) });
      continue;
    }
    if (!(child instanceof Y.XmlElement)) continue;
    switch (child.nodeName) {
      case 'paragraph':
        out.push({ kind: 'paragraph', runs: runsFromElement(child) });
        break;
      case 'heading':
        out.push({ kind: 'heading', level: Number(child.getAttribute('level') ?? 1), runs: runsFromElement(child) });
        break;
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        walkList(child, out, 0);
        break;
      case 'codeBlock':
        out.push({ kind: 'code', runs: runsFromElement(child) });
        break;
      default:
        out.push({ kind: 'paragraph', runs: runsFromElement(child) });
    }
  }
}

function walkList(listEl: Y.XmlElement, out: TextBlock[], depth: number): void {
  const kind: TextBlock['kind'] = listEl.nodeName === 'bulletList' ? 'bullet' : listEl.nodeName === 'taskList' ? 'task' : 'ordered';
  let index = Number(listEl.getAttribute('start') ?? 1);
  for (const item of listEl.toArray()) {
    if (!(item instanceof Y.XmlElement) || (item.nodeName !== 'listItem' && item.nodeName !== 'taskItem')) continue;
    const checkedAttr = item.getAttribute('checked') as unknown;
    let first = true;
    for (const part of item.toArray()) {
      if (!(part instanceof Y.XmlElement)) continue;
      if (part.nodeName === 'bulletList' || part.nodeName === 'orderedList' || part.nodeName === 'taskList') {
        walkList(part, out, depth + 1);
      } else {
        const block: TextBlock = first
          ? { kind, depth, runs: runsFromElement(part) }
          : { kind: 'paragraph', depth, runs: runsFromElement(part) };
        if (first && kind === 'ordered') block.index = index;
        if (first && kind === 'task') block.checked = checkedAttr === true || checkedAttr === 'true';
        out.push(block);
        first = false;
      }
    }
    index++;
  }
}

/** 把 Y.XmlFragment 轉成渲染用的區塊陣列 */
export function readRichText(fragment: Y.XmlFragment | undefined | null): TextBlock[] {
  if (!fragment) return [];
  const out: TextBlock[] = [];
  walk(fragment, out);
  return out;
}

/** 富文本轉純文字，每個區塊一行 */
export function richTextToPlain(blocks: TextBlock[]): string {
  return blocks.map((b) => b.runs.map((r) => r.text).join('')).join('\n');
}

export function fragmentToPlain(fragment: Y.XmlFragment | undefined | null): string {
  return richTextToPlain(readRichText(fragment));
}

/**
 * 以純文字覆寫 fragment 的內容，每行一個 paragraph。
 * fragment 必須已經放進 Y.Doc（呼叫端負責包在 transaction 內）。
 */
export function setPlainText(fragment: Y.XmlFragment, text: string): void {
  if (fragment.length > 0) fragment.delete(0, fragment.length);
  const lines = text.split(/\r?\n/);
  const paragraphs = lines.map(() => new Y.XmlElement('paragraph'));
  fragment.insert(0, paragraphs);
  lines.forEach((line, i) => {
    if (line.length > 0) {
      const t = new Y.XmlText();
      paragraphs[i].insert(0, [t]);
      t.insert(0, line);
    }
  });
}

/** 建立一個尚未整合進 Y.Doc 的 fragment，內容是一個空 paragraph（給新物件使用） */
export function emptyFragment(): Y.XmlFragment {
  const f = new Y.XmlFragment();
  f.insert(0, [new Y.XmlElement('paragraph')]);
  return f;
}
