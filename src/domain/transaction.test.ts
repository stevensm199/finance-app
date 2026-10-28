import { describe, expect, it } from 'vitest';
import { amountSchema, createTransactionSchema, updateTransactionSchema } from './transaction.js';

describe('transaction rules', () => {
  it('accepts positive exact decimal amounts without floating-point conversion', () => {
    expect(amountSchema.safeParse('120000').success).toBe(true);
    expect(amountSchema.safeParse('0.01').success).toBe(true);
  });

  it.each(['0', '0.00', '-1', '1e3', 'NaN', ''])('rejects invalid amount %s', (amount) => {
    expect(amountSchema.safeParse(amount).success).toBe(false);
  });

  it('defaults a missing or blank description to the transaction type', () => {
    expect(createTransactionSchema.parse({ type: 'expense', amount: '120000' }).description).toBe('expense');
    expect(createTransactionSchema.parse({ type: 'income', amount: '20', description: ' ' }).description).toBe('income');
  });

  it('rejects unsupported type and caller-controlled owner or timestamp fields', () => {
    expect(createTransactionSchema.safeParse({ type: 'transfer', amount: '1' }).success).toBe(false);
    expect(createTransactionSchema.safeParse({ type: 'expense', amount: '1', owner_id: 'other' }).success).toBe(false);
    expect(updateTransactionSchema.safeParse({ registeredAt: '2026-01-01T00:00:00Z' }).success).toBe(false);
  });

  it('requires at least one valid mutable field for an update', () => {
    expect(updateTransactionSchema.safeParse({}).success).toBe(false);
    expect(updateTransactionSchema.safeParse({ type: 'income', amount: '-1' }).success).toBe(false);
  });
});
