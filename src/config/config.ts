import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive();
const audioFormat = z.enum(['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm']);
export type AudioFormat = z.infer<typeof audioFormat>;
const audioFormats = z.string().default('flac,mp3,mp4,mpeg,mpga,m4a,ogg,wav,webm')
  .transform((value) => value.split(',').map((format) => format.trim().toLocaleLowerCase()).filter(Boolean))
  .pipe(z.array(audioFormat).min(1).refine((formats) => new Set(formats).size === formats.length));
const serviceUrl = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
});

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_API_BASE_URL: z.url(),
  TELEGRAM_API_TIMEOUT_MS: positiveInt,
  BOT_API_BASE_URL: serviceUrl,
  BOT_SERVICE_TOKEN: z.string().min(32),
  BOT_API_TIMEOUT_MS: positiveInt,
  LLM_PROVIDER: z.enum(['deepseek']),
  LLM_BASE_URL: z.url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_TIMEOUT_MS: positiveInt,
  GROQ_API_KEY: z.string().min(1),
  GROQ_TRANSCRIPTION_MODEL: z.string().min(1).default('whisper-large-v3-turbo'),
  GROQ_TIMEOUT_MS: positiveInt.default(60000),
  AUDIO_MAX_DURATION_SECONDS: z.coerce.number().int().positive().max(30).default(30),
  AUDIO_MAX_SIZE_BYTES: positiveInt.max(20_000_000).default(20_000_000),
  AUDIO_SUPPORTED_FORMATS: audioFormats,
  AUDIO_NO_SPEECH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
  AUDIO_MAX_ATTEMPTS: positiveInt.default(3),
  AUDIO_QUEUE_POLL_INTERVAL_MS: positiveInt.default(1000),
  AUDIO_JOB_RETENTION_HOURS: positiveInt.default(168),
  TRANSACTION_CUES: z.string().transform((value) => value.split(',').map((cue) => cue.trim().toLocaleLowerCase()).filter(Boolean)).pipe(z.array(z.string().min(1)).min(1)),
  TRANSACTION_PROMPT_FILE: z.string().min(1),
  MESSAGES_FILE: z.string().min(1),
  CURRENCY: z.string().regex(/^[A-Z]{3}$/),
  LOCALE: z.string().min(1),
  TIME_ZONE: z.string().min(1),
  PAGE_DEFAULT_SIZE: positiveInt,
  PAGE_MAX_SIZE: positiveInt
}).superRefine((config, ctx) => {
  if (config.PAGE_DEFAULT_SIZE > config.PAGE_MAX_SIZE) {
    ctx.addIssue({ code: 'custom', path: ['PAGE_DEFAULT_SIZE'], message: 'must not exceed PAGE_MAX_SIZE' });
  }

  try {
    new Intl.NumberFormat(config.LOCALE, { style: 'currency', currency: config.CURRENCY });
    new Intl.DateTimeFormat(config.LOCALE, { timeZone: config.TIME_ZONE });
  } catch {
    ctx.addIssue({ code: 'custom', path: ['TIME_ZONE'], message: 'locale, time zone, or currency is unsupported' });
  }
});

export type AppConfig = z.infer<typeof schema>;

export const loadConfig = (environment: NodeJS.ProcessEnv): AppConfig => schema.parse(environment);
