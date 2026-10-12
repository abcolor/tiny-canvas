import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { BoardEditor } from '@tinycanvas/canvas-engine';
import { textEditOrigin, type Editor } from '@tinycanvas/editor';
import { getObjects, readObject, SHAPE_KINDS, type ShapeKind } from '@tinycanvas/shared';
import { ConfirmDialog, MenuItem, MenuSeparator, PointMenu, strings } from '@tinycanvas/ui';
import { useHotkeys } from '../lib/useHotkeys';
import { useDialogs } from '../components/dialogs';
import { useEditorState } from './useEditorState';
import { Toolbar } from './Toolbar';
import { StyleBar, useSelectedObjects } from './StyleBar';
import { ArrangeMenuItems } from './ArrangeMenu';
import { TextEditingLayer } from './TextEditingLayer';
import { ZoomControls } from './ZoomControls';
import { ShapeGlyph } from './ShapeGlyph';
import { CommandPalette } from './CommandPalette';
import { WireframeLibrary } from './WireframeLibrary';
import { IconLibrary } from './IconLibrary';
import { ExportDialog } from './ExportDialog';
import { TableMenuItems } from './TableMenu';
import { uploadImage, UploadError } from './assets';

export interface BoardCanvasProps {
  doc: Y.Doc;
  readOnly?: boolean;
  loadImage: (assetId: string) => Promise<CanvasImageSource>;
  onOpenLink?: (fileId: string) => void;
  /** 由外層（頁首按鈕）控制的對話框 */
  exportOpen?: boolean;
  onExportOpenChange?: (o: boolean) => void;
  onInsertLinkCard?: (insert: (fileId: string, title: string) => void) => void;
  /** 匯出檔名 */
  title?: string;
  /** 取得引擎實例（版本歷史還原需要使用同一個 UndoManager） */
  onEditor?: (editor: BoardEditor | null) => void;
}

/** 建立畫布引擎並疊上所有 React 介面：工具列、樣式列、文字編輯、選單與對話框 */
export function BoardCanvas(props: BoardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<BoardEditor | null>(null);
  const { toast } = useDialogs();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const container = containerRef.current!;
    const ed = new BoardEditor({
      doc: props.doc,
      container,
      readOnly: props.readOnly,
      extraTrackedOrigins: [textEditOrigin],
      loadImage: (id) => propsRef.current.loadImage(id),
      uploadImage: props.readOnly
        ? undefined
        : async (file) => {
            try {
              return await uploadImage(file);
            } catch (e) {
              toastRef.current(e instanceof UploadError ? e.message : strings.errors.uploadFailed);
              throw e;
            }
          },
      onOpenLink: props.onOpenLink ? (id) => propsRef.current.onOpenLink?.(id) : undefined,
      labels: strings.canvas,
    });
    setEditor(ed);
    props.onEditor?.(ed);
    // 開發與 E2E 測試用：讓測試可以檢查畫布狀態（版本預覽關閉後還原為主畫布）
    const debug = window as unknown as { __tcEditor?: BoardEditor };
    const previous = debug.__tcEditor;
    if (import.meta.env.DEV) debug.__tcEditor = ed;
    ed.focus();
    return () => {
      if (import.meta.env.DEV && debug.__tcEditor === ed) debug.__tcEditor = previous;
      props.onEditor?.(null);
      ed.destroy();
      setEditor(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.doc, props.readOnly]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-50">
      <div ref={containerRef} className="absolute inset-0" data-testid="board-canvas" />
      {editor ? <BoardUi editor={editor} {...props} /> : null}
    </div>
  );
}

function BoardUi({
  editor,
  readOnly,
  exportOpen,
  onExportOpenChange,
  onInsertLinkCard,
  title,
}: BoardCanvasProps & { editor: BoardEditor }) {
  const state = useEditorState(editor);
  const selected = useSelectedObjects(editor, state);
  const [textEditor, setTextEditor] = useState<Editor | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [wireframesOpen, setWireframesOpen] = useState(false);
  const [iconsOpen, setIconsOpen] = useState(false);
  const [localExportOpen, setLocalExportOpen] = useState(false);
  const { prompt, toast } = useDialogs();
  const exportIsOpen = exportOpen ?? localExportOpen;
  const setExportOpen = onExportOpenChange ?? setLocalExportOpen;

  useHotkeys(
    readOnly
      ? [{ combo: 'Mod+Shift+E', handler: () => setExportOpen(true) }]
      : [
          { combo: '/', handler: () => setPaletteOpen(true) },
          { combo: 'W', handler: () => setWireframesOpen(true) },
          { combo: 'I', handler: () => setIconsOpen(true) },
          { combo: 'Mod+Shift+E', handler: () => setExportOpen(true) },
        ],
  );

  const requestLink = useCallback(() => {
    const ed = textEditor;
    if (!ed) return;
    const prev = ed.getAttributes('link').href as string | undefined;
    prompt({
      title: strings.style.link,
      label: strings.style.linkPrompt,
      initial: prev ?? 'https://',
      onSubmit: (href) => {
        const url = /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`;
        ed.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      },
    });
  }, [textEditor, prompt]);

  const insertImage = async (file: File) => {
    try {
      await editor.insertImageFile(file);
    } catch {
      /* 錯誤已在 uploadImage 內提示 */
    }
  };

  const insertLinkCard = () =>
    onInsertLinkCard?.((fileId, title) =>
      editor.insert({ type: 'link_card', x: 0, y: 0, w: 240, h: 72, targetFileId: fileId, targetTitle: title }, { select: true, atViewportCenter: true }),
    );

  const cm = state.contextMenu;
  const cmTarget = cm?.targetId ? getObjects(editor.doc).get(cm.targetId) : undefined;
  const cmObj = cmTarget ? readObject(cmTarget) : null;
  const pendingSection = state.pendingSectionDelete;

  return (
    <>
      {!readOnly ? (
        <div className="pointer-events-none absolute left-3 top-1/2 z-20 -translate-y-1/2">
          <Toolbar
            editor={editor}
            state={state}
            onOpenWireframes={() => setWireframesOpen(true)}
            onOpenIcons={() => setIconsOpen(true)}
            onPickImage={insertImage}
            onInsertLinkCard={insertLinkCard}
          />
        </div>
      ) : null}

      {state.placing ? (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-xl bg-ink-900 px-3.5 py-2 text-sm text-white shadow-float"
        >
          {strings.arrange.placeHint}
        </div>
      ) : (
        <StyleBar editor={editor} state={state} textEditor={textEditor} onRequestLink={requestLink} />
      )}
      <TextEditingLayer editor={editor} state={state} onTextEditor={setTextEditor} onRequestLink={requestLink} />
      <ZoomControls editor={editor} state={state} />

      <PointMenu point={cm ? cm.screen : null} onClose={() => editor.closeContextMenu()}>
        {readOnly ? (
          <MenuItem onSelect={() => editor.zoomToFit()}>{strings.board.zoomToFit}</MenuItem>
        ) : selected.length > 0 ? (
          <>
            {cmObj?.type === 'table' ? (
              <>
                <TableMenuItems editor={editor} table={cmObj} cellKey={cm?.cellKey} />
                <MenuSeparator />
              </>
            ) : null}
            <MenuItem shortcut="Mod+C" onSelect={() => editor.copySelectionToClipboard()}>
              {strings.arrange.copy}
            </MenuItem>
            <MenuItem shortcut="Mod+X" onSelect={() => editor.cutSelectionToClipboard()}>
              {strings.arrange.cut}
            </MenuItem>
            <ArrangeMenuItems editor={editor} selected={selected} />
          </>
        ) : (
          <>
            <MenuItem shortcut="Mod+V" onSelect={() => void editor.pasteFromClipboard()}>
              {strings.arrange.paste}
            </MenuItem>
            <MenuItem shortcut="Mod+A" onSelect={() => editor.selectAll()}>
              {strings.arrange.selectAll}
            </MenuItem>
            <MenuSeparator />
            <MenuItem shortcut="Shift+1" onSelect={() => editor.zoomToFit()}>
              {strings.board.zoomToFit}
            </MenuItem>
          </>
        )}
      </PointMenu>

      <PointMenu point={state.quickConnect ? state.quickConnect.screen : null} onClose={() => editor.cancelQuickConnect()}>
        <div className="px-2 pb-1 pt-1.5 text-xs text-ink-400">{strings.quickConnect.title}</div>
        <div className="grid grid-cols-5 gap-1 p-1">
          {SHAPE_KINDS.map((k: ShapeKind) => (
            <button
              key={k}
              type="button"
              title={strings.shapes[k]}
              aria-label={strings.shapes[k]}
              onClick={() => editor.completeQuickConnect(k)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100"
            >
              <ShapeGlyph kind={k} />
            </button>
          ))}
        </div>
      </PointMenu>

      <ConfirmDialog
        open={Boolean(pendingSection)}
        onOpenChange={(o) => !o && editor.resolveSectionDelete(null)}
        title={strings.section.deleteTitle}
        message={strings.section.deleteMessage}
        cancelLabel={strings.common.cancel}
        actions={[
          { label: strings.section.sectionOnly, variant: 'secondary', onSelect: () => editor.resolveSectionDelete('section-only') },
          { label: strings.section.withContents, variant: 'danger', onSelect: () => editor.resolveSectionDelete('with-contents') },
        ]}
      />

      {!readOnly ? (
        <>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={(o) => {
              setPaletteOpen(o);
              if (!o) editor.focus();
            }}
            editor={editor}
            onInsertLinkCard={insertLinkCard}
            onOpenWireframes={() => setWireframesOpen(true)}
            onOpenIcons={() => setIconsOpen(true)}
          />
          <IconLibrary
            open={iconsOpen}
            onOpenChange={(o) => {
              setIconsOpen(o);
              if (!o) editor.focus();
            }}
            onPick={(iconName) => editor.insertWithTool({ kind: 'icon', iconName })}
          />
          <WireframeLibrary
            open={wireframesOpen}
            onOpenChange={(o) => {
              setWireframesOpen(o);
              if (!o) editor.focus();
            }}
            editor={editor}
          />
        </>
      ) : null}
      <ExportDialog open={exportIsOpen} onOpenChange={setExportOpen} editor={editor} hasSelection={selected.length > 0} onError={toast} fileName={title} />
    </>
  );
}
