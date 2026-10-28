import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../domain/errors.js';
import type { AudioTranscriber } from '../domain/audio-transcriber.js';
import type { TelegramAudioJob } from '../domain/telegram-audio-job.js';
import type { TelegramAudioJobRepository } from '../domain/telegram-audio-job-repository.js';
import type { TelegramAudioFileGateway } from '../domain/telegram-audio-files.js';
import type { TransactionExtractor } from '../domain/transaction-extractor.js';
import type { Messages } from '../config/messages.js';
import type { AudioFormat } from '../config/config.js';
import { audioMatchesFormat, validateAudioMetadata } from './audio-validation.js';
import { captureAudioTransaction } from './capture-audio-transaction.js';
import type { TelegramTransactionApi } from './capture-transaction.js';
import { formatTransactionReply } from './transaction-reply.js';
import type { TelegramMessageSender } from './process-telegram-update.js';
import type { Logger } from './logger.js';

export interface TelegramAudioWorkerDependencies {
  jobs: TelegramAudioJobRepository;
  files: TelegramAudioFileGateway;
  transcriber: AudioTranscriber;
  extractor: TransactionExtractor;
  api: TelegramTransactionApi;
  telegram: TelegramMessageSender;
  messages: Messages;
  logger?: Logger;
  config: {
    TRANSACTION_CUES: string[];
    AUDIO_MAX_DURATION_SECONDS: number;
    AUDIO_MAX_SIZE_BYTES: number;
    AUDIO_SUPPORTED_FORMATS: AudioFormat[];
    AUDIO_NO_SPEECH_THRESHOLD: number;
    AUDIO_MAX_ATTEMPTS: number;
    AUDIO_QUEUE_POLL_INTERVAL_MS: number;
    AUDIO_JOB_RETENTION_HOURS: number;
    TELEGRAM_API_TIMEOUT_MS: number;
    GROQ_TIMEOUT_MS: number;
    LOCALE: string;
    CURRENCY: string;
  };
}

export const processTelegramAudioJob = async (job: TelegramAudioJob, dependencies: TelegramAudioWorkerDependencies): Promise<void> => {
  if (job.status === 'reply_pending') {
    await deliverPendingReply(job, dependencies);
    return;
  }
  if (job.status !== 'processing') return;
  if (job.attemptCount > dependencies.config.AUDIO_MAX_ATTEMPTS) {
    await dependencies.jobs.queueReply(job.updateId, dependencies.messages.temporaryFailure, 'temporary_failure');
    return;
  }

  try {
    if (job.durationSeconds > dependencies.config.AUDIO_MAX_DURATION_SECONDS) {
      await queueReply(job, dependencies.messages.audioTooLong, 'audio_too_long', dependencies);
      return;
    }

    const fileInfo = await dependencies.files.getFile(job.telegramFileId);
    const fileSizeBytes = Math.max(job.fileSizeBytes, fileInfo.fileSize ?? 0);
    const validation = validateAudioMetadata({
      durationSeconds: job.durationSeconds,
      fileSizeBytes,
      fileName: job.fileName ?? fileInfo.filePath,
      mimeType: job.mimeType ?? undefined
    }, {
      maxDurationSeconds: dependencies.config.AUDIO_MAX_DURATION_SECONDS,
      maxSizeBytes: dependencies.config.AUDIO_MAX_SIZE_BYTES,
      supportedFormats: dependencies.config.AUDIO_SUPPORTED_FORMATS
    });
    if (!validation.ok) {
      await queueValidationReply(job, validation.reason, dependencies);
      return;
    }

    const audio = await dependencies.files.download(fileInfo.filePath, dependencies.config.AUDIO_MAX_SIZE_BYTES);
    if (!audioMatchesFormat(audio, validation.format)) {
      await queueReply(job, dependencies.messages.audioUnsupported, 'audio_unsupported', dependencies);
      return;
    }

    const transcription = await dependencies.transcriber.transcribe(audio, `telegram-audio.${validation.format}`);
    const result = await captureAudioTransaction({
      telegramUserId: job.telegramUserId,
      updateId: job.updateId,
      transcription
    }, {
      cues: dependencies.config.TRANSACTION_CUES,
      maxDurationSeconds: dependencies.config.AUDIO_MAX_DURATION_SECONDS,
      noSpeechThreshold: dependencies.config.AUDIO_NO_SPEECH_THRESHOLD
    }, dependencies.extractor, dependencies.api, dependencies.logger);

    if (result.kind === 'recorded') {
      await queueReply(job, formatTransactionReply(result.transaction, dependencies.messages, dependencies.config.LOCALE, dependencies.config.CURRENCY), 'transaction_summary', dependencies);
    } else if (result.kind === 'no_speech') {
      await queueReply(job, dependencies.messages.audioNoSpeech, 'audio_no_speech', dependencies);
    } else if (result.kind === 'duration_exceeded') {
      await queueReply(job, dependencies.messages.audioTooLong, 'audio_too_long', dependencies);
    } else {
      await queueReply(job, dependencies.messages.usage, 'usage', dependencies);
    }
  } catch (error) {
    if (error instanceof AppError && error.code === 'forbidden') {
      await queueReply(job, dependencies.messages.unlinkedAccount, 'unlinked_account', dependencies);
      return;
    }
    if (error instanceof AppError && error.code === 'validation') {
      await queueReply(job, dependencies.messages.audioUnsupported, 'audio_unsupported', dependencies);
      return;
    }
    const errorCode = error instanceof AppError ? error.code : 'unexpected';
    if (job.attemptCount >= dependencies.config.AUDIO_MAX_ATTEMPTS) {
      dependencies.logger?.log('error', 'audio.job.retry_exhausted', { updateId: job.updateId, errorCode, attempt: job.attemptCount });
      await queueReply(job, dependencies.messages.temporaryFailure, 'temporary_failure', dependencies);
      return;
    }
    const waitMs = dependencies.config.AUDIO_QUEUE_POLL_INTERVAL_MS * job.attemptCount;
    dependencies.logger?.log('warn', 'audio.job.retry_scheduled', { updateId: job.updateId, errorCode, attempt: job.attemptCount, waitMs });
    await dependencies.jobs.retry(job.updateId, new Date(Date.now() + waitMs).toISOString(), errorCode);
  }
};

export const startTelegramAudioWorker = (dependencies: TelegramAudioWorkerDependencies) => {
  const controller = new AbortController();
  const runner = run(dependencies, controller.signal);
  return {
    stop: async () => {
      controller.abort();
      await runner;
    }
  };
};

const run = async (dependencies: TelegramAudioWorkerDependencies, signal: AbortSignal): Promise<void> => {
  const leaseSeconds = Math.ceil((dependencies.config.GROQ_TIMEOUT_MS + dependencies.config.TELEGRAM_API_TIMEOUT_MS * 2) / 1000);
  let cleanupAfter = 0;
  while (!signal.aborted) {
    try {
      const job = await dependencies.jobs.claim(leaseSeconds);
      if (job) {
        dependencies.logger?.log('info', 'audio.job.claimed', { updateId: job.updateId, status: job.status, attempt: job.attemptCount });
        await processTelegramAudioJob(job, dependencies);
      } else if (Date.now() >= cleanupAfter) {
        await dependencies.jobs.deleteExpired();
        cleanupAfter = Date.now() + dependencies.config.AUDIO_JOB_RETENTION_HOURS * 60 * 60 * 1000;
        await delay(dependencies.config.AUDIO_QUEUE_POLL_INTERVAL_MS, undefined, { signal });
      } else {
        await delay(dependencies.config.AUDIO_QUEUE_POLL_INTERVAL_MS, undefined, { signal });
      }
    } catch (error) {
      if (signal.aborted) break;
      dependencies.logger?.log('error', 'audio.worker.iteration_failed', {
        errorCode: error instanceof AppError ? error.code : 'unexpected'
      });
      try { await delay(dependencies.config.AUDIO_QUEUE_POLL_INTERVAL_MS, undefined, { signal }); } catch { break; }
    }
  }
};

const deliverPendingReply = async (job: TelegramAudioJob, dependencies: TelegramAudioWorkerDependencies): Promise<void> => {
  if (job.outboundMessage === null || job.outboundType === null || job.replyAttemptCount > dependencies.config.AUDIO_MAX_ATTEMPTS) {
    await dependencies.jobs.fail(job.updateId, 'reply_retry_exhausted', deduplicateUntil(dependencies));
    return;
  }
  try {
    await dependencies.telegram.sendMessage(job.chatId, job.outboundMessage, job.updateId);
    await dependencies.jobs.complete(job.updateId, deduplicateUntil(dependencies));
    dependencies.logger?.log('info', 'audio.job.completed', { updateId: job.updateId, replyType: job.outboundType, replyAttempt: job.replyAttemptCount });
  } catch {
    if (job.replyAttemptCount >= dependencies.config.AUDIO_MAX_ATTEMPTS) {
      await dependencies.jobs.fail(job.updateId, 'reply_retry_exhausted', deduplicateUntil(dependencies));
      dependencies.logger?.log('error', 'audio.job.reply_failed', { updateId: job.updateId, replyType: job.outboundType });
      return;
    }
    const waitMs = dependencies.config.AUDIO_QUEUE_POLL_INTERVAL_MS * job.replyAttemptCount;
    await dependencies.jobs.retryReply(job.updateId, new Date(Date.now() + waitMs).toISOString(), 'telegram_reply');
  }
};

const queueReply = (
  job: TelegramAudioJob,
  message: string,
  type: string,
  dependencies: TelegramAudioWorkerDependencies
): Promise<void> => dependencies.jobs.queueReply(job.updateId, message, type);

const queueValidationReply = (
  job: TelegramAudioJob,
  reason: 'invalid_metadata' | 'duration_exceeded' | 'size_exceeded' | 'unsupported_format',
  dependencies: TelegramAudioWorkerDependencies
): Promise<void> => reason === 'duration_exceeded'
  ? queueReply(job, dependencies.messages.audioTooLong, 'audio_too_long', dependencies)
  : queueReply(job, dependencies.messages.audioUnsupported, 'audio_unsupported', dependencies);

const deduplicateUntil = (dependencies: TelegramAudioWorkerDependencies): string =>
  new Date(Date.now() + dependencies.config.AUDIO_JOB_RETENTION_HOURS * 60 * 60 * 1000).toISOString();
