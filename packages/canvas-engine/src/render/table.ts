// 畫布內表格（見 SPEC.md 第 4.4 節）：表頭列、格線、儲存格內距、儲存格富文本
import type { TableObject } from '@tinycanvas/shared';
import type { Rect } from '../geometry';
import { resolveStyle } from '../style';
import { roundRectPath } from './shapes';
import { drawTextLayout } from './text';
import type { ObjectRenderer } from './draw';

export const TABLE_CELL_PAD = 8;
const HEADER_FILL = '#eef1f4';
const RADIUS = 6;

/** 儲存格範圍（世界座標）；找不到列或欄時回傳 null */
export function tableCellRect(o: TableObject, cellKey: string): Rect | null {
  const [rowId, colId] = cellKey.split(':');
  let y = o.y;
  let h = -1;
  for (const r of o.rows) {
    if (r.id === rowId) {
      h = r.height;
      break;
    }
    y += r.height;
  }
  let x = o.x;
  let w = -1;
  for (const c of o.columns) {
    if (c.id === colId) {
      w = c.width;
      break;
    }
    x += c.width;
  }
  return h < 0 || w < 0 ? null : { x, y, w, h };
}

/** 儲存格的文字框（扣除內距） */
export function tableCellTextBox(o: TableObject, cellKey: string): Rect | null {
  const r = tableCellRect(o, cellKey);
  return r ? { x: r.x + TABLE_CELL_PAD, y: r.y + TABLE_CELL_PAD, w: Math.max(1, r.w - 2 * TABLE_CELL_PAD), h: Math.max(1, r.h - 2 * TABLE_CELL_PAD) } : null;
}

/** 世界座標點所在的儲存格 */
export function tableCellAt(o: TableObject, p: { x: number; y: number }): string | null {
  let y = o.y;
  for (const r of o.rows) {
    if (p.y >= y && p.y <= y + r.height) {
      let x = o.x;
      for (const c of o.columns) {
        if (p.x >= x && p.x <= x + c.width) return `${r.id}:${c.id}`;
        x += c.width;
      }
      return null;
    }
    y += r.height;
  }
  return null;
}

export const tableRenderer: ObjectRenderer<TableObject> = {
  draw(ctx, o, rc) {
    const st = resolveStyle(o);
    const z = rc.zoom;
    const lw = Math.max(1, 0.8 / z);
    const r = RADIUS * z >= 1 ? RADIUS : 0;
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, o.x, o.y, o.w, o.h, r);
    ctx.fillStyle = st.fill;
    ctx.fill();
    ctx.clip();
    if (o.headerRow && o.rows[0]) {
      ctx.fillStyle = HEADER_FILL;
      ctx.fillRect(o.x, o.y, o.w, o.rows[0].height);
    }
    // 格線
    ctx.beginPath();
    let y = o.y;
    for (let i = 0; i < o.rows.length - 1; i++) {
      y += o.rows[i].height;
      ctx.moveTo(o.x, y);
      ctx.lineTo(o.x + o.w, y);
    }
    let x = o.x;
    for (let i = 0; i < o.columns.length - 1; i++) {
      x += o.columns[i].width;
      ctx.moveTo(x, o.y);
      ctx.lineTo(x, o.y + o.h);
    }
    ctx.strokeStyle = st.stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    roundRectPath(ctx, o.x, o.y, o.w, o.h, r);
    ctx.strokeStyle = st.stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
    if (st.fontSize * z < 1.2) return;
    const e = rc.editing;
    y = o.y;
    o.rows.forEach((row, ri) => {
      x = o.x;
      const header = o.headerRow && ri === 0;
      for (const c of o.columns) {
        const key = `${row.id}:${c.id}`;
        const blocks = o.cells[key];
        const editing = e && e.id === o.id && e.field === 'cell' && e.cellKey === key;
        if (blocks && blocks.length && !editing) {
          const box = { x: x + TABLE_CELL_PAD, y: y + TABLE_CELL_PAD, w: Math.max(1, c.width - 2 * TABLE_CELL_PAD), h: Math.max(1, row.height - 2 * TABLE_CELL_PAD) };
          const lay = rc.text.get(o.id + ':' + key, blocks, box.w, st.fontSize, header ? 700 : st.fontWeight);
          drawTextLayout(ctx, lay, box, { color: st.textColor, align: st.textAlign === 'center' ? 'center' : st.textAlign, valign: 'middle', zoom: z });
        }
        x += c.width;
      }
      y += row.height;
    });
  },
  drawLod(b, o, rc) {
    if (resolveStyle(o).fontSize * rc.zoom >= 4) return false;
    b.fill('#ffffff').rect(o.x, o.y, o.w, o.h);
    if (o.headerRow && o.rows[0]) b.fill(HEADER_FILL).rect(o.x, o.y, o.w, o.rows[0].height);
    b.stroke('#c5ccd3', 1).rect(o.x, o.y, o.w, o.h);
    return true;
  },
  getTextBox(o, field, cellKey) {
    return field === 'cell' && cellKey ? tableCellTextBox(o, cellKey) : null;
  },
};
