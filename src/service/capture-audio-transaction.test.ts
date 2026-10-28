import { describe, expect, it, vi } from 'vitest';
import type { AudioTranscription } from '../domain/audio-transcriber.js';
import type { Transaction } from '../domain/transaction.js';
import type { TransactionExtractor } from '../domain/transaction-extractor.js';
import type { TelegramTransactionApi } from './capture-transaction.js';
import { captureAudioTransaction } from './capture-audio-transaction.js';

const transaction: Transaction = {
  id: 'transaction-id', ownerId: 'owner-id', type: 'expense', description: 'Netflix', amount: '120000',
  registeredAt: '2026-10-28T00:00:00.000Z', updateId: 42
};
const setup = () => {
  const extractor = { extract: vi.fn(async () => ({ ok: true, type: 'expense', amount: '120000', description: 'Netflix' })) } satisfies TransactionExtractor;
  const api = { create: vi.fn(async () => transaction) } satisfies TelegramTransactionApi;
  return { extractor, api };
};
const options = { cues: ['gasté'], maxDurationSeconds: 30, noSpeechThreshold: 0.6 };
const transcription = (overrides: Partial<AudioTranscription> = {}): AudioTranscription => ({
  text: 'Gasté 120000 en Netflix',
  durationSeconds: 5,
  segments: [{ start: 0, end: 5, text: 'Gasté 120000 en Netflix', noSpeechProbability: 0.02 }],
  ...overrides
});

describe('captureAudioTransaction', () => {
  it('passes usable spoken text through existing capture with the Telegram update ID', async () => {
    const { extractor, api } = setup();
    const result = await captureAudioTransaction(
      { telegramUserId: '42', updateId: 42, transcription: transcription() }, options, extractor, api
    );
    expect(result).toEqual({ kind: 'recorded', transaction });
    expect(extractor.extract).toHaveBeenCalledWith('Gasté 120000 en Netflix');
    expect(api.create).toHaveBeenCalledWith('42', 42, expect.objectContaining({ amount: '120000' }));
  });

  it('skips extraction for empty or speech-free audio', async () => {
    const { extractor, api } = setup();
    await expect(captureAudioTransaction({ telegramUserId: '42', updateId: 1, transcription: transcription({ text: '' }) }, options, extractor, api))
      .resolves.toEqual({ kind: 'no_speech' });
    await expect(captureAudioTransaction({
      telegramUserId: '42', updateId: 2,
      transcription: transcription({ segments: [{ start: 0, end: 5, text: '', noSpeechProbability: 0.95 }] })
    }, options, extractor, api)).resolves.toEqual({ kind: 'no_speech' });
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('rejects a transcription whose measured duration exceeds the limit', async () => {
    const { extractor, api } = setup();
    await expect(captureAudioTransaction({
      telegramUserId: '42', updateId: 3,
      transcription: transcription({ durationSeconds: 31 })
    }, options, extractor, api)).resolves.toEqual({ kind: 'duration_exceeded' });
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('keeps non-transaction speech away from DeepSeek', async () => {
    const { extractor, api } = setup();
    const result = await captureAudioTransaction({
      telegramUserId: '42', updateId: 4, transcription: transcription({ text: 'Hola, cómo estás' })
    }, options, extractor, api);
    expect(result).toEqual({ kind: 'not_transaction' });
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });
});
