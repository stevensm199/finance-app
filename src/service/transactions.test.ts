import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../domain/errors.js';
import type { Transaction } from '../domain/transaction.js';
import type { TransactionRepository } from '../domain/transaction-repository.js';
import { createTransaction, deleteTransaction, listTransactions, updateTransaction } from './transactions.js';

const transaction: Transaction = {
  id: '6b7f23e0-07ba-4d02-9b8e-55af619ad001',
  ownerId: 'telegram:42',
  type: 'expense',
  description: 'Netflix',
  amount: '120000',
  registeredAt: '2026-10-28T00:00:00.000Z'
};

const repository = () => ({
  create: vi.fn(async () => transaction),
  update: vi.fn(async () => transaction),
  delete: vi.fn(async () => undefined),
  list: vi.fn(async (_owner: string, page: number, pageSize: number) => ({ items: [transaction], page, pageSize, total: 1 }))
}) satisfies TransactionRepository;

describe('transaction use cases', () => {
  let repo: ReturnType<typeof repository>;

  beforeEach(() => { repo = repository(); });

  it('creates an owned transaction with normalized description', async () => {
    await expect(createTransaction(repo, 'telegram:42', { type: 'expense', amount: '120000' })).resolves.toEqual(transaction);
    expect(repo.create).toHaveBeenCalledWith('telegram:42', { type: 'expense', amount: '120000', description: 'expense' });
  });

  it('rejects invalid data and missing owner without persistence', async () => {
    await expect(createTransaction(repo, '', { type: 'expense', amount: '120000' })).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(createTransaction(repo, 'telegram:42', { type: 'expense', amount: '0' })).rejects.toThrow();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('updates and deletes only under the supplied owner', async () => {
    await expect(updateTransaction(repo, 'telegram:42', transaction.id, { description: 'Music' })).resolves.toEqual(transaction);
    await expect(deleteTransaction(repo, 'telegram:42', transaction.id)).resolves.toBeUndefined();
    expect(repo.update).toHaveBeenCalledWith('telegram:42', transaction.id, { description: 'Music' });
    expect(repo.delete).toHaveBeenCalledWith('telegram:42', transaction.id);
  });

  it('propagates repository not-found errors and rejects empty updates', async () => {
    repo.update.mockRejectedValue(new AppError('not_found'));
    await expect(updateTransaction(repo, 'telegram:42', transaction.id, { type: 'income' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(updateTransaction(repo, 'telegram:42', transaction.id, {})).rejects.toThrow();
  });

  it('lists configured pages and rejects invalid or oversized pages', async () => {
    const config = { defaultPageSize: 20, maxPageSize: 100 };
    await expect(listTransactions(repo, 'telegram:42', {}, config)).resolves.toMatchObject({ page: 1, pageSize: 20, total: 1 });
    await expect(listTransactions(repo, 'telegram:42', { page: '2', pageSize: '10' }, config)).resolves.toMatchObject({ page: 2, pageSize: 10 });
    await expect(listTransactions(repo, 'telegram:42', { page: '0' }, config)).rejects.toThrow();
    await expect(listTransactions(repo, 'telegram:42', { pageSize: '101' }, config)).rejects.toMatchObject({ code: 'validation' });
  });

  it('does not accept an owner identifier from pagination query parameters', async () => {
    await expect(listTransactions(repo, 'telegram:42', { owner_id: 'forged-owner' }, { defaultPageSize: 20, maxPageSize: 100 })).rejects.toThrow();
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('does not report success when persistence fails', async () => {
    repo.create.mockRejectedValue(new AppError('persistence'));
    await expect(createTransaction(repo, 'telegram:42', { type: 'income', amount: '1' })).rejects.toMatchObject({ code: 'persistence' });
  });
});
