import type { BoardEditor } from '@tinycanvas/canvas-engine';
import type { TableObject } from '@tinycanvas/shared';
import { MenuCheckboxItem, MenuItem, strings } from '@tinycanvas/ui';

/** 表格的右鍵選單項目：增刪列與欄、表頭列（見 SPEC.md 第 4.4 節） */
export function TableMenuItems({ editor, table, cellKey }: { editor: BoardEditor; table: TableObject; cellKey?: string }) {
  const s = strings.table;
  const [rowId, colId] = (cellKey ?? '').split(':');
  const row = rowId || table.rows[table.rows.length - 1]?.id;
  const col = colId || table.columns[table.columns.length - 1]?.id;
  return (
    <>
      <MenuItem onSelect={() => editor.tableInsertRow(table.id, row, 'above')}>{s.addRowAbove}</MenuItem>
      <MenuItem onSelect={() => editor.tableInsertRow(table.id, row, 'below')}>{s.addRowBelow}</MenuItem>
      <MenuItem onSelect={() => editor.tableInsertColumn(table.id, col, 'left')}>{s.addColLeft}</MenuItem>
      <MenuItem onSelect={() => editor.tableInsertColumn(table.id, col, 'right')}>{s.addColRight}</MenuItem>
      <MenuItem disabled={table.rows.length <= 1} onSelect={() => editor.tableDeleteRow(table.id, row)}>
        {s.deleteRow}
      </MenuItem>
      <MenuItem disabled={table.columns.length <= 1} onSelect={() => editor.tableDeleteColumn(table.id, col)}>
        {s.deleteCol}
      </MenuItem>
      <MenuCheckboxItem checked={table.headerRow} onCheckedChange={(v) => editor.updateObject(table.id, { headerRow: v })}>
        {s.headerRow}
      </MenuCheckboxItem>
    </>
  );
}
