import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../domain/transaction.js';
import type { TransactionExtractor } from '../domain/transaction-extractor.js';
import type { TelegramTransactionApi } from './capture-transaction.js';
import { captureTelegramTransaction } from './capture-transaction.js';

const input = { telegramUserId: '42', updateId: 123, text: 'Gasté 120.000 en Netflix' };
const transaction: Transaction = {
  id: '6b7f23e0-07ba-4d02-9b8e-55af619ad001',
  ownerId: 'internal-user-uuid',
  type: 'expense',
  description: 'Netflix',
  amount: '120000',
  registeredAt: '2026-10-28T00:00:00.000Z',
  updateId: 123
};

const setup = (result: unknown) => {
  const extractor = { extract: vi.fn(async () => result) } satisfies TransactionExtractor;
  const api = { create: vi.fn(async () => transaction) } satisfies TelegramTransactionApi;
  return { extractor, api };
};

describe('captureTelegramTransaction', () => {
  it('skips the model and API for text without a configured transaction cue', async () => {
    const { extractor, api } = setup({ ok: true, type: 'expense', amount: '20000' });
    await expect(captureTelegramTransaction({ ...input, text: 'Hola, 20.000 en Netflix' }, ['gasté'], extractor, api)).resolves.toEqual({ kind: 'not_transaction' });
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('validates model output and creates one transaction with the Telegram update ID', async () => {
    const { extractor, api } = setup({ ok: true, type: 'expense', amount: '120000', description: 'Netflix' });
    await expect(captureTelegramTransaction(input, ['gaste'], extractor, api)).resolves.toEqual({ kind: 'recorded', transaction });
    expect(api.create).toHaveBeenCalledWith('42', 123, { type: 'expense', amount: '120000', description: 'Netflix' });
  });

  it('defaults an omitted description to the transaction type', async () => {
    const { extractor, api } = setup({ ok: true, type: 'income', amount: '20' });
    await captureTelegramTransaction(input, ['gaste'], extractor, api);
    expect(api.create).toHaveBeenCalledWith('42', 123, { type: 'income', amount: '20', description: 'income' });
  });

  it.each([
    { ok: false },
    { ok: true, type: 'expense' },
    { ok: true, type: 'expense', amount: '-1' },
    'not-json'
  ])('rejects insufficient or malformed extraction without persistence', async (result) => {
    const { extractor, api } = setup(result);
    await expect(captureTelegramTransaction(input, ['gaste'], extractor, api)).resolves.toEqual({ kind: 'invalid_transaction' });
    expect(api.create).not.toHaveBeenCalled();
  });

  it('propagates model and API failures without inventing a successful result', async () => {
    const { extractor, api } = setup({ ok: true, type: 'expense', amount: '120000' });
    extractor.extract.mockRejectedValue(new Error('provider failure'));
    await expect(captureTelegramTransaction(input, ['gaste'], extractor, api)).rejects.toThrow('provider failure');
    extractor.extract.mockResolvedValue({ ok: true, type: 'expense', amount: '120000' });
    api.create.mockRejectedValue(new Error('API failure'));
    await expect(captureTelegramTransaction(input, ['gaste'], extractor, api)).rejects.toThrow('API failure');
  });
});
