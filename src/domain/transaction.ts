import { z } from 'zod';

export const transactionTypeSchema = z.enum(['expense', 'income']);
export type TransactionType = z.infer<typeof transactionTypeSchema>;

export const amountSchema = z.string().refine((value) => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return false;
  return BigInt(value.replace('.', '')) > 0n;
});

export const createTransactionSchema = z.object({
  type: transactionTypeSchema,
  amount: amountSchema,
  description: z.string().trim().max(500).optional()
}).strict().transform((value) => ({ ...value, description: value.description || value.type }));

export const updateTransactionSchema = z.object({
  type: transactionTypeSchema.optional(),
  amount: amountSchema.optional(),
  description: z.string().trim().min(1).max(500).optional()
}).strict().refine((value) => Object.keys(value).length > 0);

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive(),
  pageSize: z.coerce.number().int().positive()
}).strict();

export type NewTransaction = z.infer<typeof createTransactionSchema>;
export type TransactionUpdate = z.infer<typeof updateTransactionSchema>;

export interface Transaction extends NewTransaction {
  id: string;
  ownerId: string;
  registeredAt: string;
  updateId?: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
