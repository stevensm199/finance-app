import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../domain/errors.js';
import { SupabaseTransactionRepository } from './transaction-repository.js';

const row = {
  id: '6b7f23e0-07ba-4d02-9b8e-55af619ad001',
  owner_id: 'telegram:42',
  type: 'expense',
  description: 'Netflix',
  amount: '120000.01',
  registered_at: '2026-10-28T00:00:00.000Z',
  telegram_update_id: 123
};

const setup = () => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['insert', 'update', 'delete', 'select', 'eq', 'order']) {
    query[method] = vi.fn(() => query);
  }
  query.range = vi.fn();
  query.single = vi.fn();
  query.maybeSingle = vi.fn();
  const from = vi.fn(() => query);
  const client = { from } as unknown as SupabaseClient;
  return { repository: new SupabaseTransactionRepository(client), query, from };
};

describe('SupabaseTransactionRepository', () => {
  let repo: SupabaseTransactionRepository;
  let query: ReturnType<typeof setup>['query'];

  beforeEach(() => {
    ({ repository: repo, query } = setup());
  });

  it('creates an owner-scoped transaction and preserves the exact amount string', async () => {
    query.single.mockResolvedValue({ data: row, error: null });
    const result = await repo.create('telegram:42', { type: 'expense', description: 'Netflix', amount: '120000.01' }, 123);
    expect(result).toMatchObject({ ownerId: 'telegram:42', amount: '120000.01', updateId: 123 });
    expect(query.insert).toHaveBeenCalledWith({ owner_id: 'telegram:42', type: 'expense', description: 'Netflix', amount: '120000.01', telegram_update_id: 123 });
  });

  it('returns the existing transaction after a duplicate update and rejects a mismatched owner', async () => {
    query.single.mockResolvedValue({ data: null, error: { code: '23505' } });
    query.maybeSingle.mockResolvedValue({ data: row, error: null });
    await expect(repo.create('telegram:42', { type: 'expense', description: 'Netflix', amount: '120000.01' }, 123)).resolves.toMatchObject({ id: row.id });
    await expect(repo.create('telegram:other', { type: 'expense', description: 'Netflix', amount: '120000.01' }, 123)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('allows concurrent retries to produce only one transaction', async () => {
    let stored: typeof row | undefined;
    let inserted = 0;
    const client = {
      from: () => {
        const query: Record<string, (...args: unknown[]) => unknown> = {};
        for (const method of ['insert', 'update', 'delete', 'select', 'eq', 'order', 'range']) query[method] = () => query;
        query.single = async () => {
          if (!stored) {
            inserted += 1;
            stored = { ...row };
            return { data: stored, error: null };
          }
          return { data: null, error: { code: '23505' } };
        };
        query.maybeSingle = async () => ({ data: stored ?? null, error: null });
        return query;
      }
    } as unknown as SupabaseClient;
    const concurrentRepository = new SupabaseTransactionRepository(client);
    const input = { type: 'expense' as const, description: 'Netflix', amount: '120000.01' };
    const results = await Promise.all([
      concurrentRepository.create('telegram:42', input, 123),
      concurrentRepository.create('telegram:42', input, 123)
    ]);
    expect(inserted).toBe(1);
    expect(results[0]?.id).toBe(results[1]?.id);
  });

  it('maps failed inserts to a persistence error', async () => {
    query.single.mockResolvedValue({ data: null, error: { code: '08006' } });
    await expect(repo.create('telegram:42', { type: 'expense', description: 'Netflix', amount: '120000.01' })).rejects.toMatchObject({ code: 'persistence' });
  });

  it('updates only the owner-scoped mutable fields', async () => {
    query.maybeSingle.mockResolvedValue({ data: row, error: null });
    await expect(repo.update('telegram:42', row.id, { description: 'Music' })).resolves.toMatchObject({ description: 'Netflix' });
    expect(query.update).toHaveBeenCalledWith({ description: 'Music' });
    expect(query.eq).toHaveBeenCalledWith('owner_id', 'telegram:42');
    expect(query.update.mock.calls[0]?.[0]).not.toHaveProperty('owner_id');
    expect(query.update.mock.calls[0]?.[0]).not.toHaveProperty('registered_at');
  });

  it('returns not-found for updates and deletes with no owned row', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(repo.update('telegram:42', row.id, { type: 'income' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(repo.delete('telegram:42', row.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('deletes only the row matching both transaction ID and internal owner ID', async () => {
    query.maybeSingle.mockResolvedValue({ data: { id: row.id }, error: null });
    await expect(repo.delete('internal-user-uuid', row.id)).resolves.toBeUndefined();
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', row.id);
    expect(query.eq).toHaveBeenNthCalledWith(2, 'owner_id', 'internal-user-uuid');
  });

  it('lists owner-scoped pages in stable newest-first order', async () => {
    query.range.mockResolvedValue({ data: [row], error: null, count: 1 });
    await expect(repo.list('telegram:42', 2, 10)).resolves.toEqual({
      items: [{ id: row.id, ownerId: row.owner_id, type: row.type, description: row.description, amount: row.amount, registeredAt: row.registered_at, updateId: 123 }],
      page: 2,
      pageSize: 10,
      total: 1
    });
    expect(query.eq).toHaveBeenCalledWith('owner_id', 'telegram:42');
    expect(query.order).toHaveBeenNthCalledWith(1, 'registered_at', { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
    expect(query.range).toHaveBeenCalledWith(10, 19);
  });

  it('maps failed updates and listings to persistence errors', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: { code: '08006' } });
    query.range.mockResolvedValue({ data: null, error: { code: '08006' }, count: null });
    await expect(repo.update('telegram:42', row.id, { type: 'income' })).rejects.toMatchObject({ code: 'persistence' });
    await expect(repo.list('telegram:42', 1, 20)).rejects.toMatchObject({ code: 'persistence' });
  });
});
