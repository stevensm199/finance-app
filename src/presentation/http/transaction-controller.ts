import type { RequestHandler } from 'express';
import { createTransaction, deleteTransaction, listTransactions, updateTransaction } from '../../service/transactions.js';
import type { TransactionRepository } from '../../domain/transaction-repository.js';
import type { PaginationConfig } from '../../service/transactions.js';
import { telegramUpdateIdSchema, transactionIdSchema } from './schemas.js';

export const createTransactionController = (repository: TransactionRepository, pagination: PaginationConfig) => ({
  create: (async (request, response, next) => {
    try {
      const updateId = telegramUpdateIdSchema.parse(request.get('idempotency-key'));
      const result = await createTransaction(repository, response.locals.ownerId, request.body, updateId);
      response.status(201).json(result);
    } catch (error) { next(error); }
  }) satisfies RequestHandler,
  update: (async (request, response, next) => {
    try {
      const id = transactionIdSchema.parse(request.params.id);
      const result = await updateTransaction(repository, response.locals.ownerId, id, request.body);
      response.json(result);
    } catch (error) { next(error); }
  }) satisfies RequestHandler,
  delete: (async (request, response, next) => {
    try {
      const id = transactionIdSchema.parse(request.params.id);
      await deleteTransaction(repository, response.locals.ownerId, id);
      response.json({ deleted: true });
    } catch (error) { next(error); }
  }) satisfies RequestHandler,
  list: (async (request, response, next) => {
    try {
      const result = await listTransactions(repository, response.locals.ownerId, request.query, pagination);
      response.json(result);
    } catch (error) { next(error); }
  }) satisfies RequestHandler
});
