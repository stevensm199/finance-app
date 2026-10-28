import { describe, expect, it, vi } from 'vitest';
import type { AudioFormat } from '../config/config.js';
import { loadMessages } from '../config/messages.js';
import type { TelegramAudioJobRepository } from '../domain/telegram-audio-job-repository.js';
import type { TelegramAudioFileGateway } from '../domain/telegram-audio-files.js';
import type { TelegramMessageSender } from './process-telegram-update.js';
import { queueTelegramAudio } from './queue-telegram-audio.js';

const messages = loadMessages('config/messages.es.json');
const baseUpdate = {
  update_id: 42,
  message: { from: { id: 123 }, chat: { id: 456 }, voice: { file_id: 'private-file-id', duration: 8, file_size: 100, mime_type: 'audio/ogg' } }
};
const config = {
  AUDIO_MAX_DURATION_SECONDS: 30,
  AUDIO_MAX_SIZE_BYTES: 20_000_000,
  AUDIO_SUPPORTED_FORMATS: ['ogg'] as AudioFormat[],
  AUDIO_JOB_RETENTION_HOURS: 168,
  AUDIO_QUEUE_POLL_INTERVAL_MS: 1000,
  TELEGRAM_API_TIMEOUT_MS: 10000
};
const setup = () => {
  const jobs: TelegramAudioJobRepository = {
    enqueue: vi.fn(async () => ({ inserted: true, receiptNeeded: true })),
    claimReceipt: vi.fn(async () => 'claimed' as const), markReceiptSent: vi.fn(async () => undefined),
    claim: vi.fn(async () => null), retry: vi.fn(async () => undefined), retryReply: vi.fn(async () => undefined),
    queueReply: vi.fn(async () => undefined), complete: vi.fn(async () => undefined), fail: vi.fn(async () => undefined),
    deleteExpired: vi.fn(async () => 0)
  };
  const files: TelegramAudioFileGateway = {
    getFile: vi.fn(async () => ({ filePath: 'voice/file.oga', fileSize: 100 })),
    download: vi.fn(async () => Buffer.from('OggS'))
  };
  const telegram: TelegramMessageSender = { sendMessage: vi.fn(async () => undefined) };
  return { dependencies: { config, messages, jobs, files, telegram }, jobs, files, telegram };
};

describe('queueTelegramAudio', () => {
  it('rejects long audio before looking up or queueing a file', async () => {
    const { dependencies, files, jobs, telegram } = setup();
    const longAudio = { ...baseUpdate.message.voice, duration: 31 };
    await queueTelegramAudio({ ...baseUpdate, message: { ...baseUpdate.message, voice: longAudio } }, longAudio, dependencies);
    expect(files.getFile).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(telegram.sendMessage).toHaveBeenCalledWith(456, messages.audioTooLong, 42);
  });

  it('rejects malformed audio metadata with a configured message', async () => {
    const { dependencies, files, jobs, telegram } = setup();
    await queueTelegramAudio(baseUpdate, { file_id: 'file-id', duration: '8' }, dependencies);
    expect(files.getFile).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(telegram.sendMessage).toHaveBeenCalledWith(456, messages.audioUnsupported, 42);
  });

  it('persists valid audio before sending its receipt and activating the job', async () => {
    const { dependencies, jobs, telegram } = setup();
    const order: string[] = [];
    (jobs.enqueue as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push('enqueue'); return { inserted: true, receiptNeeded: true }; });
    (jobs.claimReceipt as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push('claim'); return 'claimed'; });
    (telegram.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push('receipt'); });
    (jobs.markReceiptSent as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push('activate'); });

    await queueTelegramAudio(baseUpdate, baseUpdate.message.voice, dependencies);
    expect(order).toEqual(['enqueue', 'claim', 'receipt', 'activate']);
    expect(jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      updateId: 42, telegramFileId: 'private-file-id', telegramUserId: '123', chatId: 456, durationSeconds: 8, fileSizeBytes: 100
    }));
    expect(telegram.sendMessage).toHaveBeenCalledWith(456, messages.audioProcessing, 42);
  });

  it('resolves missing size from Telegram metadata before queueing', async () => {
    const { dependencies, jobs, files } = setup();
    const update = { ...baseUpdate, message: { ...baseUpdate.message, voice: { file_id: 'private-file-id', duration: 8, mime_type: 'audio/ogg' } } };
    await queueTelegramAudio(update, update.message.voice, dependencies);
    expect(files.getFile).toHaveBeenCalledWith('private-file-id');
    expect(jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ fileSizeBytes: 100 }));
  });

  it('does not repeat the receipt when the update already has an active job', async () => {
    const { dependencies, jobs, telegram } = setup();
    (jobs.enqueue as ReturnType<typeof vi.fn>).mockResolvedValue({ inserted: false, receiptNeeded: false });
    await queueTelegramAudio(baseUpdate, baseUpdate.message.voice, dependencies);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(jobs.claimReceipt).not.toHaveBeenCalled();
    expect(jobs.markReceiptSent).not.toHaveBeenCalled();
  });

  it('requests a webhook retry while another delivery owns the receipt lease', async () => {
    const { dependencies, jobs, telegram } = setup();
    (jobs.enqueue as ReturnType<typeof vi.fn>).mockResolvedValue({ inserted: false, receiptNeeded: true });
    (jobs.claimReceipt as ReturnType<typeof vi.fn>).mockResolvedValue('in_progress');
    await expect(queueTelegramAudio(baseUpdate, baseUpdate.message.voice, dependencies)).rejects.toMatchObject({ code: 'conflict' });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('leaves persistence errors for webhook retry instead of acknowledging', async () => {
    const { dependencies, jobs, telegram } = setup();
    (jobs.enqueue as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('database detail'));
    await expect(queueTelegramAudio(baseUpdate, baseUpdate.message.voice, dependencies)).rejects.toThrow('database detail');
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });
});
