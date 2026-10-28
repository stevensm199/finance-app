import { describe, expect, it } from 'vitest';
import { loadMessages } from './messages.js';

describe('configured messages', () => {
  it('provides the audio lifecycle and validation responses', () => {
    const messages = loadMessages('config/messages.es.json');
    expect(messages.audioProcessing).toContain('procesando');
    expect(messages.audioTooLong).toContain('30 segundos');
    expect(messages.audioUnsupported).toContain('audio');
    expect(messages.audioNoSpeech).toContain('voz');
  });
});
