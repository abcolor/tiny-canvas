import { credentialsSchema } from '@tinycanvas/shared';
import type { PrismaClient } from '@tinycanvas/db';
import { hashPassword } from '../auth/passwords';

export class CliError extends Error {}

function validate(email: string, password: string) {
  const r = credentialsSchema.safeParse({ email, password });
  if (!r.success) {
    const field = r.error.issues[0]?.path[0];
    if (field === 'email') throw new CliError('Email 格式不正確');
    throw new CliError('密碼長度需介於 8 到 200 個字元');
  }
  return r.data;
}

/** 建立帳號（ALLOW_SIGNUP 關閉時唯一的建立方式，見 SPEC.md 第 5.1 節） */
export async function createUser(prisma: PrismaClient, email: string, password: string) {
  const data = validate(email, password);
  const exists = await prisma.user.findUnique({ where: { email: data.email } });
  if (exists) throw new CliError(`帳號已存在：${data.email}`);
  return prisma.user.create({ data: { email: data.email, passwordHash: await hashPassword(data.password) } });
}

/** 重設密碼，並登出該帳號的所有 Session */
export async function resetPassword(prisma: PrismaClient, email: string, password: string) {
  const data = validate(email, password);
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) throw new CliError(`找不到帳號：${data.email}`);
  const passwordHash = await hashPassword(data.password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  return user;
}
