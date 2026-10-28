import { describe, expect, it, vi } from 'vitest';
import { TelegramTransactionApiClient } from './transaction-api-client.js';

const serviceToken = 'private-service-credential'.repeat(2);
const transaction = {
  id: '6b7f23e0-07ba-4d02-9b8e-55af619ad001',
  ownerId: 'internal-user-uuid',
  type: 'expense',
  description: 'Netflix',
  amount: '120000',
  registeredAt: '2026-10-28T00:00:00.000Z'
};

const setup = (response: Response = Response.json(transaction)) => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response.clone());
  return {
    client: new TelegramTransactionApiClient('http://127.0.0.1:3000', serviceToken, 1000, fetcher as unknown as typeof fetch),
    fetcher
  };
};

describe('TelegramTransactionApiClient', () => {
  it('sends the service credential and validated Telegram identity separately from transaction data', async () => {
    const { client, fetcher } = setup();
    await expect(client.create('42', 123, { type: 'expense', amount: '120000', description: 'Netflix' })).resolves.toEqual(transaction);
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe('/api/transactions');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${serviceToken}`);
    expect(new Headers(init.headers).get('x-telegram-user-id')).toBe('42');
    expect(new Headers(init.headers).get('idempotency-key')).toBe('123');
    expect(init.body).toBe(JSON.stringify({ type: 'expense', amount: '120000', description: 'Netflix' }));
    expect(init.body).not.toContain(serviceToken);
  });

  it('uses authenticated requests for update, delete, and paginated list', async () => {
    const { client, fetcher } = setup();
    await client.update('42', transaction.id, { description: 'Music' });
    await client.delete('42', transaction.id);
    await client.list('42', 2, 10);
    expect(fetcher.mock.calls.map(([url]) => (url as URL).pathname)).toEqual([
      `/api/transactions/${transaction.id}`,
      `/api/transactions/${transaction.id}`,
      '/api/transactions'
    ]);
    expect((fetcher.mock.calls[1]?.[1] as RequestInit).method).toBe('DELETE');
    expect((fetcher.mock.calls[2]?.[0] as URL).search).toBe('?page=2&pageSize=10');
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers((init as RequestInit).headers).get('authorization')).toBe(`Bearer ${serviceToken}`);
      expect(JSON.stringify((init as RequestInit).body ?? '')).not.toContain(serviceToken);
    }
  });

  it('maps authorization and backend failures without exposing response details', async () => {
    const unauthorized = setup(new Response('private error', { status: 401 }));
    await expect(unauthorized.client.list('42', 1, 20)).rejects.toMatchObject({ code: 'unauthorized' });
    const failed = setup(new Response('private error', { status: 503 }));
    await expect(failed.client.list('42', 1, 20)).rejects.toMatchObject({ code: 'provider' });
  });

  it('maps network failures to a provider error', async () => {
    const failing = new TelegramTransactionApiClient('http://127.0.0.1:3000', serviceToken, 1000, vi.fn(async () => { throw new Error('network detail'); }) as unknown as typeof fetch);
    await expect(failing.list('42', 1, 20)).rejects.toMatchObject({ code: 'provider' });
  });
});
