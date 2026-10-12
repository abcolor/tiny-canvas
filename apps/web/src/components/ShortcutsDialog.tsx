import { Dialog, Kbd, strings } from '@tinycanvas/ui';

const S = strings.shortcuts;
const groups: { title: string; items: [string, string[]][] }[] = [
  {
    title: S.groups.tools,
    items: [
      [S.items.select, ['V']],
      [S.items.hand, ['H']],
      [S.items.rectangle, ['R']],
      [S.items.ellipse, ['O']],
      [S.items.text, ['T']],
      [S.items.connector, ['L']],
      [S.items.wireframe, ['W']],
      [S.items.icon, ['I']],
      [S.items.palette, ['/']],
    ],
  },
  {
    title: S.groups.edit,
    items: [
      [S.items.undo, ['Mod+Z']],
      [S.items.redo, ['Mod+Shift+Z']],
      [S.items.duplicate, ['Mod+D']],
      [S.items.delete, ['Delete']],
      [S.items.selectAll, ['Mod+A']],
      [S.items.editText, ['Enter']],
      [S.items.exit, ['Esc']],
      [S.items.cycle, ['Tab']],
      [S.items.link, ['Mod+K']],
    ],
  },
  {
    title: S.groups.arrange,
    items: [
      [S.items.group, ['Mod+G']],
      [S.items.ungroup, ['Mod+Shift+G']],
      [S.items.extend, ['Mod+Alt+↑↓←→']],
      [S.items.nudge, ['↑↓←→']],
      [S.items.lock, ['Mod+Shift+L']],
      [S.items.disableSnap, ['Alt']],
    ],
  },
  {
    title: S.groups.view,
    items: [
      [S.items.zoomIn, ['Mod+=']],
      [S.items.zoomOut, ['Mod+-']],
      [S.items.zoomFit, ['Shift+1']],
      [S.items.zoomSelection, ['Shift+2']],
    ],
  },
  {
    title: S.groups.app,
    items: [
      [S.items.search, ['Mod+K']],
      [S.items.export, ['Mod+Shift+E']],
      [S.items.help, ['Mod+/']],
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={S.title} width="max-w-3xl">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">{g.title}</h3>
            <ul className="flex flex-col gap-1.5">
              {g.items.map(([label, combos]) => (
                <li key={label} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink-700">{label}</span>
                  <span className="flex gap-1">
                    {combos.map((c) => (
                      <Kbd key={c} combo={c} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
