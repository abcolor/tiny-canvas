import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { User } from '@tinycanvas/db';
import {
  createFileSchema,
  MAX_IMPORT_BYTES,
  MAX_THUMBNAIL_BYTES,
  updateFileSchema,
  type FileDto,
  type TrashResponse,
} from '@tinycanvas/shared';
import { CurrentUser } from '../auth/current-user';
import { isUuid, toFileDto, toFolderDto, UuidPipe } from '../common/dto';
import { badRequest, notFound } from '../common/errors';
import { parseBody } from '../common/zod';
import { LibraryService } from './library.service';
import { ThumbnailsService } from './thumbnails.service';
import { TransferService } from './transfer.service';

@Controller('api/files')
export class FilesController {
  constructor(
    @Inject(LibraryService) private readonly lib: LibraryService,
    @Inject(ThumbnailsService) private readonly thumbnails: ThumbnailsService,
    @Inject(TransferService) private readonly transfer: TransferService,
  ) {}

  /** ?folderId=<id|root>（預設 root）、?favorite=true、?recent=true、?trash=true */
  @Get()
  async list(
    @CurrentUser() user: User,
    @Query() q: Record<string, string | undefined>,
  ): Promise<FileDto[] | TrashResponse> {
    if (q.trash === 'true') {
      const { files, folders } = await this.lib.listTrash(user.id);
      return { files: files.map(toFileDto), folders: folders.map(toFolderDto) };
    }
    if (q.favorite === 'true') return (await this.lib.listFavorites(user.id)).map(toFileDto);
    if (q.recent === 'true') return (await this.lib.listRecent(user.id)).map(toFileDto);
    const folderId = !q.folderId || q.folderId === 'root' ? null : q.folderId;
    if (folderId !== null && !isUuid(folderId)) throw notFound();
    return (await this.lib.listFiles(user.id, folderId)).map(toFileDto);
  }

  /** 匯入白板 JSON（multipart：file，選填 folderId），建立新檔案 */
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  async importBoard(
    @CurrentUser() user: User,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body() body: { folderId?: string },
  ): Promise<FileDto> {
    if (!file) throw badRequest('invalid_request', 'missing file');
    const folderId = body?.folderId ? body.folderId : null;
    if (folderId !== null && !isUuid(folderId)) throw notFound();
    return toFileDto(await this.transfer.importBoard(user.id, file.buffer, folderId));
  }

  /** 匯出白板 JSON（含內嵌圖片），以附件下載 */
  @Get(':id/export')
  async exportBoard(
    @CurrentUser() user: User,
    @Param('id', UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const data = await this.transfer.exportBoard(user.id, id);
    const name = `${data.title}.tinycanvas.json`;
    const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(Buffer.from(JSON.stringify(data)));
  }

  @Get(':id')
  async get(
    @CurrentUser() user: User,
    @Param('id', UuidPipe) id: string,
    @Query('includeTrashed') includeTrashed?: string,
  ): Promise<FileDto> {
    return toFileDto(await this.lib.getFile(user.id, id, { includeTrashed: includeTrashed === 'true' }));
  }

  @Post()
  async create(@CurrentUser() user: User, @Body() body: unknown): Promise<FileDto> {
    return toFileDto(await this.lib.createFile(user.id, parseBody(createFileSchema, body)));
  }

  @Patch(':id')
  async update(@CurrentUser() user: User, @Param('id', UuidPipe) id: string, @Body() body: unknown): Promise<FileDto> {
    return toFileDto(await this.lib.updateFile(user.id, id, parseBody(updateFileSchema, body)));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: User,
    @Param('id', UuidPipe) id: string,
    @Query('permanent') permanent?: string,
  ): Promise<void> {
    if (permanent === 'true') await this.lib.purgeFile(user.id, id);
    else await this.lib.trashFile(user.id, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(@CurrentUser() user: User, @Param('id', UuidPipe) id: string): Promise<FileDto> {
    return toFileDto(await this.lib.restoreFile(user.id, id));
  }

  /** 首頁卡片縮圖。網址帶 ?v=<thumbnailAt>，內容不變，可長期快取 */
  @Get(':id/thumbnail')
  async getThumbnail(
    @CurrentUser() user: User,
    @Param('id', UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const t = await this.thumbnails.get(user.id, id);
    res.set({
      'Content-Type': t.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(Buffer.from(t.data));
  }

  @Put(':id/thumbnail')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_THUMBNAIL_BYTES, files: 1 } }))
  async putThumbnail(
    @CurrentUser() user: User,
    @Param('id', UuidPipe) id: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ): Promise<FileDto> {
    if (!file) throw badRequest('invalid_request', 'missing file');
    return toFileDto(await this.thumbnails.put(user.id, id, file.buffer));
  }

  @Delete(':id/thumbnail')
  async removeThumbnail(@CurrentUser() user: User, @Param('id', UuidPipe) id: string): Promise<FileDto> {
    return toFileDto(await this.thumbnails.remove(user.id, id));
  }
}
