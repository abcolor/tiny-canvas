import { RICH_TEXT_STYLE, type TextBlock, type TextRun } from '@tinycanvas/shared';
import { fontString } from '../style';

/**
 * 文字排版的度量規則。web app 疊加的 Tiptap 編輯器（packages/editor/src/styles.css）必須用相同的數值：
 * - line-height 1.4；段落、標題、列表之間沒有額外間距
 * - 標題字級為基本字級乘上 RICH_TEXT_STYLE.headingScale（1.6 / 1.35 / 1.15），粗體
 * - 列表（項目符號、編號、核取清單）每層縮排 1.3em（= ul/ol 的 padding-left），符號畫在縮排欄內
 * - 核取方塊：0.9em 正方形、圓角 3px、1.5px 邊框，水平置於 1.3em 的符號欄中央，垂直置於第一行中央
 * - 行內程式碼：等寬字型 0.9em，左右各 2px 內距（計入排版寬度），淡色底、圓角 3px
 * - 程式碼區塊：等寬字型 0.9em、行高 1.4，四周 8px 內距、圓角 4px，保留空白與換行，過長的行逐字換行，Tab 視為 4 個空白
 */
export const TEXT_METRICS = {
  lineHeight: 1.4,
  headingScale: RICH_TEXT_STYLE.headingScale,
  /** 列表每層縮排（em） */
  listIndentEm: 1.3,
  /** 符號欄寬度（em），等於一層縮排 */
  markerEm: 1.3,
  checkboxEm: 0.9,
  checkboxRadius: 3,
  checkboxBorder: 1.5,
  codeScale: 0.9,
  inlineCodePad: 2,
  inlineCodeRadius: 3,
  codeBlockPad: 8,
  codeBlockRadius: 4,
};

export interface Measurer {
  /** 量測字串寬度（px） */
  measure(text: string, font: string): number;
}

export interface LayoutSegment {
  text: string;
  /** 文字起點（相對於行的內容起點；行內程式碼已含左內距） */
  x: number;
  /** 前進寬度（行內程式碼含左右內距） */
  width: number;
  font: string;
  bold: boolean;
  italic: boolean;
  link: string | null;
  strike: boolean;
  code: boolean;
  /** 螢光標記的顏色 */
  highlight: string | null;
}

export interface LayoutLine {
  /** 行的上緣（相對文字框頂端） */
  y: number;
  height: number;
  /** 基線（相對文字框頂端） */
  baseline: number;
  /** 行內容（不含縮排）的寬度 */
  width: number;
  /** 行的起點縮排（列表、程式碼區塊內距） */
  indent: number;
  fontSize: number;
  segments: LayoutSegment[];
  /** 列表項目第一行的符號（• 或 1.） */
  marker: string | null;
  markerFont: string | null;
  /** 核取清單項目第一行：第幾個 task（文件順序，從 0 開始）與是否勾選 */
  task: { ordinal: number; checked: boolean } | null;
  /** 屬於第幾個程式碼區塊（layout.codeBlocks 的索引） */
  codeBlock: number | null;
}

export interface CodeBlockBox {
  /** 區塊上緣與高度（相對文字框頂端），寬度為文字框（或排版）寬度 */
  y: number;
  height: number;
  /** 區塊內容需要的寬度（含內距；自動寬度時使用） */
  width: number;
}

export interface TextLayout {
  lines: LayoutLine[];
  /** 所有行的最大寬度（含縮排） */
  width: number;
  height: number;
  codeBlocks?: CodeBlockBox[];
}

export interface LayoutOptions {
  /** 換行寬度；null 表示不自動換行（自動寬度的文字物件） */
  maxWidth: number | null;
  fontSize: number;
  fontWeight: 400 | 700;
}

/** 等寬字型字串 */
export function monoFont(size: number, weight: number, italic = false): string {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${RICH_TEXT_STYLE.monoFamily}`;
}

/** 核取方塊（相對文字框左上角，在對齊之前的行座標）：x 相對於行左緣 */
export function taskCheckboxRect(line: LayoutLine): { x: number; y: number; size: number } {
  const em = line.fontSize;
  const size = em * TEXT_METRICS.checkboxEm;
  const markerW = em * TEXT_METRICS.markerEm;
  return { x: line.indent - markerW + (markerW - size) / 2, y: line.y + (line.height - size) / 2, size };
}

// ---------------------------------------------------------------- 斷行

/** 不可出現在行首的字元（避頭點） */
export const NO_START = new Set(
  Array.from('，。、；：？！）」』〉》】〕﹞”’…‥·・ー～%‰°′″℃,.!?;:)]}>' + 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々〻'),
);
/** 不可出現在行尾的字元（避尾點） */
export const NO_END = new Set(Array.from('（「『〈《【〔﹝“‘([{<$£¥€'));

/** CJK 與全形字元：每個字元都是斷行機會 */
export function isCJK(cp: number): boolean {
  return (
    (cp >= 0x2e80 && cp <= 0x9fff) || // CJK 部首、標點、假名、注音、統一漢字
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7af) || // 韓文
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xffef) || // 全形
    (cp >= 0x20000 && cp <= 0x3134f)
  );
}

interface Piece {
  text: string;
  runIndex: number;
}
/** 不可分割的排版單位（一個 Latin 單字、一個 CJK 字元，加上黏住的標點），以及後面的空白 */
interface Cluster {
  pieces: Piece[];
  /** 尾端空白（行尾時不計寬度） */
  space: Piece | null;
  newline: boolean;
}

type Atom = { text: string; runIndex: number; kind: 'word' | 'cjk' | 'space' | 'newline' };

function atomize(runs: TextRun[]): Atom[] {
  const atoms: Atom[] = [];
  runs.forEach((run, runIndex) => {
    let word = '';
    let space = '';
    const flushWord = () => {
      if (word) atoms.push({ text: word, runIndex, kind: 'word' });
      word = '';
    };
    const flushSpace = () => {
      if (space) atoms.push({ text: space, runIndex, kind: 'space' });
      space = '';
    };
    for (const ch of run.text) {
      const cp = ch.codePointAt(0)!;
      if (ch === '\n') {
        flushWord();
        flushSpace();
        atoms.push({ text: '', runIndex, kind: 'newline' });
      } else if (ch === ' ' || ch === '\t' || ch === '　') {
        flushWord();
        space += ch === '\t' ? '    ' : ch;
      } else if (isCJK(cp)) {
        flushWord();
        flushSpace();
        atoms.push({ text: ch, runIndex, kind: 'cjk' });
      } else {
        flushSpace();
        word += ch;
      }
    }
    flushWord();
    flushSpace();
  });
  return atoms;
}

function firstChar(s: string): string {
  return String.fromCodePoint(s.codePointAt(0) ?? 32);
}
function lastChar(s: string): string {
  const arr = Array.from(s);
  return arr[arr.length - 1] ?? '';
}

/** 把原子組成叢集：避頭字元黏到前一個叢集，避尾字元黏到下一個 */
export function clusterize(runs: TextRun[]): Cluster[] {
  const atoms = atomize(runs);
  const clusters: Cluster[] = [];
  let glueNext = false;
  for (const a of atoms) {
    if (a.kind === 'newline') {
      clusters.push({ pieces: [], space: null, newline: true });
      glueNext = false;
      continue;
    }
    const last = clusters[clusters.length - 1];
    if (a.kind === 'space') {
      if (last && !last.newline && !last.space) last.space = { text: a.text, runIndex: a.runIndex };
      else if (last && !last.newline && last.space) last.space.text += a.text;
      else clusters.push({ pieces: [], space: { text: a.text, runIndex: a.runIndex }, newline: false });
      glueNext = false;
      continue;
    }
    const piece = { text: a.text, runIndex: a.runIndex };
    const startsNoStart = NO_START.has(firstChar(a.text));
    if (last && !last.newline && !last.space && last.pieces.length && (glueNext || startsNoStart)) {
      last.pieces.push(piece);
    } else if (last && !last.newline && last.space === null && last.pieces.length && a.kind === 'word' && last.pieces.length && isWordLike(last)) {
      // 不同 run 的相連單字（例如粗體字接一般字）視為同一個單字
      last.pieces.push(piece);
    } else {
      clusters.push({ pieces: [piece], space: null, newline: false });
    }
    glueNext = NO_END.has(lastChar(a.text));
  }
  return clusters;
}

function isWordLike(c: Cluster): boolean {
  const lastPiece = c.pieces[c.pieces.length - 1];
  const cp = lastPiece.text.codePointAt(lastPiece.text.length - 1) ?? 0;
  return !isCJK(cp) && !NO_START.has(lastChar(lastPiece.text));
}

/** 純文字斷行（測試與標籤使用）：回傳每一行的字串 */
export function breakLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const clusters = clusterize([{ text }]);
  const lines: string[] = [];
  let cur = '';
  let curW = 0;
  let pendingSpace = '';
  const push = () => {
    lines.push(cur);
    cur = '';
    curW = 0;
    pendingSpace = '';
  };
  for (const c of clusters) {
    if (c.newline) {
      push();
      continue;
    }
    const t = c.pieces.map((p) => p.text).join('');
    const w = measure(t);
    const sw = pendingSpace ? measure(pendingSpace) : 0;
    if (cur && curW + sw + w > maxWidth) push();
    if (!cur && w > maxWidth && t.length > 1) {
      // 單一叢集比整行還寬：逐字切開
      for (const ch of Array.from(t)) {
        const cw = measure(ch);
        if (cur && curW + cw > maxWidth) push();
        cur += ch;
        curW += cw;
      }
    } else {
      cur += (cur ? pendingSpace : '') + t;
      curW += (curW ? sw : 0) + w;
    }
    pendingSpace = c.space ? c.space.text : '';
  }
  lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------- 富文本排版

function blockFontSize(b: TextBlock, base: number): number {
  if (b.kind === 'heading') {
    const lvl = Math.min(3, Math.max(1, b.level ?? 1));
    return Math.round(base * (TEXT_METRICS.headingScale[lvl] ?? 1) * 100) / 100;
  }
  return base;
}

function highlightColor(h: TextRun['highlight']): string | null {
  if (!h) return null;
  return h === true ? RICH_TEXT_STYLE.highlight : String(h);
}

/** 區塊陣列排版成行。所有座標相對於文字框左上角，對齊由繪製端處理 */
export function layoutRichText(blocks: TextBlock[], opts: LayoutOptions, m: Measurer): TextLayout {
  const lines: LayoutLine[] = [];
  const codeBlocks: CodeBlockBox[] = [];
  let y = 0;
  let maxW = 0;
  let taskOrdinal = 0;
  const list = blocks.length ? blocks : [{ kind: 'paragraph' as const, runs: [] }];
  for (const b of list) {
    if (b.kind === 'code') {
      const r = layoutCodeBlock(b, opts, m, y, codeBlocks.length);
      lines.push(...r.lines);
      codeBlocks.push(r.box);
      maxW = Math.max(maxW, r.box.width);
      y += r.box.height;
      continue;
    }
    const size = blockFontSize(b, opts.fontSize);
    const heavy = b.kind === 'heading' || opts.fontWeight === 700;
    const lh = size * TEXT_METRICS.lineHeight;
    const isList = b.kind === 'bullet' || b.kind === 'ordered' || b.kind === 'task' || b.depth !== undefined;
    const indent = isList ? ((b.depth ?? 0) + 1) * TEXT_METRICS.listIndentEm * size : 0;
    const avail = opts.maxWidth === null ? Infinity : Math.max(1, opts.maxWidth - indent);
    const codeSize = Math.round(size * TEXT_METRICS.codeScale * 100) / 100;
    const fontFor = (run: TextRun) =>
      run.code ? monoFont(codeSize, run.bold || heavy ? 700 : 400, !!run.italic) : fontString(size, run.bold || heavy ? 700 : 400, !!run.italic);
    const marker = b.kind === 'bullet' ? '•' : b.kind === 'ordered' ? `${b.index ?? 1}.` : null;
    const task = b.kind === 'task' ? { ordinal: taskOrdinal++, checked: !!b.checked } : null;
    const clusters = clusterize(b.runs);

    let segs: LayoutSegment[] = [];
    let lineW = 0;
    let pendingSpace: { piece: Piece; w: number } | null = null;
    let first = true;
    const pushLine = () => {
      lines.push({
        y,
        height: lh,
        baseline: y + lh / 2 + size * 0.35,
        width: lineW,
        indent,
        fontSize: size,
        segments: segs,
        marker: first ? marker : null,
        markerFont: first && marker ? fontString(size, heavy ? 700 : 400) : null,
        task: first ? task : null,
        codeBlock: null,
      });
      maxW = Math.max(maxW, lineW + indent);
      y += lh;
      segs = [];
      lineW = 0;
      pendingSpace = null;
      first = false;
    };
    const pad = TEXT_METRICS.inlineCodePad;
    const addPiece = (p: Piece, w: number) => {
      const run = b.runs[p.runIndex] ?? { text: '' };
      const font = fontFor(run);
      const hl = highlightColor(run.highlight);
      const last = segs[segs.length - 1];
      if (last && last.font === font && last.link === (run.link ?? null) && last.strike === !!run.strike && last.code === !!run.code && last.highlight === hl) {
        last.text += p.text;
        last.width += w;
      } else {
        // 行內程式碼的前後內距計入前進寬度
        const lead = run.code ? pad : 0;
        segs.push({ text: p.text, x: lineW + lead, width: w + lead * 2, font, bold: !!(run.bold || heavy), italic: !!run.italic, link: run.link ?? null, strike: !!run.strike, code: !!run.code, highlight: hl });
        lineW += lead * 2;
      }
      lineW += w;
    };
    const measurePiece = (p: Piece) => {
      const run = b.runs[p.runIndex] ?? { text: '' };
      return m.measure(p.text, fontFor(run));
    };
    const extra = (p: Piece) => ((b.runs[p.runIndex]?.code ? pad * 2 : 0));

    for (const c of clusters) {
      if (c.newline) {
        pushLine();
        continue;
      }
      const widths = c.pieces.map(measurePiece);
      const w = widths.reduce((s, x) => s + x, 0) + (c.pieces.length ? extra(c.pieces[0]) : 0);
      const sw = pendingSpace ? pendingSpace.w : 0;
      if (segs.length && lineW + sw + w > avail) pushLine();
      if (!segs.length && w > avail && (c.pieces.length > 1 || Array.from(c.pieces[0]?.text ?? '').length > 1)) {
        for (const p of c.pieces) {
          for (const ch of Array.from(p.text)) {
            const piece = { text: ch, runIndex: p.runIndex };
            const cw = measurePiece(piece);
            if (segs.length && lineW + cw > avail) pushLine();
            addPiece(piece, cw);
          }
        }
      } else {
        if (pendingSpace && segs.length) addPiece(pendingSpace.piece, pendingSpace.w);
        c.pieces.forEach((p, i) => addPiece(p, widths[i]));
      }
      pendingSpace = c.space ? { piece: c.space, w: measurePiece(c.space) } : null;
      if (c.space && !c.pieces.length && !segs.length) pendingSpace = null;
    }
    pushLine();
  }
  const out: TextLayout = { lines, width: maxW, height: y };
  if (codeBlocks.length) out.codeBlocks = codeBlocks;
  return out;
}

/** 程式碼區塊：保留空白與換行，過長的行逐字換行 */
function layoutCodeBlock(b: TextBlock, opts: LayoutOptions, m: Measurer, top: number, index: number): { lines: LayoutLine[]; box: CodeBlockBox } {
  const pad = TEXT_METRICS.codeBlockPad;
  const size = Math.round(opts.fontSize * TEXT_METRICS.codeScale * 100) / 100;
  const lh = size * TEXT_METRICS.lineHeight;
  const avail = opts.maxWidth === null ? Infinity : Math.max(1, opts.maxWidth - pad * 2);
  const lines: LayoutLine[] = [];
  let y = top + pad;
  let maxLine = 0;
  let segs: LayoutSegment[] = [];
  let lineW = 0;
  const push = () => {
    lines.push({ y, height: lh, baseline: y + lh / 2 + size * 0.35, width: lineW, indent: pad, fontSize: size, segments: segs, marker: null, markerFont: null, task: null, codeBlock: index });
    maxLine = Math.max(maxLine, lineW);
    y += lh;
    segs = [];
    lineW = 0;
  };
  for (const run of b.runs) {
    const font = monoFont(size, run.bold ? 700 : 400, !!run.italic);
    const hl = highlightColor(run.highlight);
    const text = run.text.replace(/\t/g, '    ');
    let buf = '';
    let bufW = 0;
    const flush = () => {
      if (!buf) return;
      const last = segs[segs.length - 1];
      if (last && last.font === font && last.highlight === hl && last.strike === !!run.strike) {
        last.text += buf;
        last.width += bufW;
      } else segs.push({ text: buf, x: lineW, width: bufW, font, bold: !!run.bold, italic: !!run.italic, link: null, strike: !!run.strike, code: false, highlight: hl });
      lineW += bufW;
      buf = '';
      bufW = 0;
    };
    for (const ch of text) {
      if (ch === '\n') {
        flush();
        push();
        continue;
      }
      const cw = m.measure(ch, font);
      if (lineW + bufW + cw > avail && lineW + bufW > 0) {
        flush();
        push();
      }
      buf += ch;
      bufW += cw;
    }
    flush();
  }
  push();
  const height = y + pad - top;
  return { lines, box: { y: top, height, width: maxLine + pad * 2 } };
}

/** 把字串陣列轉成 TextBlock（測試與標籤用） */
export function plainBlocks(text: string): TextBlock[] {
  return text.split('\n').map((t) => ({ kind: 'paragraph' as const, runs: t ? [{ text: t }] : [] }));
}
