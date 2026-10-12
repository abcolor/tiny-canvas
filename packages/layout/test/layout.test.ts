import { describe, expect, it } from 'vitest';
import { layoutGraph } from '../src';

const nodes = [
  { id: 'a', w: 160, h: 80 },
  { id: 'b', w: 160, h: 80 },
  { id: 'c', w: 160, h: 80 },
  { id: 'd', w: 96, h: 96 },
];
const edges = [
  { id: 'e1', from: 'a', to: 'b' },
  { id: 'e2', from: 'a', to: 'c' },
  { id: 'e3', from: 'b', to: 'd' },
  { id: 'e4', from: 'c', to: 'd' },
];

function overlaps(p: Record<string, { x: number; y: number }>) {
  const list = nodes.map((n) => ({ ...n, ...p[n.id] }));
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i];
      const B = list[j];
      if (A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h) return true;
    }
  return false;
}

describe('layoutGraph', () => {
  it('由上而下：每一層都在上一層下方，沒有重疊，左上角為原點', async () => {
    const { positions: p } = await layoutGraph({ nodes, edges, direction: 'down' });
    expect(Object.keys(p).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(p.b.y).toBeGreaterThan(p.a.y + 80);
    expect(p.c.y).toBeGreaterThan(p.a.y + 80);
    expect(p.d.y).toBeGreaterThan(p.b.y + 80);
    expect(overlaps(p)).toBe(false);
    expect(Math.min(...Object.values(p).map((v) => v.x))).toBe(0);
    expect(Math.min(...Object.values(p).map((v) => v.y))).toBe(0);
  });

  it('由左至右：後繼節點在右邊', async () => {
    const { positions: p } = await layoutGraph({ nodes, edges, direction: 'right', spacing: 32 });
    expect(p.b.x).toBeGreaterThan(p.a.x + 160);
    expect(p.d.x).toBeGreaterThan(p.c.x + 160);
    expect(overlaps(p)).toBe(false);
  });

  it('忽略指向不存在節點的邊與自我迴圈；空輸入回傳空結果', async () => {
    const { positions } = await layoutGraph({
      nodes: [{ id: 'x', w: 10, h: 10 }],
      edges: [
        { id: 'e', from: 'x', to: 'missing' },
        { id: 'f', from: 'x', to: 'x' },
      ],
      direction: 'down',
    });
    expect(positions.x).toEqual({ x: 0, y: 0 });
    expect(await layoutGraph({ nodes: [], edges: [], direction: 'down' })).toEqual({ positions: {} });
  });
});
