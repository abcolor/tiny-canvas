import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { serialize } from 'cookie';
import {
  credentialsSchema,
  loginSchema,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  type AuthConfigResponse,
  type MeResponse,
} from '@tinycanvas/shared';
import { CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { ApiException } from '../common/errors';
import { RateLimiter } from '../common/rate-limit';
import { parseBody } from '../common/zod';
import { Public, type AuthedRequest } from './auth.guard';
import { AuthService, toMe } from './auth.service';
import { hashPassword, verifyDummy, verifyPassword } from './passwords';

@Controller('api')
export class AuthController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Public()
  @Get('auth/config')
  authConfig(): AuthConfigResponse {
    return { allowSignup: this.config.allowSignup };
  }

  @Public()
  @Post('auth/signup')
  @HttpCode(201)
  async signup(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<MeResponse> {
    if (!this.config.allowSignup) throw new ApiException(403, 'signup_disabled');
    const { email, password } = parseBody(credentialsSchema, body);
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ApiException(409, 'email_taken');
    const user = await this.prisma.user.create({ data: { email, passwordHash: await hashPassword(password) } });
    const { token, session } = await this.auth.createSession(user.id);
    this.setCookie(res, token);
    return toMe({ user, session });
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    this.limiter.hit(`login:${req.ip}`);
    const { email, password } = parseBody(loginSchema, body);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      await verifyDummy(password);
      throw new ApiException(401, 'invalid_credentials');
    }
    if (!(await verifyPassword(user.passwordHash, password))) throw new ApiException(401, 'invalid_credentials');
    const { token, session } = await this.auth.createSession(user.id);
    this.setCookie(res, token);
    return toMe({ user, session });
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.deleteSession(req.auth!.session.id);
    res.append(
      'Set-Cookie',
      serialize(SESSION_COOKIE, '', { ...this.cookieBase(), maxAge: 0, expires: new Date(0) }),
    );
  }

  @Get('me')
  me(@Req() req: AuthedRequest): MeResponse {
    return toMe(req.auth!);
  }

  private cookieBase() {
    return { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: this.config.secureCookies };
  }

  private setCookie(res: Response, token: string) {
    res.append(
      'Set-Cookie',
      serialize(SESSION_COOKIE, token, { ...this.cookieBase(), maxAge: SESSION_TTL_DAYS * 86_400 }),
    );
  }
}
