import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, strings } from '@tinycanvas/ui';
import type { MeResponse } from '@tinycanvas/shared';
import { api, ApiError, setCsrfToken } from '../api/client';
import { keys, useAuthConfig } from '../api/hooks';
import { Logo } from '../components/Logo';
import { LanguageMenu } from '../components/LanguageMenu';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const s = strings.auth;
  const qc = useQueryClient();
  const nav = useNavigate();
  const config = useAuthConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/auth/${mode}`, { method: 'POST', body: { email, password } });
      const me = await api<MeResponse>('/api/me');
      setCsrfToken(me.csrfToken);
      qc.setQueryData(keys.me, me);
      nav('/', { replace: true });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(
        code === 'invalid_credentials'
          ? s.invalidCredentials
          : code === 'rate_limited'
            ? s.rateLimited
            : code === 'signup_disabled'
              ? s.signupDisabled
              : code === 'email_taken'
                ? s.emailTaken
                : code === 'invalid_request'
                  ? s.invalidInput
                  : strings.app.genericError,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{mode === 'login' ? s.loginTitle : s.signupTitle}</h1>
          <Field label={s.email}>
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={s.password} hint={mode === 'signup' ? s.passwordHint : undefined}>
            <Input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" loading={busy}>
            {mode === 'login' ? s.login : s.signup}
          </Button>
          {config.data?.allowSignup ? (
            <p className="text-center text-sm text-ink-500">
              {mode === 'login' ? s.noAccount : s.haveAccount}{' '}
              <Link className="text-brand-700 hover:underline" to={mode === 'login' ? '/signup' : '/login'}>
                {mode === 'login' ? s.signup : s.login}
              </Link>
            </p>
          ) : null}
        </form>
        <div className="mt-4 flex justify-center">
          <LanguageMenu side="bottom" />
        </div>
      </div>
    </div>
  );
}
