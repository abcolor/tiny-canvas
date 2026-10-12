import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { parse as parseCookie } from 'cookie';
import type { Request } from 'express';
import { CSRF_HEADER, SESSION_COOKIE } from '@tinycanvas/shared';
import { ApiException } from '../common/errors';
import { AuthService, csrfMatches, type AuthContext } from './auth.service';

/** 不需要登入的路由（Session 若存在仍會解析，但不檢查 CSRF） */
export const PUBLIC_KEY = 'tc:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export type AuthedRequest = Request & { auth?: AuthContext };

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function sessionToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parseCookie(header)[SESSION_COOKIE] || undefined;
}

/**
 * 全域守衛：解析 Session Cookie；非公開路由需要登入，
 * 以 Session 驗證的 POST/PATCH/DELETE 必須帶正確的 X-CSRF-Token（見 SPEC.md 第 8.3 節）
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const ctx = await this.auth.findSession(sessionToken(req));
    if (ctx) req.auth = ctx;
    if (isPublic) return true;
    if (!ctx) throw new ApiException(401, 'unauthenticated');
    if (MUTATING.has(req.method) && !csrfMatches(ctx.session.csrfToken, req.headers[CSRF_HEADER])) {
      throw new ApiException(403, 'csrf');
    }
    return true;
  }
}
