import { describe, expect, it, vi } from 'vitest';
import { loadMessages } from '../config/messages.js';
import type { Logger } from './logger.js';
import type { TelegramAudioJob } from '../domain/telegram-audio-job.js';
import type { AudioTranscriber } from '../domain/audio-transcriber.js';
import type { Transaction } from '../domain/transaction.js';
import type { TransactionExtractor } from '../domain/transaction-extractor.js';
import type { TelegramAudioJobRepository } from '../domain/telegram-audio-job-repository.js';
import type { TelegramTransactionApi } from './capture-transaction.js';
import type { TelegramAudioWorkerDependencies } from './telegram-audio-worker.js';
import { processTelegramAudioJob, startTelegramAudioWorker } from './telegram-audio-worker.js';

const messages = loadMessages('config/messages.es.json');
const transaction: Transaction = {
  id: 'transaction-id', ownerId: 'owner-id', type: 'expense', description: 'Netflix', amount: '120000',
  registeredAt: '2026-10-28T00:00:00.000Z', updateId: 42
};
const job: TelegramAudioJob = {
  updateId: 42, telegramFileId: 'private-file-id', telegramUserId: '123', chatId: 456,
  durationSeconds: 8, fileSizeBytes: 4, mimeType: 'audio/ogg', fileName: 'voice.oga',
  status: 'processing', attemptCount: 1, replyAttemptCount: 0, deduplicateUntil: '2026-11-04T00:00:00.000Z',
  outboundMessage: null, outboundType: null, lastErrorCode: null
};

const setup = () => {
  const jobs: TelegramAudioJobRepository = {
    enqueue: vi.fn(async () => ({ inserted: true, receiptNeeded: true })),
    claimReceipt: vi.fn(async () => 'claimed' as const), markReceiptSent: vi.fn(async () => undefined), claim: vi.fn(async () => null),
    retry: vi.fn(async () => undefined), retryReply: vi.fn(async () => undefined),
    queueReply: vi.fn(async () => undefined), complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined), deleteExpired: vi.fn(async () => 0)
  };
  const files = {
    getFile: vi.fn(async () => ({ filePath: 'voice/file.oga', fileSize: 4 })),
    download: vi.fn(async () => Buffer.from('OggS'))
  };
  const transcriber = { transcribe: vi.fn(async () => ({
    text: 'Gasté 120000 en Netflix', durationSeconds: 8,
    segments: [{ start: 0, end: 8, text: 'Gasté 120000 en Netflix', noSpeechProbability: 0.01 }]
  })) } satisfies AudioTranscriber;
  const extractor = { extract: vi.fn(async () => ({ ok: true, type: 'expense', amount: '120000', description: 'Netflix' })) } satisfies TransactionExtractor;
  const api = { create: vi.fn(async () => transaction) } satisfies TelegramTransactionApi;
  const telegram = { sendMessage: vi.fn(async () => undefined) };
  const dependencies: TelegramAudioWorkerDependencies = {
    jobs, files, transcriber, extractor, api, telegram, messages,
    config: {
      TRANSACTION_CUES: ['gasté'], AUDIO_MAX_DURATION_SECONDS: 30, AUDIO_MAX_SIZE_BYTES: 20_000_000,
      AUDIO_SUPPORTED_FORMATS: ['ogg'], AUDIO_NO_SPEECH_THRESHOLD: 0.6, AUDIO_MAX_ATTEMPTS: 3,
      AUDIO_QUEUE_POLL_INTERVAL_MS: 10, AUDIO_JOB_RETENTION_HOURS: 168,
      TELEGRAM_API_TIMEOUT_MS: 1000, GROQ_TIMEOUT_MS: 1000, LOCALE: 'es-CO', CURRENCY: 'COP'
    }
  };
  return { dependencies, jobs, files, transcriber, extractor, api, telegram };
};

describe('processTelegramAudioJob', () => {
  it('transcribes valid audio, reuses capture, and queues a summary only after persistence', async () => {
    const { dependencies, files, transcriber, extractor, api, jobs } = setup();
    await processTelegramAudioJob(job, dependencies);
    expect(files.getFile).toHaveBeenCalledWith('private-file-id');
    expect(transcriber.transcribe).toHaveBeenCalledWith(Buffer.from('OggS'), 'telegram-audio.ogg');
    expect(extractor.extract).toHaveBeenCalledWith('Gasté 120000 en Netflix');
    expect(api.create).toHaveBeenCalledWith('123', 42, expect.objectContaining({ amount: '120000' }));
    expect(jobs.queueReply).toHaveBeenCalledWith(42, expect.stringContaining('Netflix'), 'transaction_summary');
  });

  it('rejects overlong audio before Telegram file lookup and transcription', async () => {
    const { dependencies, files, transcriber, jobs } = setup();
    await processTelegramAudioJob({ ...job, durationSeconds: 31 }, dependencies);
    expect(files.getFile).not.toHaveBeenCalled();
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect(jobs.queueReply).toHaveBeenCalledWith(42, messages.audioTooLong, 'audio_too_long');
  });

  it('rejects mismatched file content without calling Groq', async () => {
    const { dependencies, files, transcriber, jobs } = setup();
    files.download.mockResolvedValue(Buffer.from('not audio'));
    await processTelegramAudioJob(job, dependencies);
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect(jobs.queueReply).toHaveBeenCalledWith(42, messages.audioUnsupported, 'audio_unsupported');
  });

  it('retries provider errors and sends a configured failure after the attempt limit', async () => {
    const first = setup();
    first.transcriber.transcribe.mockRejectedValue(new Error('private provider details'));
    await processTelegramAudioJob(job, first.dependencies);
    expect(first.jobs.retry).toHaveBeenCalledWith(42, expect.any(String), 'unexpected');
    expect(first.jobs.queueReply).not.toHaveBeenCalled();

    const final = setup();
    final.transcriber.transcribe.mockRejectedValue(new Error('private provider details'));
    await processTelegramAudioJob({ ...job, attemptCount: 3 }, final.dependencies);
    expect(final.jobs.retry).not.toHaveBeenCalled();
    expect(final.jobs.queueReply).toHaveBeenCalledWith(42, messages.temporaryFailure, 'temporary_failure');
  });

  it('delivers a pending reply and clears the job after Telegram confirms it', async () => {
    const { dependencies, telegram, jobs } = setup();
    await processTelegramAudioJob({ ...job, status: 'reply_pending', outboundMessage: 'Recorded', outboundType: 'success' }, dependencies);
    expect(telegram.sendMessage).toHaveBeenCalledWith(456, 'Recorded', 42);
    expect(jobs.complete).toHaveBeenCalledWith(42, expect.any(String));
  });

  it('does not include personal identifiers, audio identifiers, transcripts, or amounts in logs', async () => {
    const { dependencies } = setup();
    const log = vi.fn();
    dependencies.logger = { log } satisfies Logger;
    await processTelegramAudioJob(job, dependencies);
    const records = JSON.stringify(log.mock.calls);
    for (const sensitive of ['private-file-id', '123', '456', 'Gasté 120000 en Netflix', '120000', 'Netflix']) {
      expect(records).not.toContain(sensitive);
    }
  });

  it('retries a failed Telegram reply without rerunning transcription', async () => {
    const { dependencies, telegram, transcriber, jobs } = setup();
    telegram.sendMessage.mockRejectedValue(new Error('network detail'));
    await processTelegramAudioJob({
      ...job, status: 'reply_pending', outboundMessage: 'Recorded', outboundType: 'success', replyAttemptCount: 1
    }, dependencies);
    expect(jobs.retryReply).toHaveBeenCalledWith(42, expect.any(String), 'telegram_reply');
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it('resumes a pending durable job when the worker starts', async () => {
    const { dependencies, jobs, telegram } = setup();
    let claimed = false;
    (jobs.claim as ReturnType<typeof vi.fn>)
      .mockImplementation(async () => claimed ? null : (claimed = true, { ...job, status: 'reply_pending', outboundMessage: 'Recovered', outboundType: 'success' }));
    const worker = startTelegramAudioWorker(dependencies);
    for (let i = 0; i < 20 && !telegram.sendMessage.mock.calls.length; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    await worker.stop();
    expect(telegram.sendMessage).toHaveBeenCalledWith(456, 'Recovered', 42);
  });
});
