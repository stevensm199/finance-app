import { z } from 'zod';
import { amountSchema, transactionTypeSchema } from './transaction.js';

export const transactionExtractionSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    type: transactionTypeSchema,
    amount: amountSchema,
    description: z.string().optional()
  }).strict(),
  z.object({ ok: z.literal(false) }).passthrough()
]);

export type TransactionExtraction = z.infer<typeof transactionExtractionSchema>;
