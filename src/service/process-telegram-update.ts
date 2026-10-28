import type { AppConfig } from '../config/config.js';
import type { Messages } from '../config/messages.js';
import { AppError } from '../domain/errors.js';
import type { TransactionExtractor } from '../domain/transaction-extractor.js';
import type { TelegramTransactionApi } from './capture-transaction.js';
import { captureTelegramTransaction } from './capture-transaction.js';
import { formatTransactionReply } from './transaction-reply.js';
import type { TelegramUpdate } from '../presentation/telegram/update.js';
import type { Logger } from './logger.js';
import type { TelegramAudioJobRepository } from '../domain/telegram-audio-job-repository.js';
import type { TelegramAudioFileGateway } from '../domain/telegram-audio-files.js';
import { queueTelegramAudio } from './queue-telegram-audio.js';

export interface TelegramMessageSender {
  sendMessage(chatId: number, text: string, updateId?: number): Promise<void>;
}

export const processTelegramUpdate = async (
  update: TelegramUpdate,
  dependencies: {
    config: AppConfig;
    messages: Messages;
    extractor: TransactionExtractor;
    api: TelegramTransactionApi;
    telegram: TelegramMessageSender;
    audio?: { jobs: TelegramAudioJobRepository; files: TelegramAudioFileGateway };
    logger?: Logger;
  }
): Promise<void> => {
  const message = update.message;
  const chatId = message?.chat?.id;
  const { logger } = dependencies;
  logger?.log('debug', 'telegram.update.processing_started', { updateId: update.update_id });
  if (chatId === undefined) {
    logger?.log('info', 'telegram.update.ignored', { updateId: update.update_id, reason: 'missing_chat' });
    return;
  }
  const hasAudio = message?.voice !== undefined || message?.audio !== undefined;
  if (hasAudio) {
    if (dependencies.audio) {
      await queueTelegramAudio(update, message?.voice !== undefined ? message.voice : message?.audio, {
        config: dependencies.config,
        messages: dependencies.messages,
        jobs: dependencies.audio.jobs,
        files: dependencies.audio.files,
        telegram: dependencies.telegram,
        logger
      });
    } else {
      await sendReply(dependencies.telegram, chatId, dependencies.messages.unsupported, 'unsupported', update.update_id, logger);
    }
    return;
  }
  if (!message?.text || message.from?.id === undefined) {
    logger?.log('info', 'telegram.update.unsupported', { updateId: update.update_id });
    await sendReply(dependencies.telegram, chatId, dependencies.messages.unsupported, 'unsupported', update.update_id, logger);
    return;
  }

  try {
    const result = await captureTelegramTransaction({
      telegramUserId: String(message.from.id),
      updateId: update.update_id,
      text: message.text
    }, dependencies.config.TRANSACTION_CUES, dependencies.extractor, dependencies.api, logger);
    logger?.log('info', 'telegram.update.capture_completed', { updateId: update.update_id, outcome: result.kind });

    if (result.kind === 'recorded') {
      await sendReply(dependencies.telegram, chatId, formatTransactionReply(
        result.transaction,
        dependencies.messages,
        dependencies.config.LOCALE,
        dependencies.config.CURRENCY
      ), 'transaction_summary', update.update_id, logger);
      return;
    }
    await sendReply(dependencies.telegram, chatId, dependencies.messages.usage, 'usage', update.update_id, logger);
  } catch (error) {
    const unlinked = error instanceof AppError && error.code === 'forbidden';
    logger?.log('error', 'telegram.update.processing_failed', {
      updateId: update.update_id,
      errorCode: error instanceof AppError ? error.code : 'unexpected'
    });
    await sendReply(
      dependencies.telegram,
      chatId,
      unlinked ? dependencies.messages.unlinkedAccount : dependencies.messages.temporaryFailure,
      unlinked ? 'unlinked_account' : 'temporary_failure',
      update.update_id,
      logger
    );
  }
};

const sendReply = async (
  telegram: TelegramMessageSender,
  chatId: number,
  text: string,
  replyType: string,
  updateId: number,
  logger?: Logger
) => {
  logger?.log('debug', 'telegram.reply.started', { updateId, replyType });
  try {
    await telegram.sendMessage(chatId, text, updateId);
    logger?.log('info', 'telegram.reply.completed', { updateId, replyType });
  } catch (error) {
    logger?.log('error', 'telegram.reply.failed', {
      updateId,
      replyType,
      errorCode: error instanceof AppError ? error.code : 'unexpected'
    });
    throw error;
  }
};
