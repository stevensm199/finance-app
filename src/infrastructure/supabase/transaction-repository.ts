import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../domain/errors.js';
import type { TransactionRepository } from '../../domain/transaction-repository.js';
import type { NewTransaction, Page, Transaction, TransactionUpdate } from '../../domain/transaction.js';
import type { Logger } from '../../service/logger.js';

const selectedFields = 'id,owner_id,type,description,amount:amount::text,registered_at,telegram_update_id';

type TransactionRow = {
  id: string;
  owner_id: string;
  type: Transaction['type'];
  description: string;
  amount: string;
  registered_at: string;
  telegram_update_id: number | null;
};

const mapRow = (row: TransactionRow): Transaction => ({
  id: row.id,
  ownerId: row.owner_id,
  type: row.type,
  description: row.description,
  amount: row.amount,
  registeredAt: row.registered_at,
  ...(row.telegram_update_id === null ? {} : { updateId: row.telegram_update_id })
});

export class SupabaseTransactionRepository implements TransactionRepository {
  constructor(private readonly client: SupabaseClient, private readonly logger?: Logger) {}

  async create(ownerId: string, transaction: NewTransaction, updateId?: number): Promise<Transaction> {
    const fields = { updateId: updateId ?? null };
    this.logger?.log('debug', 'supabase.transaction.create.started', fields);
    const row = {
      owner_id: ownerId,
      type: transaction.type,
      description: transaction.description,
      amount: transaction.amount,
      ...(updateId === undefined ? {} : { telegram_update_id: updateId })
    };
    const { data, error } = await this.client.from('transactions').insert(row).select(selectedFields).single();

    if (error?.code === '23505' && updateId !== undefined) {
      const existing = await this.client.from('transactions').select(selectedFields).eq('telegram_update_id', updateId).maybeSingle();
      if (existing.error) {
        this.logger?.log('error', 'supabase.transaction.create.failed', { ...fields, errorCode: existing.error.code ?? 'unknown' });
        throw new AppError('persistence');
      }
      if (existing.data) {
        const saved = mapRow(existing.data as TransactionRow);
        if (saved.ownerId === ownerId) {
          this.logger?.log('info', 'supabase.transaction.create.completed', { ...fields, outcome: 'idempotent_replay' });
          return saved;
        }
        this.logger?.log('warn', 'supabase.transaction.create.conflict', fields);
        throw new AppError('conflict');
      }
    }

    if (error || !data) {
      this.logger?.log('error', 'supabase.transaction.create.failed', { ...fields, errorCode: error?.code ?? 'empty_result' });
      throw new AppError('persistence');
    }
    this.logger?.log('info', 'supabase.transaction.create.completed', { ...fields, outcome: 'created' });
    return mapRow(data as TransactionRow);
  }

  async update(ownerId: string, id: string, changes: TransactionUpdate): Promise<Transaction> {
    this.logger?.log('debug', 'supabase.transaction.update.started');
    const row = {
      ...(changes.type === undefined ? {} : { type: changes.type }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
      ...(changes.amount === undefined ? {} : { amount: changes.amount })
    };
    const { data, error } = await this.client.from('transactions').update(row).eq('id', id).eq('owner_id', ownerId).select(selectedFields).maybeSingle();
    if (error) {
      this.logger?.log('error', 'supabase.transaction.update.failed', { errorCode: error.code ?? 'unknown' });
      throw new AppError('persistence');
    }
    if (!data) {
      this.logger?.log('warn', 'supabase.transaction.update.not_found');
      throw new AppError('not_found');
    }
    this.logger?.log('info', 'supabase.transaction.update.completed');
    return mapRow(data as TransactionRow);
  }

  async delete(ownerId: string, id: string): Promise<void> {
    this.logger?.log('debug', 'supabase.transaction.delete.started');
    const { data, error } = await this.client.from('transactions').delete().eq('id', id).eq('owner_id', ownerId).select('id').maybeSingle();
    if (error) {
      this.logger?.log('error', 'supabase.transaction.delete.failed', { errorCode: error.code ?? 'unknown' });
      throw new AppError('persistence');
    }
    if (!data) {
      this.logger?.log('warn', 'supabase.transaction.delete.not_found');
      throw new AppError('not_found');
    }
    this.logger?.log('info', 'supabase.transaction.delete.completed');
  }

  async list(ownerId: string, page: number, pageSize: number): Promise<Page<Transaction>> {
    this.logger?.log('debug', 'supabase.transaction.list.started', { page, pageSize });
    const first = (page - 1) * pageSize;
    const { data, error, count } = await this.client.from('transactions')
      .select(selectedFields, { count: 'exact' })
      .eq('owner_id', ownerId)
      .order('registered_at', { ascending: false })
      .order('id', { ascending: false })
      .range(first, first + pageSize - 1);
    if (error) {
      this.logger?.log('error', 'supabase.transaction.list.failed', { errorCode: error.code ?? 'unknown' });
      throw new AppError('persistence');
    }
    this.logger?.log('info', 'supabase.transaction.list.completed', { itemCount: data?.length ?? 0, total: count ?? 0 });
    return { items: (data ?? []).map((row) => mapRow(row as TransactionRow)), page, pageSize, total: count ?? 0 };
  }
}
