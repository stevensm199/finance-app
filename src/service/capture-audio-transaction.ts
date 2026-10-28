import type { AudioTranscription } from '../domain/audio-transcriber.js';
import type { TransactionExtractor } from '../domain/transaction-extractor.js';
import type { TelegramTransactionApi, TelegramCaptureResult } from './capture-transaction.js';
import { captureTelegramTransaction } from './capture-transaction.js';
import type { Logger } from './logger.js';

export type AudioCaptureResult = TelegramCaptureResult | { kind: 'no_speech' | 'duration_exceeded' };

export const captureAudioTransaction = async (
  input: {
    telegramUserId: string;
    updateId: number;
    transcription: AudioTranscription;
  },
  options: {
    cues: string[];
    maxDurationSeconds: number;
    noSpeechThreshold: number;
  },
  extractor: TransactionExtractor,
  api: TelegramTransactionApi,
  logger?: Logger
): Promise<AudioCaptureResult> => {
  const duration = input.transcription.durationSeconds ?? Math.max(0, ...input.transcription.segments.map((segment) => segment.end));
  if (duration > options.maxDurationSeconds) {
    logger?.log('warn', 'audio.transcription.rejected', { updateId: input.updateId, reason: 'duration_exceeded', durationSeconds: duration });
    return { kind: 'duration_exceeded' };
  }

  const noSpeech = !input.transcription.text.trim() || (
    input.transcription.segments.length > 0 &&
    input.transcription.segments.every((segment) => segment.noSpeechProbability !== undefined && segment.noSpeechProbability >= options.noSpeechThreshold)
  );
  if (noSpeech) {
    logger?.log('info', 'audio.transcription.rejected', { updateId: input.updateId, reason: 'no_speech' });
    return { kind: 'no_speech' };
  }

  logger?.log('info', 'audio.transcription.accepted', { updateId: input.updateId, transcriptLength: input.transcription.text.length });
  return captureTelegramTransaction({
    telegramUserId: input.telegramUserId,
    updateId: input.updateId,
    text: input.transcription.text
  }, options.cues, extractor, api, logger);
};
