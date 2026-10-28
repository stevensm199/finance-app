import { describe, expect, it, vi } from 'vitest';
import Groq from 'groq-sdk';
import type { Logger } from '../../service/logger.js';
import { GroqTranscriber } from './transcriber.js';

const makeTranscriber = (result: unknown, reject = false, logger?: Logger) => {
  const create = vi.fn(async (_params: unknown) => {
    if (reject) throw new Error('private provider detail');
    return result;
  });
  const client = {
    audio: { transcriptions: { create } }
  } as unknown as Groq;
  const transcriber = new GroqTranscriber({
    apiKey: 'private-groq-key', model: 'whisper-large-v3-turbo', timeoutMs: 1000, client, logger
  });
  return { transcriber, create };
};

describe('GroqTranscriber', () => {
  it('requests a multilingual transcription with segment metadata', async () => {
    const { transcriber, create } = makeTranscriber({
      text: 'Gasté 120000 en Netflix',
      duration: 4.5,
      segments: [{ start: 0, end: 4.5, text: 'Gasté 120000 en Netflix', no_speech_prob: 0.02 }]
    });

    await expect(transcriber.transcribe(new Uint8Array([1]), 'voice.ogg')).resolves.toEqual({
      text: 'Gasté 120000 en Netflix',
      durationSeconds: 4.5,
      segments: [{ start: 0, end: 4.5, text: 'Gasté 120000 en Netflix', noSpeechProbability: 0.02 }]
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'whisper-large-v3-turbo', response_format: 'verbose_json', temperature: 0, timestamp_granularities: ['segment']
    }));
  });

  it('preserves empty text and missing speech metadata for service-level validation', async () => {
    const { transcriber } = makeTranscriber({ text: '', segments: [{ start: 0, end: 2, text: '' }] });
    await expect(transcriber.transcribe(new Uint8Array([1]), 'silent.ogg')).resolves.toMatchObject({ text: '', segments: [{ start: 0, end: 2 }] });
  });

  it('rejects malformed provider responses and maps request failures safely', async () => {
    const malformed = makeTranscriber({ text: 7 });
    await expect(malformed.transcriber.transcribe(new Uint8Array([1]), 'voice.ogg')).rejects.toMatchObject({ code: 'provider' });
    const failed = makeTranscriber({}, true);
    await expect(failed.transcriber.transcribe(new Uint8Array([1]), 'voice.ogg')).rejects.toMatchObject({ code: 'provider' });
  });

  it('logs only safe transcription metadata', async () => {
    const log = vi.fn();
    const logger = { log } satisfies Logger;
    const { transcriber } = makeTranscriber({ text: 'private transcript', segments: [] }, false, logger);
    await transcriber.transcribe(new Uint8Array([1]), 'voice.ogg');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private transcript');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-groq-key');
  });
});
