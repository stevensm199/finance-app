import { describe, expect, it } from 'vitest';
import type { AudioFormat } from '../config/config.js';
import { audioMatchesFormat, validateAudioMetadata } from './audio-validation.js';

const limits = {
  maxDurationSeconds: 30,
  maxSizeBytes: 20_000_000,
  supportedFormats: ['ogg', 'mp3', 'wav'] as AudioFormat[]
};

describe('validateAudioMetadata', () => {
  it('accepts allowed formats using MIME type or filename', () => {
    expect(validateAudioMetadata({ durationSeconds: 30, fileSizeBytes: 1200, fileName: undefined, mimeType: 'audio/ogg' }, limits))
      .toEqual({ ok: true, format: 'ogg' });
    expect(validateAudioMetadata({ durationSeconds: 1, fileSizeBytes: 1200, fileName: 'recording.mp3', mimeType: undefined }, limits))
      .toEqual({ ok: true, format: 'mp3' });
  });

  it.each([
    [{ durationSeconds: 0, fileSizeBytes: 10, fileName: 'voice.ogg', mimeType: 'audio/ogg' }, 'invalid_metadata'],
    [{ durationSeconds: 31, fileSizeBytes: 10, fileName: 'voice.ogg', mimeType: 'audio/ogg' }, 'duration_exceeded'],
    [{ durationSeconds: 2, fileSizeBytes: undefined, fileName: 'voice.ogg', mimeType: 'audio/ogg' }, 'invalid_metadata'],
    [{ durationSeconds: 2, fileSizeBytes: 20_000_001, fileName: 'voice.ogg', mimeType: 'audio/ogg' }, 'size_exceeded'],
    [{ durationSeconds: 2, fileSizeBytes: 10, fileName: 'voice.exe', mimeType: 'application/octet-stream' }, 'unsupported_format']
  ] as const)('rejects invalid metadata %#', (metadata, reason) => {
    expect(validateAudioMetadata(metadata, limits)).toEqual({ ok: false, reason });
  });

  it('does not accept a supported but unconfigured format', () => {
    expect(validateAudioMetadata({ durationSeconds: 2, fileSizeBytes: 10, fileName: 'voice.flac', mimeType: 'audio/flac' }, limits))
      .toEqual({ ok: false, reason: 'unsupported_format' });
  });
});

describe('audioMatchesFormat', () => {
  it.each([
    ['ogg', 'OggS' as const], ['flac', 'fLaC' as const], ['wav', 'RIFF0000WAVE' as const],
    ['webm', '\u001aEߣ' as const], ['mp4', '0000ftypisom' as const], ['m4a', '0000ftypM4A ' as const],
    ['mp3', 'ID3x' as const]
  ] as const)('recognizes a %s signature', (format, signature) => {
    expect(audioMatchesFormat(Buffer.from(signature), format)).toBe(true);
  });

  it('rejects unsupported bytes and mismatched content', () => {
    expect(audioMatchesFormat(Buffer.from('not audio'), 'ogg')).toBe(false);
    expect(audioMatchesFormat(Buffer.from('OggS'), 'mp3')).toBe(false);
    expect(audioMatchesFormat(Buffer.from([1, 2]), 'ogg')).toBe(false);
  });
});
