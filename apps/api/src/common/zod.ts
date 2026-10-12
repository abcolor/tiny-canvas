import type { ZodType, ZodTypeDef } from 'zod';
import { ApiException } from './errors';

/** 以 zod 驗證請求內容，失敗時回傳 400 invalid_request */
export function parseBody<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path.length ? issue.path.join('.') + ': ' : '';
    throw new ApiException(400, 'invalid_request', issue ? where + issue.message : undefined);
  }
  return r.data;
}
