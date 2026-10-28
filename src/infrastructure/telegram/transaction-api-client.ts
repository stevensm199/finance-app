import { AppError, type ErrorCode } from '../../domain/errors.js';
import type { NewTransaction, Page, Transaction, TransactionUpdate } from '../../domain/transaction.js';
import type { Logger } from '../../service/logger.js';

const codeByStatus: Record<number, ErrorCode> = {
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  500: 'persistence',
  502: 'provider'
};

export class TelegramTransactionApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly timeoutMs: number,
    private readonly fetcher: typeof fetch = fetch,
    private readonly logger?: Logger
  ) {}

  create(telegramUserId: string, updateId: number, input: NewTransaction): Promise<Transaction> {
    return this.request('create', '/api/transactions', telegramUserId, 'POST', input, updateId);
  }

  update(telegramUserId: string, id: string, input: TransactionUpdate): Promise<Transaction> {
    return this.request('update', `/api/transactions/${encodeURIComponent(id)}`, telegramUserId, 'PATCH', input);
  }

  async delete(telegramUserId: string, id: string): Promise<void> {
    await this.request('delete', `/api/transactions/${encodeURIComponent(id)}`, telegramUserId, 'DELETE');
  }

  list(telegramUserId: string, page: number, pageSize: number): Promise<Page<Transaction>> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    return this.request('list', `/api/transactions?${params}`, telegramUserId, 'GET');
  }

  private async request<T>(operation: string, path: string, telegramUserId: string, method: string, body?: unknown, updateId?: number): Promise<T> {
    const startedAt = Date.now();
    const fields = { operation, method, ...(updateId === undefined ? {} : { updateId }) };
    this.logger?.log('debug', 'transaction_api.request.started', fields);
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.baseUrl), {
        method,
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.serviceToken}`,
          'x-telegram-user-id': telegramUserId,
          ...(updateId === undefined ? {} : { 'idempotency-key': String(updateId) }),
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      this.logger?.log('error', 'transaction_api.request.failed', { ...fields, failure: 'network_or_timeout' });
      throw new AppError('provider');
    }
    if (!response.ok) {
      const code = codeByStatus[response.status] ?? 'provider';
      this.logger?.log('warn', 'transaction_api.request.failed', { ...fields, httpStatus: response.status, errorCode: code });
      throw new AppError(code);
    }
    if (method === 'DELETE') {
      this.logger?.log('info', 'transaction_api.request.completed', { ...fields, durationMs: Date.now() - startedAt });
      return undefined as T;
    }
    try {
      const result = await response.json() as T;
      this.logger?.log('info', 'transaction_api.request.completed', { ...fields, durationMs: Date.now() - startedAt });
      return result;
    } catch {
      this.logger?.log('error', 'transaction_api.response.invalid', fields);
      throw new AppError('provider');
    }
  }
}
