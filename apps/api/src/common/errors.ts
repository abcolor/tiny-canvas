import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError } from '@tinycanvas/shared';
import { LOGGER, type Logger } from './logger';

/** 帶機器可讀錯誤碼的例外：回應格式 `{ error, message? }` */
export class ApiException extends HttpException {
  constructor(status: number, code: string, message?: string) {
    super(message ? { error: code, message } : { error: code }, status);
  }
}

export const notFound = () => new ApiException(404, 'not_found');
export const badRequest = (code = 'invalid_request', message?: string) => new ApiException(400, code, message);

const DEFAULT_CODES: Record<number, string> = {
  400: 'invalid_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'too_large',
  415: 'unsupported_type',
  429: 'rate_limited',
};

/** 把所有例外轉成一致的 JSON 錯誤格式 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiError = { error: 'internal' };
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      if (r && typeof r === 'object' && typeof (r as any).error === 'string' && !('statusCode' in r)) {
        body = r as ApiError;
      } else {
        body = { error: DEFAULT_CODES[status] ?? (status >= 500 ? 'internal' : 'error') };
      }
    } else {
      this.logger.error({ err: exception }, 'unhandled error');
    }
    if (status >= 500 && exception instanceof HttpException) {
      this.logger.error({ err: exception }, 'server error');
    }
    if (res.headersSent) return;
    res.status(status).json(body);
  }
}
