import { useEffect, useState } from 'react';
import { Button, Dialog, Input, strings } from '@tinycanvas/ui';

export function PromptDialog({
  open,
  title,
  label,
  initial = '',
  confirmLabel = strings.common.save,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value.trim()) return;
          setBusy(true);
          try {
            await onSubmit(value.trim());
            onClose();
          } finally {
            setBusy(false);
          }
        }}
        className="flex flex-col gap-4"
      >
        <Input aria-label={label} placeholder={label} autoFocus value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
