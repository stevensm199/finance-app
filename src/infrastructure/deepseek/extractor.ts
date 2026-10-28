import { AppError } from '../../domain/errors.js';
import type { TransactionExtractor } from '../../domain/transaction-extractor.js';
import type { Logger } from '../../service/logger.js';

interface DeepSeekOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  prompt: string;
  logger?: Logger;
  fetcher?: typeof fetch;
}

export class DeepSeekExtractor implements TransactionExtractor {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: DeepSeekOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async extract(message: string): Promise<unknown> {
    const startedAt = Date.now();
    this.options.logger?.log('info', 'llm.request.started', { provider: 'deepseek', model: this.options.model });
    let response: Response;
    try {
      response = await this.fetcher(new URL('chat/completions', `${this.options.baseUrl.replace(/\/$/, '')}/`), {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.options.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: this.options.prompt },
            { role: 'user', content: message }
          ]
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs)
      });
    } catch {
      this.options.logger?.log('error', 'llm.request.failed', {
        provider: 'deepseek',
        failure: 'network_or_timeout',
        durationMs: Date.now() - startedAt
      });
      throw new AppError('provider');
    }
    if (!response.ok) {
      this.options.logger?.log('error', 'llm.response.failed', {
        provider: 'deepseek',
        httpStatus: response.status,
        durationMs: Date.now() - startedAt
      });
      throw new AppError('provider');
    }

    let result: { choices?: Array<{ message?: { content?: string } }> };
    try {
      result = await response.json() as typeof result;
    } catch {
      this.options.logger?.log('error', 'llm.response.invalid', { provider: 'deepseek', reason: 'invalid_json' });
      throw new AppError('provider');
    }
    const content = result.choices?.[0]?.message?.content;
    this.options.logger?.log('info', 'llm.response.received', {
      provider: 'deepseek',
      durationMs: Date.now() - startedAt,
      hasContent: typeof content === 'string'
    });
    if (typeof content !== 'string') return content;
    try { return JSON.parse(content) as unknown; } catch { return content; }
  }
}
