import argon2 from 'argon2';

/** argon2id 雜湊（見 SPEC.md 第 7 節） */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;
/** 帳號不存在時也做一次驗證，讓回應時間不洩漏帳號是否存在 */
export async function verifyDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('tinycanvas-dummy-password');
  await verifyPassword(await dummyHash, password);
}
