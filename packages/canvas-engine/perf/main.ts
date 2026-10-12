// 效能測試頁：產生混合物件的畫布，透過公開 API 執行固定的平移與縮放腳本，記錄每一幀的繪製時間。
import * as Y from 'yjs';
import { createObjectMap, getObjects, zBetween, type NewObjectInput, type ShapeKind } from '@tinycanvas/shared';
import { BoardEditor } from '../src';
import type { WireframeKind } from '@tinycanvas/shared';
import { WIREFRAME_DEFAULTS } from '../src/render/wireframe';

const WORDS = ['登入', '驗證 token', '查詢資料庫', 'Send email', '付款流程', 'Retry', '使用者', 'API Gateway', '快取', 'Upload file', '審核', 'Done', '錯誤處理', 'Queue job', '通知', 'Render'];
const KINDS: ShapeKind[] = ['rectangle', 'rounded', 'diamond', 'ellipse', 'cylinder', 'parallelogram', 'hexagon', 'document'];
const FILLS = [undefined, '#e2f3f0', '#e5eefb', '#fdf1df', '#fce9ef', '#eee9fb'];

let seed = 42;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

/** 產生約 n 個物件：區塊（泳道）內放形狀、群組、文字，形狀之間以連線相連 */
export function buildBoard(n: number): Y.Doc {
  seed = 42;
  const doc = new Y.Doc();
  const objs: NewObjectInput[] = [];
  const cols = 13;
  const blockW = 900;
  const blockH = 600;
  const pitchX = 960;
  const pitchY = 660;
  let b = 0;
  let lastZ: string | null = null;
  const zk = () => (lastZ = zBetween(lastZ, null));
  while (objs.length < n) {
    const bx = (b % cols) * pitchX;
    const by = Math.floor(b / cols) * pitchY;
    const sid = `s${b}`;
    if (b % 7 === 1) {
      // 線框圖畫面：瀏覽器裝置框內放導覽列、側欄與 26 個元件
      objs.push({ type: 'section', id: sid, x: bx, y: by, w: blockW, h: blockH, title: `畫面 ${b + 1}`, frameKind: 'browser', z: zk() });
      const kinds: WireframeKind[] = ['heading', 'input', 'select', 'button', 'checkbox', 'switch', 'radio', 'tabs', 'card', 'table', 'progress', 'rating', 'search', 'paragraph', 'avatar', 'badge', 'tag', 'slider', 'date_picker', 'list', 'segmented', 'breadcrumb', 'pagination', 'button_secondary', 'chart_placeholder', 'image_placeholder'];
      const items: [WireframeKind, number, number, number, number][] = [
        ['navbar', bx, by + 76, blockW, 56],
        ['sidebar', bx, by + 132, 180, 468],
      ];
      kinds.forEach((k, i) => {
        const d = WIREFRAME_DEFAULTS[k];
        const col = i % 4;
        const row = Math.floor(i / 4);
        items.push([k, bx + 200 + col * 172, by + 148 + row * 64, Math.min(d.w, 160), Math.min(d.h, 56)]);
      });
      for (const [k, x, y, w, h] of items) {
        if (objs.length >= n) break;
        const d = WIREFRAME_DEFAULTS[k];
        objs.push({ type: 'wireframe', id: `w${b}_${objs.length}`, x, y, w, h, componentKind: k, parentId: sid, z: zk(), text: d.text, props: d.props });
      }
      b++;
      continue;
    }
    objs.push({ type: 'section', id: sid, x: bx, y: by, w: blockW, h: blockH, title: `區塊 ${b + 1}`, frameKind: null, z: zk() });
    const withTable = b % 2 === 0;
    const ids: string[] = [];
    for (let r = 0; r < (withTable ? 3 : 4); r++) {
      for (let c = 0; c < 6; c++) {
        if (objs.length >= n) break;
        const id = `n${b}_${r}_${c}`;
        const kind = pick(KINDS);
        const fill = pick(FILLS);
        objs.push({
          type: 'shape',
          id,
          x: bx + 30 + c * 140,
          y: by + 50 + r * 135,
          w: 116,
          h: 64,
          shapeKind: kind,
          parentId: sid,
          z: zk(),
          style: fill ? { fill } : {},
          text: `${pick(WORDS)} ${r * 5 + c}`,
          icon: rnd() < 0.15 ? 'Database' : null,
        });
        ids.push(id);
      }
    }
    if (withTable && objs.length < n) {
      const cols = [0, 1, 2, 3].map((i) => ({ id: `tc${b}_${i}`, width: 130 }));
      const rows = [0, 1, 2].map((i) => ({ id: `tr${b}_${i}`, height: 32 }));
      const cells: Record<string, string> = {};
      rows.forEach((r, ri) => cols.forEach((c, ci) => (cells[`${r.id}:${c.id}`] = ri === 0 ? `欄位 ${ci + 1}` : pick(WORDS))));
      objs.push({ type: 'table', id: `tb${b}`, x: bx + 30, y: by + 50 + 3 * 135, w: 520, h: 96, columns: cols, rows, cells, headerRow: true, parentId: sid, z: zk() });
    }
    // 兩個形狀組成群組
    if (objs.length + 3 < n) {
      const gid = `g${b}`;
      const gx = bx + 30;
      const gy = by + 50 + 4 * 135 - 8;
      objs.push({ type: 'group', id: gid, x: gx, y: gy, w: 300, h: 40, parentId: sid, z: zk() });
      objs.push({ type: 'shape', id: `ga${b}`, x: gx, y: gy, w: 140, h: 40, shapeKind: 'rounded', parentId: gid, z: 'a0', text: '群組 A' });
      objs.push({ type: 'shape', id: `gb${b}`, x: gx + 160, y: gy, w: 140, h: 40, shapeKind: 'rounded', parentId: gid, z: 'a1', text: 'Group B' });
    }
    if (objs.length < n) objs.push({ type: 'text', id: `t${b}`, x: bx + 360, y: by + 50 + 4 * 135 - 4, w: 260, h: 20, parentId: sid, z: zk(), text: '說明文字：這一段是自由文字 note', fixedWidth: true });
    // 連線：每列相鄰形狀，以及欄之間的一些
    for (let i = 0; i < ids.length - 1 && objs.length < n; i++) {
      if ((i + 1) % 6 === 0) continue;
      objs.push({
        type: 'connector',
        id: `c${b}_${i}`,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        z: zk(),
        from: { objectId: ids[i], anchor: 'right' },
        to: { objectId: ids[i + 1], anchor: 'left' },
        routing: i % 7 === 3 ? 'curved' : 'orthogonal',
        label: i % 6 === 0 ? '是' : '',
      });
    }
    for (let i = 0; i + 6 < ids.length && objs.length < n; i += 7) {
      objs.push({
        type: 'connector',
        id: `v${b}_${i}`,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        z: zk(),
        from: { objectId: ids[i], anchor: 'bottom' },
        to: { objectId: ids[i + 6], anchor: 'top' },
      });
    }
    b++;
  }
  const map = getObjects(doc);
  doc.transact(() => {
    for (const o of objs.slice(0, n)) map.set(o.id!, createObjectMap(o));
  });
  (window as any).__counts = {
    wireframes: objs.slice(0, n).filter((o) => o.type === 'wireframe').length,
    tables: objs.slice(0, n).filter((o) => o.type === 'table').length,
  };
  return doc;
}

const raf = () => new Promise<number>((r) => requestAnimationFrame(r));

export interface Sample {
  phase: string;
  draw: number;
  interval: number;
  kind: string;
}

function pct(a: number[], p: number) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function summarize(samples: Sample[]) {
  const draws = samples.map((s) => s.draw);
  const ints = samples.map((s) => s.interval).filter((x) => x > 0);
  const phases: Record<string, { frames: number; p50: number; p95: number; max: number }> = {};
  for (const ph of Array.from(new Set(samples.map((s) => s.phase)))) {
    const d = samples.filter((s) => s.phase === ph).map((s) => s.draw);
    phases[ph] = { frames: d.length, p50: +pct(d, 50).toFixed(2), p95: +pct(d, 95).toFixed(2), max: +Math.max(...d).toFixed(2) };
  }
  return {
    frames: samples.length,
    drawP50: +pct(draws, 50).toFixed(2),
    drawP95: +pct(draws, 95).toFixed(2),
    drawMax: +Math.max(...draws).toFixed(2),
    rafP50: +pct(ints, 50).toFixed(2),
    rafP95: +pct(ints, 95).toFixed(2),
    phases,
  };
}

let editor: BoardEditor | null = null;

async function run(n: number) {
  editor?.destroy();
  const container = document.getElementById('board')!;
  const t0 = performance.now();
  const doc = buildBoard(n);
  const tBuild = performance.now() - t0;
  const t1 = performance.now();
  editor = new BoardEditor({ doc, container });
  const tInit = performance.now() - t1;
  (window as any).__editor = editor;
  const ed = editor;
  const hud = document.getElementById('hud')!;
  // 暖身：第一次繪製會計算排版與連線路由（屬於載入時間），不列入幀時間
  ed.setZoom(1);
  ed.centerOn({ x: 2000, y: 1500 });
  await raf();
  await raf();
  const tw = performance.now();
  ed.setZoom(0.1);
  ed.centerOn({ x: 6240, y: 3960 });
  await raf();
  ed.setZoom(0.35);
  await raf();
  ed.setZoom(1);
  ed.centerOn({ x: 2000, y: 1500 });
  await raf();
  await raf();
  const tWarm = performance.now() - tw;

  const samples: Sample[] = [];
  let last = performance.now();
  const step = async (phase: string, fn: () => void) => {
    const before = ed.stats.frameTimes.length + (ed as any).renderer.stats.frames;
    fn();
    const now = await raf();
    const after = ed.stats.frameTimes.length + (ed as any).renderer.stats.frames;
    samples.push({ phase, draw: after !== before ? ed.stats.lastFrameMs : 0, interval: now - last, kind: (ed as any).renderer.stats.kind });
    last = now;
    hud.textContent = `${n} objs · ${phase} · draw ${ed.stats.lastFrameMs.toFixed(1)}ms · zoom ${ed.getState().camera.zoom.toFixed(2)}`;
  };
  // 1. 100% 平移
  for (let i = 0; i < 90; i++) await step('pan@100%', () => ed.panBy(-18, -9));
  // 2. 連續縮小到 10%（以畫面中心為錨點）
  for (let i = 0; i < 60; i++) await step('zoom-out', () => ed.setZoom(ed.getState().camera.zoom * 0.962));
  ed.setZoom(0.1);
  ed.centerOn({ x: 6240, y: 3960 });
  await raf();
  // 3. 10%：全部物件都在畫面內，平移與小幅縮放
  for (let i = 0; i < 60; i++) await step('pan@10%', () => ed.panBy(i < 30 ? -6 : 6, 3));
  const visibleAt10 = (ed as any).renderer.visibleObjects((ed as any).renderer.viewportWorld()).length;
  for (let i = 0; i < 30; i++) await step('zoom@10%', () => ed.setZoom(0.1 + 0.002 * (i % 10), { x: 640, y: 400 }));
  ed.setZoom(0.1);
  ed.centerOn({ x: 6240, y: 3960 });
  await raf();
  // 4. 放大回 100%（以滑鼠位置為錨點）
  for (let i = 0; i < 60; i++) await step('zoom-in', () => ed.setZoom(Math.min(1, ed.getState().camera.zoom * 1.04), { x: 500, y: 300 }));
  // 5. 中等縮放（35%）平移：文字剛好可讀，畫面內物件最多
  ed.setZoom(0.35);
  await raf();
  for (let i = 0; i < 60; i++) await step('pan@35%', () => ed.panBy(-25, -12));
  // 6. 縮放 35% ↔ 60% 來回
  for (let i = 0; i < 40; i++) await step('zoom@35-60%', () => ed.setZoom(0.35 + 0.25 * Math.abs(Math.sin(i / 8)), { x: 640, y: 400 }));
  const draws = samples.filter((s) => s.draw > 0);
  return {
    objects: ed.model.store.objects.size,
    ...(window as any).__counts,
    visibleAt10,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    buildMs: +tBuild.toFixed(1),
    initMs: +tInit.toFixed(1),
    warmupMs: +tWarm.toFixed(1),
    ...summarize(draws),
  };
}

(window as any).__perf = { run, buildBoard };
(window as any).__Y = Y;

const params = new URLSearchParams(location.search);
if (params.get('n')) {
  // 手動檢視：?n=5000
  const doc = buildBoard(Number(params.get('n')));
  editor = new BoardEditor({ doc, container: document.getElementById('board')! });
  (window as any).__editor = editor;
  editor.focus();
  const hud = document.getElementById('hud')!;
  editor.subscribe(() => {
    hud.textContent = `${editor!.stats.lastFrameMs.toFixed(1)}ms · zoom ${editor!.getState().camera.zoom.toFixed(2)}`;
  });
}
