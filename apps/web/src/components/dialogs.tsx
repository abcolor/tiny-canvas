import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Toast } from '@tinycanvas/ui';
import { PromptDialog } from './PromptDialog';

interface PromptRequest {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void | Promise<void>;
}

interface DialogsApi {
  prompt: (req: PromptRequest) => void;
  toast: (message: string) => void;
}

const Ctx = createContext<DialogsApi>({ prompt: () => {}, toast: () => {} });

/** 全域的輸入對話框與提示訊息 */
export function DialogsProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<PromptRequest | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const prompt = useCallback((r: PromptRequest) => setReq(r), []);
  const toast = useCallback((m: string) => setMessage(m), []);
  const closeToast = useCallback(() => setMessage(null), []);
  return (
    <Ctx.Provider value={{ prompt, toast }}>
      {children}
      <PromptDialog
        open={req !== null}
        title={req?.title ?? ''}
        label={req?.label ?? ''}
        initial={req?.initial}
        confirmLabel={req?.confirmLabel}
        onSubmit={(v) => req?.onSubmit(v)}
        onClose={() => setReq(null)}
      />
      <Toast message={message} onClose={closeToast} />
    </Ctx.Provider>
  );
}

export function useDialogs() {
  return useContext(Ctx);
}
