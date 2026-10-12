import type { Measurer } from './layout';

/** 以 canvas measureText 量測，結果依「字型 + 字串」快取 */
export class CanvasMeasurer implements Measurer {
  private cache = new Map<string, number>();
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private currentFont = '';
  /** 每次清除快取時遞增，排版快取以此判斷是否過期 */
  generation = 0;

  constructor(private readonly maxEntries = 100_000) {}

  private context() {
    if (!this.ctx) {
      const c: any =
        typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      this.ctx = c.getContext('2d');
    }
    return this.ctx!;
  }

  measure(text: string, font: string): number {
    const key = font + '\u0000' + text;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const ctx = this.context();
    if (this.currentFont !== font) {
      ctx.font = font;
      this.currentFont = font;
    }
    const w = ctx.measureText(text).width;
    if (this.cache.size >= this.maxEntries) this.cache.clear();
    this.cache.set(key, w);
    return w;
  }

  clear() {
    this.cache.clear();
    this.currentFont = '';
    this.generation++;
  }

  get size() {
    return this.cache.size;
  }
}

/** document.fonts 需要的最小介面（測試時可以替換） */
export interface FontFaceSetLike {
  load(font: string, text?: string): Promise<unknown>;
  addEventListener(type: 'loadingdone', cb: () => void): void;
  removeEventListener(type: 'loadingdone', cb: () => void): void;
}

/**
 * 字型子集按需載入（見 SPEC.md 第 4.6 節）：
 * - 排版前呼叫 request(font, text)；新出現的字元會以 document.fonts.load(font, chars) 要求載入（同一幀內合併）
 * - document.fonts 觸發 loadingdone，或 load() 完成時，呼叫 onInvalidate（清除量測快取並重新排版、重繪）
 */
export class FontLoader {
  private requested = new Map<string, Set<string>>();
  private pending = new Map<string, string>();
  private scheduled = false;
  private readonly onDone = () => this.onInvalidate();
  private destroyed = false;

  constructor(
    private readonly fonts: FontFaceSetLike | null,
    private readonly onInvalidate: () => void,
    private readonly schedule: (cb: () => void) => void = (cb) => queueMicrotask(cb),
  ) {
    fonts?.addEventListener('loadingdone', this.onDone);
  }

  destroy() {
    this.destroyed = true;
    this.fonts?.removeEventListener('loadingdone', this.onDone);
  }

  /** 回報要排版的文字；回傳 true 表示有新字元送出載入要求 */
  request(font: string, text: string): boolean {
    if (!this.fonts) return false;
    let set = this.requested.get(font);
    if (!set) this.requested.set(font, (set = new Set()));
    let fresh = '';
    for (const ch of text) {
      if (ch === ' ' || ch === '\n' || set.has(ch)) continue;
      set.add(ch);
      fresh += ch;
    }
    if (!fresh) return false;
    this.pending.set(font, (this.pending.get(font) ?? '') + fresh);
    if (!this.scheduled) {
      this.scheduled = true;
      this.schedule(() => this.flush());
    }
    return true;
  }

  private flush() {
    this.scheduled = false;
    const jobs = Array.from(this.pending.entries());
    this.pending.clear();
    for (const [font, text] of jobs) {
      this.fonts!.load(font, text).then(
        (faces) => {
          if (!this.destroyed && Array.isArray(faces) && faces.length) this.onInvalidate();
        },
        () => {},
      );
    }
  }

  /** 等待指定文字需要的字型全部載入（匯出 PNG 前使用） */
  async loadAll(entries: Iterable<[font: string, text: string]>): Promise<void> {
    if (!this.fonts) return;
    const byFont = new Map<string, Set<string>>();
    for (const [font, text] of entries) {
      let s = byFont.get(font);
      if (!s) byFont.set(font, (s = new Set()));
      for (const ch of text) s.add(ch);
    }
    await Promise.all(
      Array.from(byFont.entries()).map(([font, chars]) => this.fonts!.load(font, Array.from(chars).join('')).catch(() => [])),
    );
  }
}
