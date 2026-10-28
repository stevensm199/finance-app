import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/config.js';
import { loadMessages } from '../config/messages.js';
import { AppError } from '../domain/errors.js';
import type { Transaction } from '../domain/transaction.js';
import type { TransactionExtractor } from '../domain/transaction-extractor.js';
import type { TelegramTransactionApi } from './capture-transaction.js';
import type { TelegramMessageSender } from './process-telegram-update.js';
import { processTelegramUpdate } from './process-telegram-update.js';

const config = {
  TRANSACTION_CUES: ['gaste'],
  LOCALE: 'es-CO',
  CURRENCY: 'COP',
  AUDIO_MAX_DURATION_SECONDS: 30,
  AUDIO_MAX_SIZE_BYTES: 20_000_000,
  AUDIO_SUPPORTED_FORMATS: ['ogg'] as const,
  AUDIO_JOB_RETENTION_HOURS: 168
} as unknown as AppConfig;
const messages = loadMessages('config/messages.es.json');
const update = {
  update_id: 123,
  message: { message_id: 50, from: { id: 42 }, chat: { id: 42 }, text: 'Gasté 120.000 en Netflix' }
};
const transaction: Transaction = {
  id: '6b7f23e0-07ba-4d02-9b8e-55af619ad001',
  ownerId: 'internal-user-uuid',
  type: 'expense',
  description: 'Netflix',
  amount: '120000',
  registeredAt: '2026-10-28T00:00:00.000Z',
  updateId: 123
};

const setup = (extractorResult: unknown = { ok: true, type: 'expense', amount: '120000', description: 'Netflix' }) => {
  const extractor = { extract: vi.fn(async () => extractorResult) } satisfies TransactionExtractor;
  const api = { create: vi.fn(async () => transaction) } satisfies TelegramTransactionApi;
  const telegram = { sendMessage: vi.fn(async (_chatId: number, _text: string) => undefined) } satisfies TelegramMessageSender;
  return { extractor, api, telegram, dependencies: { config, messages, extractor, api, telegram } };
};

describe('processTelegramUpdate', () => {
  it('replies with unsupported guidance for non-text Telegram messages', async () => {
    const { extractor, api, telegram, dependencies } = setup();
    await processTelegramUpdate({ update_id: 1, message: { chat: { id: 42 } } }, dependencies);
    expect(telegram.sendMessage).toHaveBeenCalledWith(42, messages.unsupported, 1);
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('queues supported audio and sends a processing receipt without transcribing in the webhook use case', async () => {
    const { dependencies, telegram } = setup();
    const audioJobs = {
      enqueue: vi.fn(async () => ({ inserted: true, receiptNeeded: true })),
      claimReceipt: vi.fn(async () => 'claimed' as const),
      markReceiptSent: vi.fn(async () => undefined),
      claim: vi.fn(), retry: vi.fn(), retryReply: vi.fn(), queueReply: vi.fn(), complete: vi.fn(), fail: vi.fn(), deleteExpired: vi.fn()
    };
    const files = {
      getFile: vi.fn(), download: vi.fn()
    };
    await processTelegramUpdate({
      update_id: 124,
      message: { message_id: 51, from: { id: 42 }, chat: { id: 42 }, voice: { file_id: 'audio-file', duration: 5, file_size: 1024, mime_type: 'audio/ogg' } }
    }, { ...dependencies, audio: { jobs: audioJobs, files } });

    expect(audioJobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ updateId: 124, telegramUserId: '42' }));
    expect(telegram.sendMessage).toHaveBeenCalledWith(42, messages.audioProcessing, 124);
    expect(audioJobs.markReceiptSent).toHaveBeenCalledWith(124);
    expect(dependencies.extractor.extract).not.toHaveBeenCalled();
  });

  it('replies with usage guidance when no transaction cue or valid extraction exists', async () => {
    const { extractor, api, telegram, dependencies } = setup({ ok: false });
    await processTelegramUpdate({ ...update, message: { ...update.message, text: 'Hola, 20.000 en Netflix' } }, dependencies);
    await processTelegramUpdate(update, dependencies);
    expect(extractor.extract).toHaveBeenCalledOnce();
    expect(api.create).not.toHaveBeenCalled();
    expect(telegram.sendMessage).toHaveBeenLastCalledWith(42, messages.usage, update.update_id);
  });

  it('sends the success reply only after the API confirms persistence', async () => {
    const order: string[] = [];
    const { api, telegram, dependencies } = setup();
    api.create.mockImplementation(async () => { order.push('persist'); return transaction; });
    telegram.sendMessage.mockImplementation(async () => { order.push('reply'); });
    await processTelegramUpdate(update, dependencies);
    expect(order).toEqual(['persist', 'reply']);
    expect(telegram.sendMessage.mock.calls[0]?.[1]).toContain('Netflix');
  });

  it('uses configured unlinked-account and temporary-failure messages', async () => {
    const unlinked = setup();
    unlinked.api.create.mockRejectedValue(new AppError('forbidden'));
    await processTelegramUpdate(update, unlinked.dependencies);
    expect(unlinked.telegram.sendMessage).toHaveBeenCalledWith(42, messages.unlinkedAccount, update.update_id);

    const failed = setup();
    failed.extractor.extract.mockRejectedValue(new AppError('provider'));
    await processTelegramUpdate(update, failed.dependencies);
    expect(failed.telegram.sendMessage).toHaveBeenCalledWith(42, messages.temporaryFailure, update.update_id);
  });

  it('does not include backend credentials or raw errors in Telegram messages', async () => {
    const { extractor, telegram, dependencies } = setup();
    extractor.extract.mockRejectedValue(new Error('private-api-key'));
    await processTelegramUpdate(update, dependencies);
    expect(telegram.sendMessage).toHaveBeenCalledWith(42, messages.temporaryFailure, update.update_id);
    expect(JSON.stringify(telegram.sendMessage.mock.calls)).not.toContain('private-api-key');
  });
});
