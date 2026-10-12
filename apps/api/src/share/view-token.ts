import { jwtVerify, SignJWT } from 'jose';
import { VIEW_TOKEN_TTL_SECONDS } from '@tinycanvas/shared';

/**
 * 唯讀分享的檢視 token（見 SPEC.md 第 5.3 節）。
 * 格式：JWT，HS256，金鑰為 SESSION_SECRET（UTF-8 位元組），
 * claims：{ fileId, linkId, readonly: true, iat, exp }，有效 2 小時。
 * sync 服務以相同規則獨立驗證；兩邊修改時必須同步。
 */
export interface ViewTokenClaims {
  fileId: string;
  linkId: string;
  readonly: true;
}

const ALG = 'HS256';
const key = (secret: string) => new TextEncoder().encode(secret);

export async function signViewToken(
  secret: string,
  claims: { fileId: string; linkId: string },
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ fileId: claims.fileId, linkId: claims.linkId, readonly: true })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuedAt(iat)
    .setExpirationTime(iat + VIEW_TOKEN_TTL_SECONDS)
    .sign(key(secret));
}

/** 驗證失敗（簽章錯誤、過期、格式不符）時回傳 null */
export async function verifyViewToken(
  secret: string,
  token: string,
  now: Date = new Date(),
): Promise<ViewTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: [ALG],
      currentDate: now,
    });
    if (typeof payload.fileId !== 'string' || typeof payload.linkId !== 'string' || payload.readonly !== true) {
      return null;
    }
    return { fileId: payload.fileId, linkId: payload.linkId, readonly: true };
  } catch {
    return null;
  }
}
