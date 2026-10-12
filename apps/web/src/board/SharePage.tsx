import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Eye, Lock } from 'lucide-react';
import type { SharedInfoResponse, UnlockResponse } from '@tinycanvas/shared';
import { VIEW_TOKEN_TTL_SECONDS } from '@tinycanvas/shared';
import { Button, Input, Spinner, strings } from '@tinycanvas/ui';
import { api, ApiError } from '../api/client';
import { Logo } from '../components/Logo';
import { BoardCanvas } from './BoardCanvas';
import { createImageLoader } from './assets';
import { useBoardDoc } from './useBoardDoc';

type Phase =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'password'; info: SharedInfoResponse; error?: string }
  | { kind: 'ready'; info: SharedInfoResponse; viewToken: string };

/** 唯讀分享頁面 /s/{token}：不需要登入，只能檢視（見 SPEC.md 第 5.3 節） */
export function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchInfo = async () => {
    try {
      const info = await api<SharedInfoResponse>(`/api/shared/${token}`);
      if (info.viewToken) setPhase({ kind: 'ready', info, viewToken: info.viewToken });
      else setPhase((p) => (p.kind === 'ready' ? { kind: 'password', info } : { kind: 'password', info }));
    } catch {
      setPhase({ kind: 'invalid' });
    }
  };
  useEffect(() => {
    void fetchInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 檢視 token 2 小時後過期：提前重新取得（有密碼時要求重新輸入）
  const viewToken = phase.kind === 'ready' ? phase.viewToken : null;
  useEffect(() => {
    if (!viewToken) return;
    const t = setTimeout(() => void fetchInfo(), (VIEW_TOKEN_TTL_SECONDS - 120) * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewToken]);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase.kind !== 'password') return;
    setBusy(true);
    try {
      const r = await api<UnlockResponse>(`/api/shared/${token}/unlock`, { method: 'POST', body: { password } });
      setPhase({ kind: 'ready', info: phase.info, viewToken: r.viewToken });
      setPassword('');
    } catch (err) {
      const msg =
        err instanceof ApiError && err.code === 'rate_limited'
          ? strings.auth.rateLimited
          : err instanceof ApiError && err.status === 404
            ? strings.share.linkInvalid
            : strings.share.wrongPassword;
      setPhase({ ...phase, error: msg });
    } finally {
      setBusy(false);
    }
  };

  if (phase.kind === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (phase.kind === 'invalid') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-ink-500">
        <Logo />
        <p>{strings.share.linkInvalid}</p>
      </div>
    );
  }
  if (phase.kind === 'password') {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <form onSubmit={unlock} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-sm">
          <Logo />
          <div className="flex items-center gap-2 text-sm text-ink-600">
            <Lock className="h-4 w-4" />
            {strings.share.unlockTitle}
          </div>
          <div className="text-base font-semibold">{phase.info.title}</div>
          <Input type="password" autoFocus aria-label={strings.auth.password} value={password} onChange={(e) => setPassword(e.target.value)} />
          {phase.error ? (
            <p role="alert" className="text-sm text-red-600">
              {phase.error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" loading={busy}>
            {strings.share.unlock}
          </Button>
        </form>
      </div>
    );
  }
  return <SharedBoard info={phase.info} viewToken={phase.viewToken} />;
}

function SharedBoard({ info, viewToken }: { info: SharedInfoResponse; viewToken: string }) {
  // sync 連線使用第一次取得的 token；之後更新的 token 只用於讀取圖片
  const [connectToken] = useState(viewToken);
  const board = useBoardDoc(info.fileId, { kind: 'view', token: connectToken });
  const tokenRef = useRef(viewToken);
  tokenRef.current = viewToken;
  const loadImage = useMemo(() => {
    const loaders = new Map<string, ReturnType<typeof createImageLoader>>();
    return (assetId: string) => {
      const t = tokenRef.current;
      let l = loaders.get(t);
      if (!l) loaders.set(t, (l = createImageLoader(t)));
      return l(assetId);
    };
  }, []);

  return (
    <div className="relative h-full">
      {board.status === 'denied' || board.status === 'trashed' ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-ink-500">
          <Logo />
          <p>{strings.share.linkInvalid}</p>
        </div>
      ) : board.ready ? (
        <BoardCanvas doc={board.doc} readOnly loadImage={loadImage} title={info.title} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      )}
      <div className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-2">
        <span className="pointer-events-auto rounded-xl border border-ink-100 bg-white px-3 py-1.5 shadow-float">
          <Logo compact />
        </span>
        <span className="pointer-events-auto max-w-[50vw] truncate rounded-xl border border-ink-100 bg-white px-3 py-1.5 text-sm font-medium shadow-float">
          {info.title}
        </span>
        <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-xl border border-ink-100 bg-white px-2.5 py-1.5 text-xs text-ink-500 shadow-float">
          <Eye className="h-3.5 w-3.5" />
          {strings.board.readOnly}
        </span>
      </div>
    </div>
  );
}
