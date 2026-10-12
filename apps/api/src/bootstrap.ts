import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHttpLogger, LOGGER, PinoNestLogger, type Logger } from './common/logger';

/** main 與測試共用的 HTTP 設定 */
export function configureApp(app: NestExpressApplication): void {
  const logger = app.get<Logger>(LOGGER);
  app.useLogger(new PinoNestLogger(logger));
  // 只信任來自本機與私有網段（Docker 內部網路上的 Caddy）的 X-Forwarded-For
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');
  app.use(createHttpLogger(logger));
  // 命名版本會帶上整份畫布狀態，上限與 Caddy 的 request_body 一致
  app.useBodyParser('json', { limit: '12mb' });
  app.enableShutdownHooks();
}
