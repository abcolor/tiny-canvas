import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import type { User } from '@tinycanvas/db';
import { createFolderSchema, updateFolderSchema, type FolderDto } from '@tinycanvas/shared';
import { CurrentUser } from '../auth/current-user';
import { toFolderDto, UuidPipe } from '../common/dto';
import { parseBody } from '../common/zod';
import { LibraryService } from '../files/library.service';

@Controller('api/folders')
export class FoldersController {
  constructor(@Inject(LibraryService) private readonly lib: LibraryService) {}

  @Get()
  async list(@CurrentUser() user: User): Promise<FolderDto[]> {
    return (await this.lib.listFolders(user.id)).map(toFolderDto);
  }

  @Post()
  async create(@CurrentUser() user: User, @Body() body: unknown): Promise<FolderDto> {
    return toFolderDto(await this.lib.createFolder(user.id, parseBody(createFolderSchema, body)));
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: User,
    @Param('id', UuidPipe) id: string,
    @Body() body: unknown,
  ): Promise<FolderDto> {
    return toFolderDto(await this.lib.updateFolder(user.id, id, parseBody(updateFolderSchema, body)));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: User,
    @Param('id', UuidPipe) id: string,
    @Query('permanent') permanent?: string,
  ): Promise<void> {
    if (permanent === 'true') await this.lib.purgeFolder(user.id, id);
    else await this.lib.trashFolder(user.id, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(@CurrentUser() user: User, @Param('id', UuidPipe) id: string): Promise<FolderDto> {
    return toFolderDto(await this.lib.restoreFolder(user.id, id));
  }
}
