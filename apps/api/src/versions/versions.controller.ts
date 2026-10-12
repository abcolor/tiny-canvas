import { Body, Controller, Get, Header, Inject, Param, Post, Query, StreamableFile } from '@nestjs/common';
import type { User } from '@tinycanvas/db';
import {
  copyVersionSchema,
  createVersionSchema,
  type FileDto,
  type VersionDto,
  type VersionListResponse,
} from '@tinycanvas/shared';
import { CurrentUser } from '../auth/current-user';
import { toFileDto, UuidPipe } from '../common/dto';
import { parseBody } from '../common/zod';
import { VersionsService } from './versions.service';

@Controller('api/files/:id/versions')
export class VersionsController {
  constructor(@Inject(VersionsService) private readonly versions: VersionsService) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Param('id', UuidPipe) id: string,
    @Query('cursor') cursor?: string,
  ): Promise<VersionListResponse> {
    return this.versions.list(user.id, id, cursor || undefined);
  }

  @Post()
  create(@CurrentUser() user: User, @Param('id', UuidPipe) id: string, @Body() body: unknown): Promise<VersionDto> {
    const input = parseBody(createVersionSchema, body);
    return this.versions.createNamed(user.id, id, input.label, input.state);
  }

  @Get(':vid')
  @Header('Content-Type', 'application/octet-stream')
  @Header('Cache-Control', 'private, no-store')
  async get(
    @CurrentUser() user: User,
    @Param('id', UuidPipe) id: string,
    @Param('vid', UuidPipe) vid: string,
  ): Promise<StreamableFile> {
    const state = await this.versions.getState(user.id, id, vid);
    return new StreamableFile(state, { type: 'application/octet-stream', length: state.byteLength });
  }

  @Post(':vid/copy')
  async copy(
    @CurrentUser() user: User,
    @Param('id', UuidPipe) id: string,
    @Param('vid', UuidPipe) vid: string,
    @Body() body: unknown,
  ): Promise<FileDto> {
    const { title } = parseBody(copyVersionSchema, body);
    return toFileDto(await this.versions.copy(user.id, id, vid, title));
  }
}
