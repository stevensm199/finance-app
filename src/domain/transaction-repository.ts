import type { NewTransaction, Page, Transaction, TransactionUpdate } from './transaction.js';

export interface TransactionRepository {
  create(ownerId: string, transaction: NewTransaction, updateId?: number): Promise<Transaction>;
  update(ownerId: string, id: string, changes: TransactionUpdate): Promise<Transaction>;
  delete(ownerId: string, id: string): Promise<void>;
  list(ownerId: string, page: number, pageSize: number): Promise<Page<Transaction>>;
}
