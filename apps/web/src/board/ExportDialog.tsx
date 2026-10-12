import { useState } from 'react';
import type { BoardEditor } from '@tinycanvas/canvas-engine';
import { Button, Dialog, Segmented, strings } from '@tinycanvas/ui';

/** 匯出 PNG（見 SPEC.md 第 4.5 節）：在瀏覽器端繪製後下載，不經過伺服器 */
export function ExportDialog({
  open,
  onOpenChange,
  editor,
  hasSelection,
  onError,
  fileName = 'board',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editor: BoardEditor;
  hasSelection: boolean;
  onError: (msg: string) => void;
  fileName?: string;
}) {
  const s = strings.export;
  const [scope, setScope] = useState<'all' | 'selection'>('all');
  const [scale, setScale] = useState<1 | 2>(2);
  const [background, setBackground] = useState<'white' | 'transparent'>('white');
  const [busy, setBusy] = useState(false);
  const effectiveScope = hasSelection ? scope : 'all';

  const run = async () => {
    setBusy(true);
    try {
      const blob = await editor.exportPng({ scope: effectiveScope, scale, background });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName.replace(/[\\/:*?"<>|]+/g, '_') || 'board'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      onOpenChange(false);
    } catch (e) {
      const name = (e as Error).name;
      onError(name === 'ExportTooLargeError' ? s.tooLarge : name === 'ExportEmptyError' ? s.empty : strings.app.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={s.title}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-700">{s.scope}</span>
          <Segmented
            value={effectiveScope}
            onChange={setScope}
            options={[
              { value: 'all', label: s.scopeAll },
              ...(hasSelection ? [{ value: 'selection' as const, label: s.scopeSelection }] : []),
            ]}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-700">{s.scale}</span>
          <Segmented value={scale} onChange={setScale} options={[{ value: 1, label: '1x' }, { value: 2, label: '2x' }]} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-700">{s.background}</span>
          <Segmented
            value={background}
            onChange={setBackground}
            options={[
              { value: 'white', label: s.white },
              { value: 'transparent', label: s.transparent },
            ]}
          />
        </div>
        <div className="mt-2 flex justify-end">
          <Button variant="primary" loading={busy} onClick={run} data-testid="export-download">
            {busy ? s.exporting : s.download}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
