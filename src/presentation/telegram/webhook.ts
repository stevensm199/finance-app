import { timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { AppError } from '../../domain/errors.js';
import { telegramUpdateSchema } from './update.js';
import type { TelegramUpdate } from './update.js';
import type { Logger } from '../../service/logger.js';

export const createTelegramWebhookHandler = (
  webhookSecret: string,
  processUpdate: (update: TelegramUpdate) => Promise<void>,
  logger?: Logger
): RequestHandler => async (request, response, next) => {
  const supplied = Buffer.from(request.get('x-telegram-bot-api-secret-token') ?? '');
  const expected = Buffer.from(webhookSecret);
  if (!supplied.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    logger?.log('warn', 'telegram.webhook.authentication_failed');
    next(new AppError('unauthorized'));
    return;
  }

  let update: TelegramUpdate;
  try {
    update = telegramUpdateSchema.parse(request.body);
  } catch {
    logger?.log('warn', 'telegram.webhook.update_rejected', { reason: 'invalid_payload' });
    next(new AppError('validation'));
    return;
  }

  const startedAt = Date.now();
  logger?.log('info', 'telegram.webhook.received', {
    updateId: update.update_id,
    hasText: Boolean(update.message?.text),
    textLength: update.message?.text?.length ?? 0,
    audioType: update.message?.voice !== undefined ? 'voice' : update.message?.audio !== undefined ? 'audio' : 'none'
  });

  try {
    await processUpdate(update);
    logger?.log('info', 'telegram.webhook.completed', { updateId: update.update_id, durationMs: Date.now() - startedAt });
    response.status(200).json({ accepted: true });
  } catch (error) {
    logger?.log('error', 'telegram.webhook.failed', {
      updateId: update.update_id,
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof AppError ? error.code : 'unexpected'
    });
    next(error);
  }
};

export const createTelegramWebhookRouter = (
  webhookSecret: string,
  processUpdate: (update: TelegramUpdate) => Promise<void>,
  logger?: Logger
) => {
  const router = Router();
  router.post('/', createTelegramWebhookHandler(webhookSecret, processUpdate, logger));
  return router;
};
