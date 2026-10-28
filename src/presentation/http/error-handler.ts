import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../domain/errors.js';
import type { Messages } from '../../config/messages.js';
import type { Logger } from '../../service/logger.js';

const statusByCode = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  provider: 502,
  persistence: 500,
  internal: 500
} as const;

export const createErrorHandler = (messages: Messages['httpErrors'], logger?: Logger): ErrorRequestHandler => (error, request, response, _next) => {
  const code = error instanceof ZodError
    ? 'validation'
    : error instanceof AppError
      ? error.code
      : 'internal';

  logger?.log(statusByCode[code] >= 500 ? 'error' : 'warn', 'http.request.failed', {
    method: request.method,
    route: request.route?.path ?? request.path.split('/').slice(0, 3).join('/'),
    status: statusByCode[code],
    errorCode: code
  });
  response.status(statusByCode[code]).json({ error: code, message: messages[code] });
};
