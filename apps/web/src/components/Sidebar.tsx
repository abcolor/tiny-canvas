import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import {
  ChevronRight,
  Clock,
  Download,
  FilePlus2,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  LayoutPanelTop,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import {
  cn,
  IconButton,
  INTL_LOCALE,
  locale,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  strings,
} from '@tinycanvas/ui';
import type { FileDto, FolderDto } from '@tinycanvas/shared';
import { useFiles, useFolders } from '../api/hooks';
import { useFileActions } from './fileActions';
import { Logo } from './Logo';
import { BoardIcon } from './BoardIcon';
import { LanguageMenu } from './LanguageMenu';

const DND_TYPE = 'application/x-tinycanvas-item';
type DragItem = { kind: 'file' | 'folder'; id: string };

function readDrag(e: DragEvent): DragItem | null {
  try {
    return JSON.parse(e.dataTransfer.getData(DND_TYPE));
  } catch {
    return null;
  }
}

function isDescendant(folders: FolderDto[], maybeChild: string, ancestor: string): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let cur = byId.get(maybeChild);
  while (cur) {
    if (cur.id === ancestor) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

export function Sidebar({
  onSearch,
  onLogout,
  onCollapse,
  email,
}: {
  onSearch: () => void;
  onLogout: () => void;
  onCollapse: () => void;
  email: string;
}) {
  const s = strings.sidebar;
  const folders = useFolders();
  const actions = useFileActions();
  const [rootOver, setRootOver] = useState(false);

  const drop = async (e: DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    const item = readDrag(e);
    if (!item) return;
    if (item.kind === 'file') {
      await actions.moveFile({ id: item.id } as FileDto, targetFolderId);
    } else if (item.id !== targetFolderId && !(targetFolderId && isDescendant(folders.data ?? [], targetFolderId, item.id))) {
      await actions.moveFolder({ id: item.id } as FolderDto, targetFolderId);
    }
  };

  return (
    <nav className="flex h-full w-64 shrink-0 flex-col border-r border-ink-100 bg-white" aria-label={s.files}>
      <div className="flex h-12 items-center justify-between px-3">
        <NavLink to="/" aria-label={s.home}>
          <Logo />
        </NavLink>
        <IconButton label={s.collapse} onClick={onCollapse}>
          <PanelLeftClose className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={onSearch}
          className="flex h-8 w-full items-center gap-2 rounded-lg bg-ink-50 px-2.5 text-sm text-ink-500 hover:bg-ink-100"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">{s.search}</span>
          <kbd className="text-xs text-ink-400">{navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl+K'}</kbd>
        </button>
      </div>
      <div className="flex flex-col gap-0.5 px-2">
        <NavItem to="/" icon={<Clock className="h-4 w-4" />} label={s.recent} end />
        <NavItem to="/favorites" icon={<Star className="h-4 w-4" />} label={s.favorites} />
        <NavItem to="/trash" icon={<Trash2 className="h-4 w-4" />} label={s.trash} />
      </div>
      <div className="mt-4 flex items-center justify-between px-4 text-xs font-medium uppercase tracking-wide text-ink-400">
        <span>{s.files}</span>
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={s.newBoard} className="h-6 w-6">
              <Plus className="h-4 w-4" />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={<FilePlus2 className="h-4 w-4" />} onSelect={() => actions.newBoard(null)}>
              {s.newBoard}
            </MenuItem>
            <MenuItem icon={<FolderPlus className="h-4 w-4" />} onSelect={() => actions.newFolder(null)}>
              {s.newFolder}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <div
        className={cn('mt-1 flex-1 overflow-y-auto px-2 pb-4', rootOver && 'bg-brand-50')}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DND_TYPE)) {
            e.preventDefault();
            setRootOver(true);
          }
        }}
        onDragLeave={() => setRootOver(false)}
        onDrop={(e) => {
          setRootOver(false);
          void drop(e, null);
        }}
      >
        <FolderChildren parentId={null} folders={folders.data ?? []} depth={0} onDrop={drop} />
      </div>
      <div className="flex items-center gap-2 border-t border-ink-100 px-3 py-2 text-sm">
        <span className="flex-1 truncate text-ink-500" title={email}>
          {email}
        </span>
        <LanguageMenu />
        <IconButton label={strings.auth.logout} onClick={onLogout} tooltipSide="top">
          <LogOut className="h-4 w-4" />
        </IconButton>
      </div>
    </nav>
  );
}

function NavItem({ to, icon, label, end }: { to: string; icon: ReactNode; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-ink-700 hover:bg-ink-50',
          isActive && 'bg-brand-50 font-medium text-brand-800 hover:bg-brand-50',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

function FolderChildren({
  parentId,
  folders,
  depth,
  onDrop,
}: {
  parentId: string | null;
  folders: FolderDto[];
  depth: number;
  onDrop: (e: DragEvent, folderId: string | null) => void;
}) {
  const children = useMemo(
    () =>
      folders
        .filter((f) => f.parentId === parentId)
        .sort((a, b) => (a.sortKey === b.sortKey ? a.name.localeCompare(b.name, INTL_LOCALE[locale]) : a.sortKey < b.sortKey ? -1 : 1)),
    [folders, parentId],
  );
  const files = useFiles(parentId ?? 'root');
  const sortedFiles = useMemo(
    () => [...(files.data ?? [])].sort((a, b) => a.title.localeCompare(b.title, INTL_LOCALE[locale])),
    [files.data],
  );
  if (depth > 0 && children.length === 0 && sortedFiles.length === 0 && !files.isLoading) {
    return (
      <div className="py-1 text-xs text-ink-400" style={{ paddingLeft: 12 + depth * 14 }}>
        {strings.sidebar.emptyFolder}
      </div>
    );
  }
  return (
    <ul role="group">
      {children.map((f) => (
        <FolderRow key={f.id} folder={f} folders={folders} depth={depth} onDrop={onDrop} />
      ))}
      {sortedFiles.map((f) => (
        <FileRow key={f.id} file={f} depth={depth} folders={folders} />
      ))}
    </ul>
  );
}

function FolderRow({
  folder,
  folders,
  depth,
  onDrop,
}: {
  folder: FolderDto;
  folders: FolderDto[];
  depth: number;
  onDrop: (e: DragEvent, folderId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const actions = useFileActions();
  const s = strings;
  return (
    <li role="treeitem" aria-expanded={open}>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: 'folder', id: folder.id }));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DND_TYPE)) {
            e.preventDefault();
            e.stopPropagation();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.stopPropagation();
          setOver(false);
          setOpen(true);
          onDrop(e, folder.id);
        }}
        className={cn('group flex h-8 items-center rounded-lg pr-1 text-sm text-ink-700 hover:bg-ink-50', over && 'bg-brand-100')}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          type="button"
          aria-label={folder.name}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform', open && 'rotate-90')} />
          {folder.isTabbed ? (
            <LayoutPanelTop className="h-4 w-4 shrink-0 text-ink-500" />
          ) : open ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-ink-500" />
          ) : (
            <FolderIcon className="h-4 w-4 shrink-0 text-ink-500" />
          )}
          <span className="truncate">{folder.name}</span>
        </button>
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label={s.common.more}
              className="rounded p-1 text-ink-400 opacity-0 hover:bg-ink-100 focus:opacity-100 group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuItem icon={<FilePlus2 className="h-4 w-4" />} onSelect={() => actions.newBoard(folder.id)}>
              {s.sidebar.newBoard}
            </MenuItem>
            <MenuItem icon={<FolderPlus className="h-4 w-4" />} onSelect={() => actions.newFolder(folder.id)}>
              {s.sidebar.newFolder}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => actions.renameFolder(folder)}>{s.common.rename}</MenuItem>
            <MenuCheckboxItem checked={folder.isTabbed} onCheckedChange={(v) => actions.setTabbed(folder, v)}>
              {s.files.tabbedFolder}
            </MenuCheckboxItem>
            <MoveToMenu
              folders={folders.filter((f) => f.id !== folder.id && !isDescendant(folders, f.id, folder.id))}
              currentId={folder.parentId}
              onMove={(id) => actions.moveFolder(folder, id)}
            />
            <MenuSeparator />
            <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onSelect={() => actions.trashFolder(folder)}>
              {s.files.moveToTrash}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {open ? <FolderChildren parentId={folder.id} folders={folders} depth={depth + 1} onDrop={onDrop} /> : null}
    </li>
  );
}

function FileRow({ file, depth, folders }: { file: FileDto; depth: number; folders: FolderDto[] }) {
  const { fileId } = useParams();
  return (
    <li role="treeitem">
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: 'file', id: file.id }));
          e.dataTransfer.effectAllowed = 'move';
        }}
        className={cn(
          'group flex h-8 items-center rounded-lg pr-1 text-sm text-ink-700 hover:bg-ink-50',
          fileId === file.id && 'bg-brand-50 text-brand-900',
        )}
        style={{ paddingLeft: 22 + depth * 14 }}
      >
        <NavLink to={`/b/${file.id}`} className="flex min-w-0 flex-1 items-center gap-1.5">
          <BoardIcon className="h-4 w-4 shrink-0 text-ink-400" />
          <span className="truncate">{file.title}</span>
        </NavLink>
        <FileMenu file={file} folders={folders} triggerClassName="opacity-0 group-hover:opacity-100 focus:opacity-100" />
      </div>
    </li>
  );
}

export function MoveToMenu({
  folders,
  currentId,
  onMove,
}: {
  folders: FolderDto[];
  currentId: string | null;
  onMove: (folderId: string | null) => void;
}) {
  return (
    <MenuSub>
      <MenuSubTrigger>{strings.files.moveTo}</MenuSubTrigger>
      <MenuSubContent>
        <MenuItem disabled={currentId === null} onSelect={() => onMove(null)}>
          {strings.files.moveToRoot}
        </MenuItem>
        {folders.map((f) => (
          <MenuItem key={f.id} disabled={currentId === f.id} icon={<FolderIcon className="h-4 w-4" />} onSelect={() => onMove(f.id)}>
            {f.name}
          </MenuItem>
        ))}
      </MenuSubContent>
    </MenuSub>
  );
}

export function FileMenu({
  file,
  folders,
  triggerClassName,
}: {
  file: FileDto;
  folders: FolderDto[];
  triggerClassName?: string;
}) {
  const actions = useFileActions();
  const s = strings;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={s.common.more}
          className={cn('rounded p-1 text-ink-400 hover:bg-ink-100', triggerClassName)}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuItem onSelect={() => actions.renameFile(file)}>{s.common.rename}</MenuItem>
        <MenuItem icon={<Star className="h-4 w-4" />} onSelect={() => actions.toggleFavorite(file)}>
          {file.isFavorite ? s.files.unfavorite : s.files.favorite}
        </MenuItem>
        <MoveToMenu folders={folders} currentId={file.folderId} onMove={(id) => actions.moveFile(file, id)} />
        <MenuItem icon={<Download className="h-4 w-4" />} onSelect={() => actions.exportFile(file)}>
          {s.files.export}
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onSelect={() => actions.trashFile(file)}>
          {s.files.moveToTrash}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
