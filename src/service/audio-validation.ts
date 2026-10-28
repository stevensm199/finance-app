import type { AudioFormat } from '../config/config.js';

export interface AudioMetadata {
  durationSeconds: number;
  fileSizeBytes: number | undefined;
  fileName: string | undefined;
  mimeType: string | undefined;
}

export type AudioMetadataRejection = 'invalid_metadata' | 'duration_exceeded' | 'size_exceeded' | 'unsupported_format';
export type AudioMetadataValidation =
  | { ok: true; format: AudioFormat }
  | { ok: false; reason: AudioMetadataRejection };

const formatByExtension: Record<string, AudioFormat> = {
  flac: 'flac', mp3: 'mp3', mp4: 'mp4', mpeg: 'mpeg', mpga: 'mpga', m4a: 'm4a',
  ogg: 'ogg', oga: 'ogg', wav: 'wav', webm: 'webm'
};

const formatByMimeType: Record<string, AudioFormat> = {
  'audio/flac': 'flac', 'audio/x-flac': 'flac',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mpga': 'mpga',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/ogg': 'ogg', 'audio/opus': 'ogg',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/webm': 'webm'
};

export const validateAudioMetadata = (
  metadata: AudioMetadata,
  limits: { maxDurationSeconds: number; maxSizeBytes: number; supportedFormats: AudioFormat[] }
): AudioMetadataValidation => {
  if (!Number.isSafeInteger(metadata.durationSeconds) || metadata.durationSeconds <= 0) {
    return { ok: false, reason: 'invalid_metadata' };
  }
  if (metadata.durationSeconds > limits.maxDurationSeconds) return { ok: false, reason: 'duration_exceeded' };
  if (metadata.fileSizeBytes === undefined || !Number.isSafeInteger(metadata.fileSizeBytes) || metadata.fileSizeBytes <= 0) {
    return { ok: false, reason: 'invalid_metadata' };
  }
  if (metadata.fileSizeBytes > limits.maxSizeBytes) return { ok: false, reason: 'size_exceeded' };

  const mime = metadata.mimeType?.split(';', 1)[0]?.trim().toLocaleLowerCase();
  const extension = metadata.fileName?.split('.').pop()?.toLocaleLowerCase();
  const format = (mime && formatByMimeType[mime]) || (extension && formatByExtension[extension]);
  if (!format || !limits.supportedFormats.includes(format)) return { ok: false, reason: 'unsupported_format' };
  return { ok: true, format };
};

export const audioMatchesFormat = (audio: Uint8Array, format: AudioFormat): boolean => {
  if (audio.length < 4) return false;
  const ascii = (start: number, value: string) =>
    audio.length >= start + value.length && value.split('').every((character, index) => audio[start + index] === character.charCodeAt(0));
  const matchesMpegAudio = (audio[0] === 0xff && (audio[1]! & 0xe0) === 0xe0) || ascii(0, 'ID3');

  switch (format) {
    case 'flac': return ascii(0, 'fLaC');
    case 'ogg': return ascii(0, 'OggS');
    case 'wav': return ascii(0, 'RIFF') && ascii(8, 'WAVE');
    case 'webm': return audio[0] === 0x1a && audio[1] === 0x45 && audio[2] === 0xdf && audio[3] === 0xa3;
    case 'm4a': return audio.length >= 8 && ascii(4, 'ftyp');
    case 'mp4': return audio.length >= 8 && ascii(4, 'ftyp');
    case 'mp3': return matchesMpegAudio;
    case 'mpeg': return matchesMpegAudio;
    case 'mpga': return matchesMpegAudio;
  }
};
