import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { parse as parseCookie } from 'cookie';
import { jwtVerify } from 'jose';
import type { PrismaClient } from '@tinycanvas/db';
import { CLOSE_FILE_TRASHED, SESSION_AUTH_TOKEN, SESSION_COOKIE } from '@tinycanvas/shared';

/** onAuthenticate 回傳、之後掛在每個連線上的 context */
export interface SyncContext {
  userId: string | null;
  readOnly: boolean;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 拒絕連線用的錯誤。Hocuspocus v2 會把 `reason` 放進 permission-denied 訊息送給前端
 * （provider 的 `authenticationFailed` 事件）。message 刻意留空，Hocuspocus 只在 message
 * 不為空時才 console.error，避免每次拒絕都噴出未結構化的日誌；我們自己用 pino 記錄。
 */
export class SyncDenied extends Error {
  constructor(
    public readonly reason: string,
    public readonly detail: string,
  ) {
    super('');
    this.name = 'SyncDenied';
  }
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export interface AuthDeps {
  prisma: PrismaClient;
  /** PUBLIC_URL 的 origin，例如 http://localhost:5273 */
  expectedOrigin: string;
  secret: Uint8Array;
  now: () => Date;
}

export interface AuthInput {
  documentName: string;
  token: string;
  requestHeaders: IncomingHttpHeaders;
}

const PERMISSION_DENIED = 'permission-denied';

/**
 * /sync 的驗證規則（SPEC.md 第 5.3、8.3 節）。成功時回傳 context，失敗時丟出 SyncDenied。
 */
export async function authenticate(deps: AuthDeps, input: AuthInput): Promise<SyncContext> {
  const { prisma, now } = deps;
  const { documentName, token, requestHeaders } = input;

  // CSRF token 保護不了 WebSocket：檢查 Origin 防止跨站 WebSocket 劫持
  const origin = requestHeaders.origin;
  if (origin !== deps.expectedOrigin) throw new SyncDenied(PERMISSION_DENIED, 'bad-origin');
  if (!UUID_RE.test(documentName)) throw new SyncDenied(PERMISSION_DENIED, 'bad-document-name');

  if (token === SESSION_AUTH_TOKEN) {
    const raw = requestHeaders.cookie;
    const cookieValue = raw ? parseCookie(raw)[SESSION_COOKIE] : undefined;
    if (!cookieValue) throw new SyncDenied(PERMISSION_DENIED, 'no-session-cookie');
    const session = await prisma.session.findUnique({
      where: { id: sha256Hex(cookieValue) },
      select: { userId: true, expiresAt: true },
    });
    if (!session || session.expiresAt.getTime() <= now().getTime()) {
      throw new SyncDenied(PERMISSION_DENIED, 'invalid-session');
    }
    const file = await prisma.file.findUnique({
      where: { id: documentName },
      select: { ownerId: true, deletedAt: true },
    });
    if (!file || file.ownerId !== session.userId) throw new SyncDenied(PERMISSION_DENIED, 'not-owner');
    if (file.deletedAt) throw new SyncDenied(CLOSE_FILE_TRASHED.reason, 'file-trashed');
    return { userId: session.userId, readOnly: false };
  }

  // 檢視 token（分享連結）：api 以 SESSION_SECRET 簽發的 HS256 JWT
  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(token, deps.secret, {
      algorithms: ['HS256'],
      currentDate: now(),
    });
    claims = payload as Record<string, unknown>;
  } catch {
    throw new SyncDenied(PERMISSION_DENIED, 'invalid-view-token');
  }
  if (claims.fileId !== documentName || claims.readonly !== true || typeof claims.linkId !== 'string') {
    throw new SyncDenied(PERMISSION_DENIED, 'view-token-mismatch');
  }
  if (!UUID_RE.test(claims.linkId)) throw new SyncDenied(PERMISSION_DENIED, 'view-token-mismatch');
  const link = await prisma.shareLink.findUnique({
    where: { id: claims.linkId },
    select: { fileId: true, revokedAt: true, expiresAt: true, file: { select: { deletedAt: true } } },
  });
  if (!link || link.fileId !== documentName) throw new SyncDenied(PERMISSION_DENIED, 'link-not-found');
  if (link.revokedAt) throw new SyncDenied(PERMISSION_DENIED, 'link-revoked');
  if (link.expiresAt && link.expiresAt.getTime() <= now().getTime()) {
    throw new SyncDenied(PERMISSION_DENIED, 'link-expired');
  }
  if (link.file.deletedAt) throw new SyncDenied(CLOSE_FILE_TRASHED.reason, 'file-trashed');
  return { userId: null, readOnly: true };
}
