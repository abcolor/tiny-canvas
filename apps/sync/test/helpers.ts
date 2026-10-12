import { randomBytes, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { SignJWT } from 'jose';
import { pino } from 'pino';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { createPrisma } from '@tinycanvas/db';
import { SESSION_AUTH_TOKEN, SESSION_COOKIE } from '@tinycanvas/shared';
import { createSyncServer, type SyncServer } from '../src/server';
import { sha256Hex } from '../src/auth';

export const SECRET = 'test-secret-for-sync-0123456789abcdef';
export const PUBLIC_URL = 'http://localhost:5273';
export const ORIGIN = 'http://localhost:5273';

export const prisma = createPrisma(process.env.SYNC_TEST_DATABASE_URL);

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, sessions, folders, files, documents, doc_versions, share_links, assets CASCADE',
  );
}

/** 假時鐘：建立時固定在當下，只有 advance 才會前進 */
export function createClock() {
  let t = Date.now();
  return {
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

export async function seedUser(email = `u${randomUUID()}@example.com`) {
  const user = await prisma.user.create({ data: { email, passwordHash: 'x' } });
  const cookieToken = randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      id: sha256Hex(cookieToken),
      userId: user.id,
      csrfToken: 'csrf',
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });
  return { user, cookie: `${SESSION_COOKIE}=${cookieToken}` };
}

export async function seedFile(ownerId: string, data: { deletedAt?: Date | null } = {}) {
  return prisma.file.create({ data: { ownerId, title: 'Board', ...data } });
}

export async function seedLink(fileId: string, data: { revokedAt?: Date; expiresAt?: Date } = {}) {
  return prisma.shareLink.create({ data: { fileId, token: randomBytes(32).toString('base64url'), ...data } });
}

export async function viewToken(fileId: string, linkId: string, opts: { exp?: string | number; secret?: string } = {}) {
  return new SignJWT({ fileId, linkId, readonly: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '2h')
    .sign(new TextEncoder().encode(opts.secret ?? SECRET));
}

export async function startServer(now: () => Date): Promise<{ server: SyncServer; url: string }> {
  const server = createSyncServer({
    prisma,
    sessionSecret: SECRET,
    publicUrl: PUBLIC_URL,
    port: 0,
    address: '127.0.0.1',
    logger: pino({ level: 'silent' }),
    now,
  });
  const port = await server.listen();
  return { server, url: `ws://127.0.0.1:${port}/sync` };
}

/** 讓 provider 在 Node 內以 ws 連線時，帶上瀏覽器會送的 Origin 與 Cookie 標頭 */
function webSocketWithHeaders(headers: Record<string, string>) {
  return class extends WebSocket {
    constructor(url: string) {
      super(url, { headers });
    }
  };
}

export interface TestClient {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  socket: HocuspocusProviderWebsocket;
  closes: { code: number; reason: string }[];
  authFailures: string[];
  /** 等到第一次同步完成；驗證失敗時 reject */
  ready: Promise<void>;
  destroy(): void;
}

export function connect(
  url: string,
  fileId: string,
  opts: { token?: string; cookie?: string; origin?: string | null } = {},
): TestClient {
  const headers: Record<string, string> = {};
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
  if (opts.cookie) headers.cookie = opts.cookie;
  const doc = new Y.Doc();
  const closes: TestClient['closes'] = [];
  const authFailures: string[] = [];
  const socket = new HocuspocusProviderWebsocket({
    url,
    WebSocketPolyfill: webSocketWithHeaders(headers),
    // 測試時重連快一點
    minDelay: 100,
    delay: 100,
    jitter: false,
    quiet: true,
  });
  socket.on('close', ({ event }: { event: { code: number; reason: string } }) => {
    closes.push({ code: event.code, reason: String(event.reason) });
  });
  let provider!: HocuspocusProvider;
  const ready = new Promise<void>((resolve, reject) => {
    provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: fileId,
      token: opts.token ?? SESSION_AUTH_TOKEN,
      document: doc,
      quiet: true,
      onSynced: () => resolve(),
      onAuthenticationFailed: ({ reason }) => {
        authFailures.push(reason);
        reject(new Error(`auth failed: ${reason}`));
      },
    });
  });
  ready.catch(() => undefined);
  return {
    doc,
    provider,
    socket,
    closes,
    authFailures,
    ready,
    destroy() {
      provider.destroy();
      socket.destroy();
    },
  };
}

export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  timeoutMs = 3000,
  intervalMs = 50,
): Promise<T> {
  const start = Date.now();
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (err) {
      last = err;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms${last ? `: ${String(last)}` : ''}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
