import type { Messages } from '../config/messages.js';
import type { Transaction } from '../domain/transaction.js';

export const formatTransactionReply = (
  transaction: Transaction,
  messages: Messages,
  locale: string,
  currency: string
): string => {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  // Keep the decimal string intact; converting it to Number can round large amounts.
  const formatExact = formatter.format as unknown as (value: string) => string;
  const amount = formatExact(transaction.amount);
  const description = transaction.description === transaction.type
    ? messages.typeLabels[transaction.type]
    : transaction.description;

  return messages.success
    .replaceAll('{type}', messages.typeLabels[transaction.type])
    .replaceAll('{description}', description)
    .replaceAll('{amount}', amount);
};
