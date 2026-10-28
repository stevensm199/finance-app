import { z } from 'zod';
import { amountSchema, createTransactionSchema, paginationSchema, transactionTypeSchema, updateTransactionSchema } from '../../domain/transaction.js';

export const transactionIdSchema = z.uuid();
export const telegramUpdateIdSchema = z.coerce.number().int().nonnegative().refine(Number.isSafeInteger);

export { amountSchema, createTransactionSchema, paginationSchema, transactionTypeSchema, updateTransactionSchema };
