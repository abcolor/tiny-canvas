import { Controller, Get, Inject, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { CONFIG, loadConfig, type AppConfig } from './config';
import { PrismaService } from './prisma.service';
import { createLogger, LOGGER } from './common/logger';
import { ApiExceptionFilter } from './common/errors';
import { RateLimiter } from './common/rate-limit';
import { AuthService } from './auth/auth.service';
import { AuthGuard, Public } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { LibraryService } from './files/library.service';
import { FilesController } from './files/files.controller';
import { ThumbnailsService } from './files/thumbnails.service';
import { TransferService } from './files/transfer.service';
import { FoldersController } from './folders/folders.controller';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';
import { VersionsController } from './versions/versions.controller';
import { VersionsService } from './versions/versions.service';
import { ShareService } from './share/share.service';
import { ShareLinksController, SharedController } from './share/share.controller';
import { AssetsService } from './assets/assets.service';
import { AssetsController } from './assets/assets.controller';
import { DailyService } from './daily/daily.service';

@Public()
@Controller('api')
class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('healthz')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}

/** 設定、資料庫與日誌；CLI 也共用 */
export const coreProviders = [
  { provide: CONFIG, useFactory: () => loadConfig() },
  { provide: LOGGER, useFactory: (c: AppConfig) => createLogger(c.logLevel), inject: [CONFIG] },
  PrismaService,
];

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [
    HealthController,
    AuthController,
    FoldersController,
    FilesController,
    SearchController,
    VersionsController,
    ShareLinksController,
    SharedController,
    AssetsController,
  ],
  providers: [
    ...coreProviders,
    RateLimiter,
    AuthService,
    LibraryService,
    ThumbnailsService,
    TransferService,
    SearchService,
    VersionsService,
    ShareService,
    AssetsService,
    DailyService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
