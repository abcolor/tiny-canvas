import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@tinycanvas/db';
import {
  createShareLinkSchema,
  unlockSchema,
  type ShareLinkDto,
  type SharedInfoResponse,
  type UnlockResponse,
} from '@tinycanvas/shared';
import { CurrentUser } from '../auth/current-user';
import { Public } from '../auth/auth.guard';
import { toShareLinkDto, UuidPipe } from '../common/dto';
import { ApiException } from '../common/errors';
import { RateLimiter } from '../common/rate-limit';
import { parseBody } from '../common/zod';
import { ShareService } from './share.service';

@Controller('api/files/:id/share-links')
export class ShareLinksController {
  constructor(@Inject(ShareService) private readonly share: ShareService) {}

  @Get()
  async list(@CurrentUser() user: User, @Param('id', UuidPipe) id: string): Promise<ShareLinkDto[]> {
    return (await this.share.list(user.id, id)).map(toShareLinkDto);
  }

  @Post()
  async create(
    @CurrentUser() user: User,
    @Param('id', UuidPipe) id: string,
    @Body() body: unknown,
  ): Promise<ShareLinkDto> {
    return toShareLinkDto(await this.share.create(user.id, id, parseBody(createShareLinkSchema, body)));
  }

  @Delete(':linkId')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: User,
    @Param('id', UuidPipe) id: string,
    @Param('linkId', UuidPipe) linkId: string,
  ): Promise<void> {
    await this.share.revoke(user.id, id, linkId);
  }
}

/** 訪客端：不需要登入，也沒有 Session，因此不檢查 CSRF */
@Public()
@Controller('api/shared/:token')
export class SharedController {
  constructor(
    @Inject(ShareService) private readonly share: ShareService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Get()
  async info(@Param('token') token: string): Promise<SharedInfoResponse> {
    const { link, file } = await this.share.resolve(token);
    const requiresPassword = link.passwordHash !== null;
    return {
      fileId: file.id,
      title: file.title,
      requiresPassword,
      viewToken: requiresPassword ? null : await this.share.issueViewToken(link),
    };
  }

  @Post('unlock')
  @HttpCode(200)
  async unlock(@Req() req: Request, @Param('token') token: string, @Body() body: unknown): Promise<UnlockResponse> {
    this.limiter.hit(`unlock:${req.ip}`);
    const { password } = parseBody(unlockSchema, body);
    const { link } = await this.share.resolve(token);
    if (!(await this.share.checkPassword(link, password))) throw new ApiException(401, 'invalid_password');
    return { viewToken: await this.share.issueViewToken(link) };
  }
}
