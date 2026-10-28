import { Router, type RequestHandler } from 'express';
import { AppError } from '../../domain/errors.js';
import type { TransactionRepository } from '../../domain/transaction-repository.js';
import type { PaginationConfig } from '../../service/transactions.js';
import { createTransactionController } from './transaction-controller.js';

export const requireOwnerContext: RequestHandler = (_request, response, next) => {
  if (typeof response.locals.ownerId !== 'string' || !response.locals.ownerId.trim()) {
    next(new AppError('unauthorized'));
    return;
  }
  next();
};

export const createTransactionRouter = (
  repository: TransactionRepository,
  pagination: PaginationConfig,
  authenticate: RequestHandler,
  resolveOwner: RequestHandler
) => {
  const router = Router();
  const controller = createTransactionController(repository, pagination);
  router.use(authenticate, resolveOwner, requireOwnerContext);
  router.post('/', controller.create);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.delete);
  router.get('/', controller.list);
  return router;
};
