import type { LoggerService } from '@nestjs/common';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type Logger = pino.Logger;
export const LOGGER = Symbol('LOGGER');

export function createLogger(level: string): Logger {
  return pino({ level, base: { service: 'api' } });
}

/** 分享 token 屬於機密，不寫入日誌 */
function redactUrl(url: string | undefined): string {
  if (!url) return '';
  return url.replace(/(\/api\/shared\/)[^/?#]+/, '$1***');
}

/** 每個請求一行 JSON 日誌；只記錄方法、路徑、狀態碼與耗時，不記錄標頭、Cookie 或請求內容 */
export function createHttpLogger(logger: Logger) {
  return pinoHttp({
    logger: logger as any,
    quietReqLogger: true,
    serializers: {
      req: (req: any) => ({ method: req.method, url: redactUrl(req.url), ip: req.raw?.ip ?? req.remoteAddress }),
      res: (res: any) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) =>
      err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  });
}

/** 讓 Nest 內部日誌也輸出成 pino JSON */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}
  log(message: any, context?: string) {
    this.logger.info({ context }, String(message));
  }
  error(message: any, trace?: string, context?: string) {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: any, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  debug(message: any, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: any, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}
