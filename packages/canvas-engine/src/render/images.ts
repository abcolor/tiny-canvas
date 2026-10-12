export interface ImageEntry {
  status: 'loading' | 'ready' | 'error';
  source: CanvasImageSource | null;
  width: number;
  height: number;
  /** 低縮放時使用的縮圖（長邊 THUMB_SIZE） */
  thumb: CanvasImageSource | null;
  promise: Promise<void>;
}

const THUMB_SIZE = 256;

function sizeOf(src: CanvasImageSource): { w: number; h: number } {
  const s = src as any;
  return {
    w: s.naturalWidth ?? s.videoWidth ?? s.displayWidth ?? s.width ?? 0,
    h: s.naturalHeight ?? s.videoHeight ?? s.displayHeight ?? s.height ?? 0,
  };
}

function makeThumb(src: CanvasImageSource, w: number, h: number): CanvasImageSource | null {
  const scale = THUMB_SIZE / Math.max(w, h);
  if (scale >= 1 || !w || !h) return null;
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const c: any = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(tw, th) : Object.assign(document.createElement('canvas'), { width: tw, height: th });
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, tw, th);
  return c;
}

/** 圖片快取：以 assetId 載入一次，完成時呼叫 onLoad（重繪該物件） */
export class ImageCache {
  private map = new Map<string, ImageEntry>();
  constructor(
    private loader: ((assetId: string) => Promise<CanvasImageSource>) | undefined,
    private onLoad: (assetId: string) => void,
  ) {}

  get(assetId: string): ImageEntry | null {
    if (!assetId) return null;
    let e = this.map.get(assetId);
    if (!e) {
      if (!this.loader) return null;
      const entry: ImageEntry = { status: 'loading', source: null, width: 0, height: 0, thumb: null, promise: Promise.resolve() };
      entry.promise = this.loader(assetId).then(
        (src) => {
          const { w, h } = sizeOf(src);
          entry.source = src;
          entry.width = w;
          entry.height = h;
          entry.thumb = makeThumb(src, w, h);
          entry.status = 'ready';
          this.onLoad(assetId);
        },
        () => {
          entry.status = 'error';
          this.onLoad(assetId);
        },
      );
      this.map.set(assetId, entry);
      e = entry;
    }
    return e;
  }

  /** 等待圖片載入完成（匯出前使用） */
  async ensure(assetIds: Iterable<string>): Promise<void> {
    const ps: Promise<void>[] = [];
    for (const id of assetIds) {
      const e = this.get(id);
      if (e) ps.push(e.promise);
    }
    await Promise.all(ps);
  }

  clear() {
    this.map.clear();
  }
}
