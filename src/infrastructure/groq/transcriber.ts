import Groq, { toFile } from 'groq-sdk';
import { z } from 'zod';
import { AppError } from '../../domain/errors.js';
import type { AudioTranscriber } from '../../domain/audio-transcriber.js';
import type { Logger } from '../../service/logger.js';

const responseSchema = z.object({
  text: z.string(),
  duration: z.number().nonnegative().optional(),
  segments: z.array(z.object({
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    text: z.string(),
    no_speech_prob: z.number().min(0).max(1).optional()
  })).optional()
});

export class GroqTranscriber implements AudioTranscriber {
  private readonly client: Groq;

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      timeoutMs: number;
      logger?: Logger;
      client?: Groq;
    }
  ) {
    this.client = options.client ?? new Groq({ apiKey: options.apiKey, timeout: options.timeoutMs, maxRetries: 0 });
  }

  async transcribe(audio: Uint8Array, fileName: string) {
    const startedAt = Date.now();
    this.options.logger?.log('info', 'audio.transcription.started', { provider: 'groq', model: this.options.model });
    let result: unknown;
    try {
      const file = await toFile(audio, fileName);
      result = await this.client.audio.transcriptions.create({
        file,
        model: this.options.model,
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
        temperature: 0
      });
    } catch {
      this.options.logger?.log('error', 'audio.transcription.failed', {
        provider: 'groq',
        failure: 'request_or_timeout',
        durationMs: Date.now() - startedAt
      });
      throw new AppError('provider');
    }

    const parsed = responseSchema.safeParse(result);
    if (!parsed.success) {
      this.options.logger?.log('error', 'audio.transcription.failed', {
        provider: 'groq',
        failure: 'invalid_response',
        durationMs: Date.now() - startedAt
      });
      throw new AppError('provider');
    }

    const transcription = {
      text: parsed.data.text,
      segments: (parsed.data.segments ?? []).map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text,
        ...(segment.no_speech_prob === undefined ? {} : { noSpeechProbability: segment.no_speech_prob })
      })),
      ...(parsed.data.duration === undefined ? {} : { durationSeconds: parsed.data.duration })
    };
    this.options.logger?.log('info', 'audio.transcription.completed', {
      provider: 'groq',
      durationMs: Date.now() - startedAt,
      hasText: Boolean(transcription.text.trim()),
      segmentCount: transcription.segments.length
    });
    return transcription;
  }
}
