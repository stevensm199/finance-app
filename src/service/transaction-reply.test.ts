import { describe, expect, it } from 'vitest';
import { loadMessages } from '../config/messages.js';
import type { Transaction } from '../domain/transaction.js';
import { formatTransactionReply } from './transaction-reply.js';

const messages = loadMessages('config/messages.es.json');
const transaction: Transaction = {
  id: '6b7f23e0-07ba-4d02-9b8e-55af619ad001',
  ownerId: 'internal-user-uuid',
  type: 'expense',
  description: 'Netflix',
  amount: '120000',
  registeredAt: '2026-10-28T00:00:00.000Z'
};

describe('formatTransactionReply', () => {
  it('uses configured wording, localized type, description, and currency', () => {
    const reply = formatTransactionReply(transaction, messages, 'es-CO', 'COP');
    expect(reply).toContain('Tipo: Gasto');
    expect(reply).toContain('Descripción: Netflix');
    expect(reply).toContain('120.000');
  });

  it('localizes a default description and preserves large decimal amounts exactly', () => {
    const reply = formatTransactionReply({ ...transaction, description: 'income', type: 'income', amount: '9007199254740993' }, messages, 'es-CO', 'COP');
    expect(reply).toContain('Tipo: Ingreso');
    expect(reply).toContain('Descripción: Ingreso');
    expect(reply).toContain('9.007.199.254.740.993');
  });
});
