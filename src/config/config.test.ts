import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const environment = {
  PORT: '3000',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'local',
  TELEGRAM_BOT_TOKEN: 'local',
  TELEGRAM_WEBHOOK_SECRET: 'local',
  TELEGRAM_API_BASE_URL: 'https://api.telegram.org',
  TELEGRAM_API_TIMEOUT_MS: '10000',
  BOT_API_BASE_URL: 'http://127.0.0.1:3000',
  BOT_SERVICE_TOKEN: 'x'.repeat(32),
  BOT_API_TIMEOUT_MS: '10000',
  LLM_PROVIDER: 'deepseek',
  LLM_BASE_URL: 'https://api.deepseek.com',
  LLM_API_KEY: 'local',
  LLM_MODEL: 'configured-model',
  LLM_TIMEOUT_MS: '15000',
  GROQ_API_KEY: 'local-groq-key',
  TRANSACTION_CUES: 'gaste, pague, gane',
  TRANSACTION_PROMPT_FILE: 'config/prompts/transaction-extraction.es.txt',
  MESSAGES_FILE: 'config/messages.es.json',
  CURRENCY: 'COP',
  LOCALE: 'es-CO',
  TIME_ZONE: 'America/Bogota',
  PAGE_DEFAULT_SIZE: '20',
  PAGE_MAX_SIZE: '100'
};

describe('loadConfig', () => {
  it('parses valid settings and splits transaction cues', () => {
    expect(loadConfig(environment).TRANSACTION_CUES).toEqual(['gaste', 'pague', 'gane']);
  });

  it('rejects missing secrets and an invalid pagination range', () => {
    expect(() => loadConfig({ ...environment, LLM_API_KEY: '', BOT_SERVICE_TOKEN: 'short', PAGE_DEFAULT_SIZE: '101' })).toThrow();
  });

  it('rejects unsupported locales, time zones, and empty cue lists', () => {
    expect(() => loadConfig({ ...environment, LOCALE: 'bad_locale', TIME_ZONE: 'Invalid/Zone', TRANSACTION_CUES: ', ,' })).toThrow();
  });

  it('rejects a non-local HTTP URL for the credentialed bot API', () => {
    expect(() => loadConfig({ ...environment, BOT_API_BASE_URL: 'http://api.example.com' })).toThrow();
  });

  it('uses safe audio defaults and parses configured supported formats', () => {
    const config = loadConfig(environment);
    expect(config.GROQ_TRANSCRIPTION_MODEL).toBe('whisper-large-v3-turbo');
    expect(config.AUDIO_MAX_DURATION_SECONDS).toBe(30);
    expect(config.AUDIO_MAX_SIZE_BYTES).toBe(20_000_000);
    expect(config.AUDIO_SUPPORTED_FORMATS).toContain('ogg');
  });

  it('rejects unsafe or malformed audio settings', () => {
    expect(() => loadConfig({ ...environment, AUDIO_MAX_DURATION_SECONDS: '31' })).toThrow();
    expect(() => loadConfig({ ...environment, AUDIO_MAX_SIZE_BYTES: '20000001' })).toThrow();
    expect(() => loadConfig({ ...environment, AUDIO_SUPPORTED_FORMATS: 'ogg,unsupported' })).toThrow();
    expect(() => loadConfig({ ...environment, AUDIO_SUPPORTED_FORMATS: 'ogg,ogg' })).toThrow();
    expect(() => loadConfig({ ...environment, GROQ_API_KEY: '' })).toThrow();
  });
});
