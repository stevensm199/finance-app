import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import type { AppConfig } from '../config/config.js';
import type { Messages } from '../config/messages.js';
import type { TelegramAudioJobRepository } from '../domain/telegram-audio-job-repository.js';
import type { TelegramAudioFileGateway } from '../domain/telegram-audio-files.js';
import type { TelegramUpdate } from '../presentation/telegram/update.js';
import type { Logger } from './logger.js';
import type { TelegramMessageSender } from './process-telegram-update.js';
import { validateAudioMetadata } from './audio-validation.js';

const audioMessageSchema = z.object({
  file_id: z.string().trim().min(1),
  duration: z.number().int().positive().safe(),
  file_size: z.number().int().positive().safe().optional(),
  mime_type: z.string().trim().min(1).optional(),
  file_name: z.string().trim().min(1).optional()
}).passthrough();

export const queueTelegramAudio = async (
  update: TelegramUpdate,
  audioValue: unknown,
  dependencies: {
    config: Pick<AppConfig,
      'AUDIO_MAX_DURATION_SECONDS' | 'AUDIO_MAX_SIZE_BYTES' | 'AUDIO_SUPPORTED_FORMATS' | 'AUDIO_JOB_RETENTION_HOURS' |
      'AUDIO_QUEUE_POLL_INTERVAL_MS' | 'TELEGRAM_API_TIMEOUT_MS'
    >;
    messages: Messages;
    jobs: TelegramAudioJobRepository;
    files: TelegramAudioFileGateway;
    telegram: TelegramMessageSender;
    logger?: Logger;
  }
): Promise<void> => {
  const message = update.message;
  const chatId = message?.chat?.id;
  if (chatId === undefined) return;

  const audio = audioMessageSchema.safeParse(audioValue);
  if (!audio.success || message?.from?.id === undefined) {
    await dependencies.telegram.sendMessage(chatId, dependencies.messages.audioUnsupported, update.update_id);
    return;
  }
  if (audio.data.duration > dependencies.config.AUDIO_MAX_DURATION_SECONDS) {
    await dependencies.telegram.sendMessage(chatId, dependencies.messages.audioTooLong, update.update_id);
    return;
  }
  if (audio.data.file_size !== undefined && audio.data.file_size > dependencies.config.AUDIO_MAX_SIZE_BYTES) {
    await dependencies.telegram.sendMessage(chatId, dependencies.messages.audioUnsupported, update.update_id);
    return;
  }

  let fileInfo: { filePath: string; fileSize?: number } | undefined;
  if (audio.data.file_size === undefined || (!audio.data.mime_type && !audio.data.file_name)) {
    try {
      fileInfo = await dependencies.files.getFile(audio.data.file_id);
    } catch {
      await dependencies.telegram.sendMessage(chatId, dependencies.messages.temporaryFailure, update.update_id);
      return;
    }
  }
  const fileSizeBytes = audio.data.file_size ?? fileInfo?.fileSize;
  const metadata = validateAudioMetadata({
    durationSeconds: audio.data.duration,
    fileSizeBytes,
    fileName: audio.data.file_name ?? fileInfo?.filePath,
    mimeType: audio.data.mime_type
  }, {
    maxDurationSeconds: dependencies.config.AUDIO_MAX_DURATION_SECONDS,
    maxSizeBytes: dependencies.config.AUDIO_MAX_SIZE_BYTES,
    supportedFormats: dependencies.config.AUDIO_SUPPORTED_FORMATS
  });
  if (!metadata.ok) {
    await dependencies.telegram.sendMessage(
      chatId,
      metadata.reason === 'duration_exceeded' ? dependencies.messages.audioTooLong : dependencies.messages.audioUnsupported,
      update.update_id
    );
    return;
  }
  if (fileSizeBytes === undefined) {
    await dependencies.telegram.sendMessage(chatId, dependencies.messages.audioUnsupported, update.update_id);
    return;
  }

  const queued = await dependencies.jobs.enqueue({
    updateId: update.update_id,
    telegramFileId: audio.data.file_id,
    telegramUserId: String(message.from.id),
    chatId,
    durationSeconds: audio.data.duration,
    fileSizeBytes,
    ...(audio.data.mime_type === undefined ? {} : { mimeType: audio.data.mime_type }),
    ...(audio.data.file_name === undefined ? {} : { fileName: audio.data.file_name }),
    deduplicateUntil: new Date(Date.now() + dependencies.config.AUDIO_JOB_RETENTION_HOURS * 60 * 60 * 1000).toISOString()
  });
  if (queued.receiptNeeded) {
    const receiptClaim = await dependencies.jobs.claimReceipt(
      update.update_id,
      Math.ceil((dependencies.config.TELEGRAM_API_TIMEOUT_MS + dependencies.config.AUDIO_QUEUE_POLL_INTERVAL_MS) / 1000)
    );
    if (receiptClaim === 'in_progress') throw new AppError('conflict');
    if (receiptClaim === 'claimed') {
      await dependencies.telegram.sendMessage(chatId, dependencies.messages.audioProcessing, update.update_id);
      await dependencies.jobs.markReceiptSent(update.update_id);
    }
  }
  dependencies.logger?.log('info', 'telegram.audio.queued', { updateId: update.update_id, inserted: queued.inserted });
};
