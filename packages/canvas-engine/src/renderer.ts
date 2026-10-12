import type { BoardObject } from '@tinycanvas/shared';
import { inflate, intersects, type Rect } from './geometry';
import type { SceneStore } from './store';
import { CANVAS_BG, GRID_DOT } from './style';
import { drawObjects, type RenderContext } from './render/draw';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface RendererDeps {
  store: SceneStore;
  /** 目前的繪製參數（zoom 由 renderer 填入） */
  renderContext: () => Omit<RenderContext, 'zoom'>;
  /** 互動層：畫正在拖曳／預覽的物件（ctx 已設定為世界座標） */
  paintLive: (ctx: CanvasRenderingContext2D, rc: RenderContext) => void;
  /** 覆蓋層：選取框、把手、參考線、捲軸（ctx 為 CSS px 座標） */
  paintOverlay: (ctx: CanvasRenderingContext2D) => void;
  /** 每一幀結束後呼叫（狀態通知等） */
  afterFrame: () => void;
}

const FRAME_HISTORY = 600;

/**
 * 分層畫布：
 * - base：靜態物件。平移時把既有內容位移後只補畫新露出的長條；物件變動時只重畫髒區；縮放時整層重畫
 * - live：正在拖曳、縮放、旋轉的物件（不在 base 內）
 * - overlay：選取框、把手、參考線、框選、捲軸
 */
export class Renderer {
  readonly root: HTMLDivElement;
  private base: HTMLCanvasElement;
  private live: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private lctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;
  private scratch: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  cssW = 0;
  cssH = 0;
  dpr = 1;
  camera: Camera = { x: 0, y: 0, zoom: 1 };
  private staticCam: Camera | null = null;
  private full = true;
  private dirty: Rect[] = [];
  private liveDirty = false;
  private liveHasContent = false;
  private overlayDirty = true;
  private raf = 0;
  private destroyed = false;
  private ro: ResizeObserver | null = null;
  /** 不畫在 base 層的物件（被拖曳中） */
  readonly hidden = new Set<string>();
  readonly stats = { lastFrameMs: 0, frameTimes: [] as number[], frames: 0, staticMs: 0, kind: '' as string };
  private frameIndex = 0;

  constructor(
    private container: HTMLElement,
    private deps: RendererDeps,
  ) {
    const root = document.createElement('div');
    root.tabIndex = 0;
    root.setAttribute('role', 'application');
    root.dataset.tinycanvas = 'board';
    Object.assign(root.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      outline: 'none',
      touchAction: 'none',
      userSelect: 'none',
      webkitUserSelect: 'none',
      background: CANVAS_BG,
    } as Partial<CSSStyleDeclaration>);
    const mk = () => {
      const c = document.createElement('canvas');
      Object.assign(c.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
      root.appendChild(c);
      return c;
    };
    this.base = mk();
    this.live = mk();
    this.overlay = mk();
    this.bctx = this.base.getContext('2d', { alpha: false })!;
    this.lctx = this.live.getContext('2d')!;
    this.octx = this.overlay.getContext('2d')!;
    this.scratch = document.createElement('canvas');
    this.sctx = this.scratch.getContext('2d', { alpha: false })!;
    container.appendChild(root);
    this.root = root;
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(container);
    }
    this.resize();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.root.remove();
  }

  /** 互動層的整體不透明度（放置複本時的預覽） */
  setLiveOpacity(v: number) {
    this.live.style.opacity = v >= 1 ? '' : String(v);
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    for (const c of [this.base, this.live, this.overlay, this.scratch]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    this.invalidateAll();
  }

  // ------------------------------------------------------------ invalidation

  invalidateAll() {
    this.full = true;
    this.liveDirty = true;
    this.overlayDirty = true;
    this.requestFrame();
  }

  invalidateWorld(rects: Rect[]) {
    if (!rects.length) return;
    for (const r of rects) this.dirty.push(r);
    this.requestFrame();
  }

  invalidateLive() {
    this.liveDirty = true;
    this.requestFrame();
  }

  invalidateOverlay() {
    this.overlayDirty = true;
    this.requestFrame();
  }

  requestFrame() {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.frame();
    });
  }

  /** 立即繪製（效能測試與匯出前使用） */
  flush() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.frame();
  }

  // ------------------------------------------------------------ geometry

  viewportWorld(): Rect {
    const z = this.camera.zoom;
    return { x: this.camera.x, y: this.camera.y, w: this.cssW / z, h: this.cssH / z };
  }

  // ------------------------------------------------------------ frame

  private frame() {
    if (this.destroyed) return;
    if ((globalThis.devicePixelRatio || 1) !== this.dpr) this.resize();
    const t0 = performance.now();
    let drew = false;
    const ts = performance.now();
    if (this.renderStatic()) drew = true;
    this.stats.staticMs = performance.now() - ts;
    if (this.liveDirty) {
      this.renderLive();
      drew = true;
    }
    if (this.overlayDirty) {
      this.renderOverlay();
      drew = true;
    }
    const dt = performance.now() - t0;
    if (drew) {
      this.stats.lastFrameMs = dt;
      this.stats.frames++;
      const ft = this.stats.frameTimes;
      if (ft.length < FRAME_HISTORY) ft.push(dt);
      else ft[this.frameIndex % FRAME_HISTORY] = dt;
      this.frameIndex++;
    }
    this.deps.afterFrame();
  }

  private rc(): RenderContext {
    return { ...this.deps.renderContext(), zoom: this.camera.zoom };
  }

  private renderStatic(): boolean {
    const W = this.base.width;
    const H = this.base.height;
    const cam = this.camera;
    const sc = this.staticCam;
    if (this.full || !sc || sc.zoom !== cam.zoom) {
      this.staticCam = { ...cam };
      this.full = false;
      this.drawRegions([{ x: 0, y: 0, w: W, h: H }]);
      this.dirty = [];
      this.stats.kind = 'full';
      return true;
    }
    const regions: Rect[] = [];
    const k = cam.zoom * this.dpr;
    const dx = (sc.x - cam.x) * k;
    const dy = (sc.y - cam.y) * k;
    let kind = '';
    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
      const rdx = Math.round(dx);
      const rdy = Math.round(dy);
      if (Math.abs(dx - rdx) > 0.02 || Math.abs(dy - rdy) > 0.02 || Math.abs(rdx) >= W || Math.abs(rdy) >= H) {
        this.staticCam = { ...cam };
        this.drawRegions([{ x: 0, y: 0, w: W, h: H }]);
        this.dirty = [];
        this.stats.kind = 'full';
        return true;
      }
      // 位移既有內容，只補畫新露出的長條
      this.sctx.setTransform(1, 0, 0, 1, 0, 0);
      this.sctx.globalCompositeOperation = 'copy';
      this.sctx.drawImage(this.base, 0, 0);
      this.sctx.globalCompositeOperation = 'source-over';
      const b = this.bctx;
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.drawImage(this.scratch, rdx, rdy);
      if (rdx > 0) regions.push({ x: 0, y: 0, w: rdx, h: H });
      if (rdx < 0) regions.push({ x: W + rdx, y: 0, w: -rdx, h: H });
      if (rdy > 0) regions.push({ x: 0, y: 0, w: W, h: rdy });
      if (rdy < 0) regions.push({ x: 0, y: H + rdy, w: W, h: -rdy });
      // 修正浮點誤差：讓 staticCam 對應整數像素位移
      this.staticCam = { x: sc.x - rdx / k, y: sc.y - rdy / k, zoom: cam.zoom };
      kind = 'pan';
    }
    if (this.dirty.length) {
      const cam2 = this.staticCam!;
      const dev: Rect[] = [];
      for (const r of this.dirty) {
        const w = inflate(r, 6 + 2 / k);
        const d = {
          x: Math.floor((w.x - cam2.x) * k),
          y: Math.floor((w.y - cam2.y) * k),
          w: Math.ceil(w.w * k) + 2,
          h: Math.ceil(w.h * k) + 2,
        };
        // 裁到畫布範圍
        const x0 = Math.max(0, d.x);
        const y0 = Math.max(0, d.y);
        const x1 = Math.min(W, d.x + d.w);
        const y1 = Math.min(H, d.y + d.h);
        if (x1 > x0 && y1 > y0) dev.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
      this.dirty = [];
      if (dev.length > 12) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const d of dev) {
          x0 = Math.min(x0, d.x);
          y0 = Math.min(y0, d.y);
          x1 = Math.max(x1, d.x + d.w);
          y1 = Math.max(y1, d.y + d.h);
        }
        regions.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      } else regions.push(...dev);
      kind = kind ? kind + '+dirty' : 'dirty';
    }
    if (!regions.length) return false;
    this.drawRegions(regions);
    this.stats.kind = kind;
    return true;
  }

  /** 以 staticCam 繪製多個裝置像素範圍 */
  private drawRegions(regions: Rect[]) {
    const ctx = this.bctx;
    const cam = this.staticCam ?? this.camera;
    const k = cam.zoom * this.dpr;
    const rc = this.rc();
    for (const r of regions) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.fillStyle = CANVAS_BG;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
      const world = { x: cam.x + r.x / k, y: cam.y + r.y / k, w: r.w / k, h: r.h / k };
      this.drawGrid(ctx, world, cam.zoom);
      drawObjects(ctx, this.visibleObjects(world), rc);
      ctx.restore();
    }
  }

  /** 範圍內、未被隱藏的物件，依繪製順序 */
  visibleObjects(world: Rect): BoardObject[] {
    const store = this.deps.store;
    const items = store.query(world);
    const ids: string[] = [];
    for (const it of items) if (!this.hidden.has(it.id)) ids.push(it.id);
    store.sortByOrder(ids);
    const out: BoardObject[] = [];
    for (const id of ids) {
      const o = store.get(id);
      if (o) out.push(o);
    }
    return out;
  }

  private drawGrid(ctx: CanvasRenderingContext2D, world: Rect, zoom: number) {
    let s = 24;
    while (s * zoom < 14) s *= 2;
    const size = (1.4 * Math.max(1, this.dpr * 0.75)) / (zoom * this.dpr);
    const x0 = Math.floor(world.x / s) * s;
    const y0 = Math.floor(world.y / s) * s;
    const x1 = world.x + world.w;
    const y1 = world.y + world.h;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += s) for (let y = y0; y <= y1; y += s) ctx.rect(x - size / 2, y - size / 2, size, size);
    ctx.fillStyle = GRID_DOT;
    ctx.fill();
  }

  private renderLive() {
    const ctx = this.lctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.liveHasContent) ctx.clearRect(0, 0, this.live.width, this.live.height);
    this.liveDirty = false;
    const k = this.camera.zoom * this.dpr;
    ctx.setTransform(k, 0, 0, k, -this.camera.x * k, -this.camera.y * k);
    this.liveHasContent = true;
    this.deps.paintLive(ctx, this.rc());
  }

  private renderOverlay() {
    const ctx = this.octx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.overlayDirty = false;
    this.deps.paintOverlay(ctx);
  }

  /** 世界範圍是否與畫面相交 */
  isVisible(r: Rect): boolean {
    return intersects(r, this.viewportWorld());
  }
}
