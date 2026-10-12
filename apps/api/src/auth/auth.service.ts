import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SESSION_TTL_DAYS, type MeResponse } from '@tinycanvas/shared';
import type { Session, User } from '@tinycanvas/db';
import { PrismaService } from '../prisma.service';

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

export interface AuthContext {
  user: User;
  session: Session;
}

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 建立新 Session，回傳要放進 Cookie 的原始 token（資料庫只存其 SHA-256） */
  async createSession(userId: string, now = new Date()): Promise<{ token: string; session: Session }> {
    const token = randomBytes(32).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        id: sha256Hex(token),
        userId,
        csrfToken: randomBytes(32).toString('base64url'),
        expiresAt: new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000),
      },
    });
    return { token, session };
  }

  async findSession(token: string | undefined, now = new Date()): Promise<AuthContext | null> {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({
      where: { id: sha256Hex(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= now) return null;
    const { user, ...rest } = session;
    return { user, session: rest };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }
}

export function csrfMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function toMe(ctx: AuthContext): MeResponse {
  return {
    user: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
    csrfToken: ctx.session.csrfToken,
  };
}
