import { describe, expect, it } from 'vitest';
import { amountSchema, createTransactionSchema, paginationSchema, updateTransactionSchema } from './schemas.js';

describe('transaction request schemas', () => {
  it('accepts valid amounts and create requests', () => {
    expect(amountSchema.safeParse('120000').success).toBe(true);
    expect(createTransactionSchema.safeParse({ type: 'expense', amount: '120000' }).success).toBe(true);
  });

  it('rejects invalid amount values and caller-supplied ownership', () => {
    expect(amountSchema.safeParse('-1').success).toBe(false);
    expect(amountSchema.safeParse('0').success).toBe(false);
    expect(createTransactionSchema.safeParse({ type: 'expense', amount: '1', owner_id: 'other' }).success).toBe(false);
  });

  it('requires a non-empty update and valid pagination', () => {
    expect(updateTransactionSchema.safeParse({}).success).toBe(false);
    expect(paginationSchema.safeParse({ page: '1', pageSize: '20' }).success).toBe(true);
    expect(paginationSchema.safeParse({ page: '0', pageSize: '20' }).success).toBe(false);
  });
});
