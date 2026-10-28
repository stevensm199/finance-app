import { AppError } from '../../domain/errors.js';
import type { Logger } from '../../service/logger.js';

export class TelegramBotClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly botToken: string,
    private readonly timeoutMs: number,
    private readonly fetcher: typeof fetch = fetch,
    private readonly logger?: Logger
  ) {}

  async sendMessage(chatId: number, text: string, updateId?: number): Promise<void> {
    const startedAt = Date.now();
    const fields = { updateId: updateId ?? null };
    this.logger?.log('debug', 'telegram.bot_api.send_message.started', fields);
    let response: Response;
    try {
      response = await this.fetcher(new URL(`/bot${this.botToken}/sendMessage`, this.apiBaseUrl), {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      this.logger?.log('error', 'telegram.bot_api.send_message.failed', { ...fields, failure: 'network_or_timeout' });
      throw new AppError('provider');
    }
    if (!response.ok) {
      this.logger?.log('error', 'telegram.bot_api.send_message.failed', { ...fields, httpStatus: response.status });
      throw new AppError('provider');
    }
    let result: { ok?: boolean };
    try {
      result = await response.json() as { ok?: boolean };
    } catch {
      this.logger?.log('error', 'telegram.bot_api.send_message.failed', { ...fields, httpStatus: response.status, outcome: 'invalid_response' });
      throw new AppError('provider');
    }
    if (result.ok !== true) {
      this.logger?.log('error', 'telegram.bot_api.send_message.failed', { ...fields, httpStatus: response.status, outcome: 'api_rejected' });
      throw new AppError('provider');
    }
    this.logger?.log('info', 'telegram.bot_api.send_message.completed', { ...fields, durationMs: Date.now() - startedAt });
  }
}
