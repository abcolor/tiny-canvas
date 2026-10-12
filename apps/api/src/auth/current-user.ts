import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@tinycanvas/db';
import type { AuthedRequest } from './auth.guard';

/** 目前登入的使用者（只用在非公開路由） */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.auth!.user;
});
