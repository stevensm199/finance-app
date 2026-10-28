import { readFileSync } from 'node:fs';
import { createApp } from './app.js';
import { loadConfig } from './config/config.js';
import { loadMessages } from './config/messages.js';
import { createClient } from '@supabase/supabase-js';
import { DeepSeekExtractor } from './infrastructure/deepseek/extractor.js';
import { TelegramBotClient } from './infrastructure/telegram/bot-client.js';
import { TelegramTransactionApiClient } from './infrastructure/telegram/transaction-api-client.js';
import { SupabaseTelegramUserRepository } from './infrastructure/supabase/telegram-user-repository.js';
import { SupabaseTransactionRepository } from './infrastructure/supabase/transaction-repository.js';
import { SupabaseTelegramAudioJobRepository } from './infrastructure/supabase/telegram-audio-job-repository.js';
import { TelegramFileClient } from './infrastructure/telegram/file-client.js';
import { GroqTranscriber } from './infrastructure/groq/transcriber.js';
import { createServiceAuthentication, createTelegramOwnerResolver } from './presentation/http/bot-auth.js';
import { createTransactionRouter } from './presentation/http/transaction-router.js';
import { createTelegramWebhookRouter } from './presentation/telegram/webhook.js';
import { processTelegramUpdate } from './service/process-telegram-update.js';
import { JsonLogger } from './infrastructure/logging/json-logger.js';
import { startTelegramAudioWorker } from './service/telegram-audio-worker.js';

const config = loadConfig(process.env);
const logger = new JsonLogger(config.LOG_LEVEL);
const messages = loadMessages(config.MESSAGES_FILE);
const prompt = readFileSync(config.TRANSACTION_PROMPT_FILE, 'utf8').trim();
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
const transactions = new SupabaseTransactionRepository(supabase, logger);
const users = new SupabaseTelegramUserRepository(supabase, logger);
const audioJobs = new SupabaseTelegramAudioJobRepository(supabase, logger);
const api = new TelegramTransactionApiClient(config.BOT_API_BASE_URL, config.BOT_SERVICE_TOKEN, config.BOT_API_TIMEOUT_MS, undefined, logger);
const telegram = new TelegramBotClient(config.TELEGRAM_API_BASE_URL, config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_API_TIMEOUT_MS, undefined, logger);
const telegramFiles = new TelegramFileClient(config.TELEGRAM_API_BASE_URL, config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_API_TIMEOUT_MS, undefined, logger);
const transcriber = new GroqTranscriber({
  apiKey: config.GROQ_API_KEY,
  model: config.GROQ_TRANSCRIPTION_MODEL,
  timeoutMs: config.GROQ_TIMEOUT_MS,
  logger
});
const extractor = new DeepSeekExtractor({
  baseUrl: config.LLM_BASE_URL,
  apiKey: config.LLM_API_KEY,
  model: config.LLM_MODEL,
  timeoutMs: config.LLM_TIMEOUT_MS,
  prompt,
  logger
});
const transactionRouter = createTransactionRouter(
  transactions,
  { defaultPageSize: config.PAGE_DEFAULT_SIZE, maxPageSize: config.PAGE_MAX_SIZE },
  createServiceAuthentication(config.BOT_SERVICE_TOKEN, logger),
  createTelegramOwnerResolver(users, logger)
);
const telegramRouter = createTelegramWebhookRouter(config.TELEGRAM_WEBHOOK_SECRET, (update) =>
  processTelegramUpdate(update, { config, messages, extractor, api, telegram, audio: { jobs: audioJobs, files: telegramFiles }, logger }),
  logger
);

const audioWorker = startTelegramAudioWorker({
  jobs: audioJobs,
  files: telegramFiles,
  transcriber,
  extractor,
  api,
  telegram,
  messages,
  config,
  logger
});
const server = createApp({ transactionRouter, telegramRouter, httpErrors: messages.httpErrors, logger }).listen(config.PORT, () => {
  logger.log('info', 'server.started', { port: config.PORT, logLevel: config.LOG_LEVEL });
});
server.on('close', () => { void audioWorker.stop(); });
