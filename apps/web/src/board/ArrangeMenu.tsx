import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Group,
  LayoutGrid,
  Lock,
  MoveDown,
  MoveUp,
  Route,
  Trash2,
  Ungroup,
  Unlock,
} from 'lucide-react';
import type { BoardEditor } from '@tinycanvas/canvas-engine';
import type { BoardObject } from '@tinycanvas/shared';
import { MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, strings } from '@tinycanvas/ui';

/** 排列相關的選單項目，右鍵選單與工具列的「更多」共用 */
export function ArrangeMenuItems({
  editor,
  selected,
  hideDuplicate,
}: {
  editor: BoardEditor;
  selected: BoardObject[];
  /** 工具列上已有「複製」按鈕時，選單內不再重複顯示 */
  hideDuplicate?: boolean;
}) {
  const a = strings.arrange;
  const many = selected.length > 1;
  const hasSection = selected.some((o) => o.type === 'section');
  const isGroup = selected.length === 1 && selected[0].type === 'group';
  const allLocked = selected.length > 0 && selected.every((o) => o.locked);
  const shapes = selected.filter((o) => o.type === 'shape').length;
  const manualRoute = selected.length === 1 && selected[0].type === 'connector' && selected[0].waypoints.length > 0 && !selected[0].locked;
  return (
    <>
      {hideDuplicate ? null : (
        <MenuItem icon={<Copy className="h-4 w-4" />} onSelect={() => editor.startPlacingDuplicate()}>
          {a.duplicate}
        </MenuItem>
      )}
      {many ? (
        <MenuItem icon={<Group className="h-4 w-4" />} shortcut="Mod+G" disabled={hasSection} onSelect={() => editor.group()}>
          {a.group}
        </MenuItem>
      ) : null}
      {isGroup ? (
        <MenuItem icon={<Ungroup className="h-4 w-4" />} shortcut="Mod+Shift+G" onSelect={() => editor.ungroup()}>
          {a.ungroup}
        </MenuItem>
      ) : null}
      {manualRoute ? (
        <MenuItem icon={<Route className="h-4 w-4" />} onSelect={() => editor.updateObject(selected[0].id, { waypoints: [] })}>
          {a.resetRoute}
        </MenuItem>
      ) : null}
      <MenuItem
        icon={allLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        shortcut="Mod+Shift+L"
        onSelect={() => editor.setLocked(!allLocked)}
      >
        {allLocked ? a.unlock : a.lock}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<ArrowUpToLine className="h-4 w-4" />} onSelect={() => editor.bringToFront()}>
        {a.bringToFront}
      </MenuItem>
      <MenuItem icon={<MoveUp className="h-4 w-4" />} onSelect={() => editor.bringForward()}>
        {a.bringForward}
      </MenuItem>
      <MenuItem icon={<MoveDown className="h-4 w-4" />} onSelect={() => editor.sendBackward()}>
        {a.sendBackward}
      </MenuItem>
      <MenuItem icon={<ArrowDownToLine className="h-4 w-4" />} onSelect={() => editor.sendToBack()}>
        {a.sendToBack}
      </MenuItem>
      {many ? (
        <MenuSub>
          <MenuSubTrigger icon={<AlignStartVertical className="h-4 w-4" />}>{a.alignMenu}</MenuSubTrigger>
          <MenuSubContent>
            <MenuItem icon={<AlignStartVertical className="h-4 w-4" />} onSelect={() => editor.align('left')}>{a.alignLeft}</MenuItem>
            <MenuItem icon={<AlignCenterVertical className="h-4 w-4" />} onSelect={() => editor.align('hcenter')}>{a.alignHCenter}</MenuItem>
            <MenuItem icon={<AlignEndVertical className="h-4 w-4" />} onSelect={() => editor.align('right')}>{a.alignRight}</MenuItem>
            <MenuItem icon={<AlignStartHorizontal className="h-4 w-4" />} onSelect={() => editor.align('top')}>{a.alignTop}</MenuItem>
            <MenuItem icon={<AlignCenterHorizontal className="h-4 w-4" />} onSelect={() => editor.align('vcenter')}>{a.alignVCenter}</MenuItem>
            <MenuItem icon={<AlignEndHorizontal className="h-4 w-4" />} onSelect={() => editor.align('bottom')}>{a.alignBottom}</MenuItem>
            {selected.length > 2 ? (
              <>
                <MenuSeparator />
                <MenuItem onSelect={() => editor.distribute('h')}>{a.distributeH}</MenuItem>
                <MenuItem onSelect={() => editor.distribute('v')}>{a.distributeV}</MenuItem>
              </>
            ) : null}
          </MenuSubContent>
        </MenuSub>
      ) : null}
      {shapes > 1 ? (
        <>
          <MenuItem icon={<LayoutGrid className="h-4 w-4" />} onSelect={() => void editor.autoLayout('down')}>
            {a.autoLayoutDown}
          </MenuItem>
          <MenuItem icon={<LayoutGrid className="h-4 w-4 -rotate-90" />} onSelect={() => void editor.autoLayout('right')}>
            {a.autoLayoutRight}
          </MenuItem>
        </>
      ) : null}
      <MenuSeparator />
      <MenuItem danger icon={<Trash2 className="h-4 w-4" />} shortcut="Delete" onSelect={() => editor.deleteSelection()}>
        {a.delete}
      </MenuItem>
    </>
  );
}
