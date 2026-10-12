import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, buildUrl, setCsrfToken } from '../src/api/client';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('api client', () => {
  it('會改變資料的請求帶上 CSRF token，GET 不帶', async () => {
    setCsrfToken('tok');
    const fetch = mockFetch(200, { ok: true });
    await api('/api/files', { method: 'POST', body: { title: 'a' } });
    await api('/api/files');
    const [, postInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const [, getInit] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect((postInit.headers as Record<string, string>)['x-csrf-token']).toBe('tok');
    expect((getInit.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('錯誤回應轉成帶有錯誤代碼的 ApiError', async () => {
    mockFetch(403, { error: 'csrf' });
    await expect(api('/api/files', { method: 'DELETE' })).rejects.toMatchObject({ status: 403, code: 'csrf' });
  });

  it('網路錯誤轉成 network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed'))));
    const err = (await api("/api/me").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('network');
  });

  it('buildUrl 略過空值並編碼中文', () => {
    expect(buildUrl('/api/search', { q: '流程', cursor: undefined, x: null })).toBe('/api/search?q=%E6%B5%81%E7%A8%8B');
  });
});
