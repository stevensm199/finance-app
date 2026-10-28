import { AppError } from '../domain/errors.js';
import type { TransactionRepository } from '../domain/transaction-repository.js';
import { createTransactionSchema, paginationSchema, updateTransactionSchema } from '../domain/transaction.js';
import type { TransactionUpdate } from '../domain/transaction.js';

export interface PaginationConfig {
  defaultPageSize: number;
  maxPageSize: number;
}

const requireOwner = (ownerId: string) => {
  if (!ownerId?.trim()) throw new AppError('unauthorized');
  return ownerId;
};

export const createTransaction = async (repository: TransactionRepository, ownerId: string, input: unknown, updateId?: number) => {
  const owner = requireOwner(ownerId);
  const transaction = createTransactionSchema.parse(input);
  return updateId === undefined ? repository.create(owner, transaction) : repository.create(owner, transaction, updateId);
}

export const updateTransaction = async (repository: TransactionRepository, ownerId: string, id: string, input: unknown) => {
  const owner = requireOwner(ownerId);
  const changes: TransactionUpdate = updateTransactionSchema.parse(input);
  return repository.update(owner, id, changes);
};

export const deleteTransaction = async (repository: TransactionRepository, ownerId: string, id: string) =>
  repository.delete(requireOwner(ownerId), id);

export const listTransactions = async (repository: TransactionRepository, ownerId: string, input: unknown, config: PaginationConfig) => {
  const owner = requireOwner(ownerId);
  const query = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  const pagination = paginationSchema.parse({ ...query, page: query.page ?? 1, pageSize: query.pageSize ?? config.defaultPageSize });
  if (pagination.pageSize > config.maxPageSize) throw new AppError('validation');
  return repository.list(owner, pagination.page, pagination.pageSize);
};
