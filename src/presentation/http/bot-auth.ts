import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../../domain/errors.js';
import type { TelegramUserRepository } from '../../domain/telegram-user-repository.js';
import type { Logger } from '../../service/logger.js';

const telegramUserIdSchema = z.string().refine((value) =>
  /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
);

export const createServiceAuthentication = (serviceToken: string, logger?: Logger): RequestHandler => {
  const expected = Buffer.from(serviceToken);
  return (request, _response, next) => {
    const bearer = /^Bearer (\S+)$/i.exec(request.get('authorization') ?? '')?.[1];
    if (!bearer) {
      logger?.log('warn', 'http.service_authentication.failed', { reason: 'missing_credential' });
      next(new AppError('unauthorized'));
      return;
    }
    const supplied = Buffer.from(bearer);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      logger?.log('warn', 'http.service_authentication.failed', { reason: 'invalid_credential' });
      next(new AppError('unauthorized'));
      return;
    }
    next();
  };
};

export const createTelegramOwnerResolver = (users: TelegramUserRepository, logger?: Logger): RequestHandler => async (request, response, next) => {
  try {
    const telegramUserId = telegramUserIdSchema.parse(request.get('x-telegram-user-id'));
    const ownerId = await users.findOwnerIdByTelegramUserId(telegramUserId);
    if (!ownerId) {
      logger?.log('warn', 'http.owner_resolution.failed', { reason: 'unlinked_telegram_user' });
      throw new AppError('forbidden');
    }
    response.locals.ownerId = ownerId;
    logger?.log('debug', 'http.owner_resolution.completed');
    next();
  } catch (error) {
    if (error instanceof AppError && error.code !== 'forbidden') {
      logger?.log('warn', 'http.owner_resolution.failed', { reason: 'invalid_telegram_identity' });
    } else if (!(error instanceof AppError)) {
      logger?.log('error', 'http.owner_resolution.failed', { reason: 'lookup_error' });
    }
    next(error);
  }
};
