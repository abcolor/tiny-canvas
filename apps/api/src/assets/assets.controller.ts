import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { Response } from 'express';
import type { User } from '@tinycanvas/db';
import { MAX_UPLOAD_BYTES, type AssetDto } from '@tinycanvas/shared';
import { CurrentUser } from '../auth/current-user';
import { Public, type AuthedRequest } from '../auth/auth.guard';
import { toAssetDto, UuidPipe } from '../common/dto';
import { badRequest, notFound } from '../common/errors';
import { AssetsService } from './assets.service';

@Controller('api/assets')
export class AssetsController {
  constructor(@Inject(AssetsService) private readonly assets: AssetsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async upload(@CurrentUser() user: User, @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined): Promise<AssetDto> {
    if (!file) throw badRequest('invalid_request', 'missing file');
    return toAssetDto(await this.assets.upload(user.id, file.mimetype, file.buffer));
  }

  /** Session（擁有者）或 Authorization: Bearer <檢視 token> */
  @Public()
  @Get(':id')
  async get(
    @Param('id', UuidPipe) id: string,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const auth = req.headers.authorization;
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const asset = await this.assets.authorize(id, req.auth?.user.id, bearer);
    const filePath = this.assets.filePath(asset.storageKey);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) throw notFound();
    res.set({
      'Content-Type': asset.mime,
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    return new StreamableFile(createReadStream(filePath));
  }
}
