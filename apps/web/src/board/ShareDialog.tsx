import { useState } from 'react';
import { Copy, Link2Off, Lock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ShareLinkDto } from '@tinycanvas/shared';
import { Button, Dialog, Field, Input, strings } from '@tinycanvas/ui';
import { api } from '../api/client';
import { keys, useShareLinks } from '../api/hooks';
import { formatDateTime } from '../lib/time';

/** 唯讀分享連結：建立（可設密碼與到期日）、複製、撤銷（見 SPEC.md 第 5.3 節） */
export function ShareDialog({ fileId, open, onOpenChange }: { fileId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = strings.share;
  const qc = useQueryClient();
  const links = useShareLinks(fileId, open);
  const [password, setPassword] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.shareLinks(fileId) });

  const create = async () => {
    setBusy(true);
    try {
      await api<ShareLinkDto>(`/api/files/${fileId}/share-links`, {
        method: 'POST',
        body: { password: password || null, expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null },
      });
      setPassword('');
      setExpires('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    await api(`/api/files/${fileId}/share-links/${id}`, { method: 'DELETE' });
    await refresh();
  };
  const copy = async (token: string) => {
    await navigator.clipboard.writeText(`${location.origin}/s/${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  };

  const now = Date.now();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={s.title} description={s.hint} width="max-w-lg">
      <div className="flex flex-col gap-3 rounded-xl bg-ink-50 p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={s.password}>
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={s.expiresAt}>
            <Input type="date" value={expires} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" loading={busy} onClick={create}>
            {s.create}
          </Button>
        </div>
      </div>
      <ul className="mt-4 flex flex-col divide-y divide-ink-100">
        {(links.data ?? []).length === 0 ? <li className="py-4 text-center text-sm text-ink-400">{s.none}</li> : null}
        {(links.data ?? []).map((l) => {
          const expired = l.expiresAt ? new Date(l.expiresAt).getTime() < now : false;
          const inactive = Boolean(l.revokedAt) || expired;
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className={inactive ? 'truncate text-ink-400 line-through' : 'truncate font-mono text-xs text-ink-700'}>
                  {location.origin}/s/{l.token.slice(0, 10)}…
                </div>
                <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-ink-500">
                  {l.hasPassword ? (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="h-3 w-3" />
                      {s.hasPassword}
                    </span>
                  ) : null}
                  <span>{l.expiresAt ? `${s.expiresOn}${formatDateTime(l.expiresAt)}` : s.noExpiry}</span>
                  {l.revokedAt ? <span className="text-red-600">{s.revoked}</span> : expired ? <span className="text-red-600">{s.expired}</span> : null}
                </div>
              </div>
              {!inactive ? (
                <>
                  <Button size="sm" onClick={() => copy(l.token)}>
                    <Copy className="h-3.5 w-3.5" />
                    {copied === l.token ? strings.common.copied : s.copyLink}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => revoke(l.id)}>
                    <Link2Off className="h-3.5 w-3.5" />
                    {s.revoke}
                  </Button>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
