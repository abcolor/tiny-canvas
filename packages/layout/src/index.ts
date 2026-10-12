// 自動排版（見 SPEC.md 第 4.1 節）：以 ELK 的 layered 演算法排列節點。
// 使用 elk.bundled.js（不需要 Web Worker），瀏覽器與 Node 都能執行。
// ELK 約 1.5 MB，只在第一次自動排版時才動態載入，不影響畫布開啟速度
import type ELKType from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';

export interface LayoutNode {
  id: string;
  w: number;
  h: number;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
}

export interface LayoutInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  direction: 'down' | 'right';
  /** 同層節點間距；層與層之間的間距為其 1.25 倍。預設 48 */
  spacing?: number;
}

export interface LayoutResult {
  /** 每個節點左上角的位置；整體排版的左上角為 (0, 0) */
  positions: Record<string, { x: number; y: number }>;
}

let elk: Promise<InstanceType<typeof ELKType>> | null = null;
function getElk() {
  if (!elk) elk = import('elkjs/lib/elk.bundled.js').then((m) => new (m.default as typeof ELKType)());
  return elk;
}

export async function layoutGraph(input: LayoutInput): Promise<LayoutResult> {
  const spacing = input.spacing ?? 48;
  if (input.nodes.length === 0) return { positions: {} };
  const ids = new Set(input.nodes.map((n) => n.id));
  const edges = input.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const graph: ElkNode = {
    id: '__root__',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': input.direction === 'down' ? 'DOWN' : 'RIGHT',
      'elk.spacing.nodeNode': String(spacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.round(spacing * 1.25)),
      'elk.spacing.componentComponent': String(spacing),
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: input.nodes.map((n) => ({ id: n.id, width: Math.max(1, n.w), height: Math.max(1, n.h) })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  };
  const out = await (await getElk()).layout(graph);
  const positions: Record<string, { x: number; y: number }> = {};
  let minX = Infinity;
  let minY = Infinity;
  for (const c of out.children ?? []) {
    minX = Math.min(minX, c.x ?? 0);
    minY = Math.min(minY, c.y ?? 0);
  }
  for (const c of out.children ?? []) {
    positions[c.id] = { x: (c.x ?? 0) - minX, y: (c.y ?? 0) - minY };
  }
  return { positions };
}
