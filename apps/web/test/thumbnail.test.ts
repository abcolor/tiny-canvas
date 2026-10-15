import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { localOrigin, systemOrigin } from '@tinycanvas/shared';
import { ThumbnailSync, thumbnailStale, type ThumbnailDeps } from '../src/board/thumbnail';

const T0 = '2026-10-15T10:00:00.000Z';
const T1 = '2026-10-15T10:05:00.000Z';

describe('thumbnailStale', () => {
  it('有內容：沒有縮圖或內容在縮圖之後改過才算過時', () => {
    expect(thumbnailStale({ updatedAt: T0, thumbnailAt: null }, true)).toBe(true);
    expect(thumbnailStale({ updatedAt: T1, thumbnailAt: T0 }, true)).toBe(true);
    expect(thumbnailStale({ updatedAt: T0, thumbnailAt: T1 }, true)).toBe(false);
    expect(thumbnailStale({ updatedAt: T0, thumbnailAt: T0 }, true)).toBe(false);
  });

  it('空白畫布：還留著縮圖才算過時', () => {
    expect(thumbnailStale({ updatedAt: T1, thumbnailAt: T0 }, false)).toBe(true);
    expect(thumbnailStale({ updatedAt: T1, thumbnailAt: null }, false)).toBe(false);
  });
});

describe('ThumbnailSync', () => {
  let doc: Y.Doc;
  let deps: { [K in keyof ThumbnailDeps]: ReturnType<typeof vi.fn> };
  let empty: boolean;
  const blob = new Blob(['x'], { type: 'image/webp' });
  const edit = (origin: unknown = localOrigin) => doc.transact(() => doc.getMap('objects').set(String(Math.random()), 1), origin);
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new Y.Doc();
    empty = false;
    deps = {
      capture: vi.fn(() => (empty ? null : Promise.resolve(blob))),
      upload: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      onSaved: vi.fn(),
    };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('本地編輯停止 2 秒後才繪製一次並上傳', async () => {
    const s = new ThumbnailSync(doc, deps as unknown as ThumbnailDeps, { stale: false });
    edit();
    vi.advanceTimersByTime(1500);
    edit();
    vi.advanceTimersByTime(1500);
    expect(deps.capture).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(deps.capture).toHaveBeenCalledTimes(1);
    await settle();
    expect(deps.upload).toHaveBeenCalledWith(blob);
    expect(deps.onSaved).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it('遠端變更與 systemOrigin 的自動寫入不觸發', () => {
    const s = new ThumbnailSync(doc, deps as unknown as ThumbnailDeps, { stale: false });
    const remote = new Y.Doc();
    remote.getMap('objects').set('a', 1);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), 'provider');
    edit(systemOrigin);
    vi.advanceTimersByTime(5000);
    expect(deps.capture).not.toHaveBeenCalled();
    s.dispose();
    expect(deps.capture).not.toHaveBeenCalled();
  });

  it('開啟時縮圖過時就排一次', () => {
    const s = new ThumbnailSync(doc, deps as unknown as ThumbnailDeps, { stale: true });
    vi.advanceTimersByTime(2000);
    expect(deps.capture).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it('離開時有未上傳的變更就立即繪製；之後不再監聽', async () => {
    const s = new ThumbnailSync(doc, deps as unknown as ThumbnailDeps, { stale: false });
    edit();
    s.dispose();
    expect(deps.capture).toHaveBeenCalledTimes(1);
    await settle();
    expect(deps.upload).toHaveBeenCalledTimes(1);
    edit();
    vi.advanceTimersByTime(5000);
    expect(deps.capture).toHaveBeenCalledTimes(1);
  });

  it('畫布清空時刪除縮圖', async () => {
    const s = new ThumbnailSync(doc, deps as unknown as ThumbnailDeps, { stale: false });
    empty = true;
    edit();
    s.flush();
    await settle();
    expect(deps.remove).toHaveBeenCalledTimes(1);
    expect(deps.upload).not.toHaveBeenCalled();
    s.dispose();
  });

  it('上傳失敗時忽略，下一次仍可上傳', async () => {
    deps.upload.mockRejectedValueOnce(new Error('offline'));
    const s = new ThumbnailSync(doc, deps as unknown as ThumbnailDeps, { stale: false });
    edit();
    s.flush();
    await settle();
    expect(deps.onSaved).not.toHaveBeenCalled();
    edit();
    s.flush();
    await settle();
    expect(deps.upload).toHaveBeenCalledTimes(2);
    expect(deps.onSaved).toHaveBeenCalledTimes(1);
    s.dispose();
  });
});
