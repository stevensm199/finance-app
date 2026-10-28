import { createTransactionSchema } from '../domain/transaction.js';
import { transactionExtractionSchema } from '../domain/transaction-extraction.js';
import type { Transaction } from '../domain/transaction.js';
import type { TransactionExtractor } from '../domain/transaction-extractor.js';
import { looksLikeTransaction } from './transaction-cues.js';
import type { Logger } from './logger.js';

export interface TelegramTransactionApi {
  create(telegramUserId: string, updateId: number, transaction: ReturnType<typeof createTransactionSchema.parse>): Promise<Transaction>;
}

export interface TelegramCaptureInput {
  telegramUserId: string;
  updateId: number;
  text: string;
}

export type TelegramCaptureResult =
  | { kind: 'not_transaction' }
  | { kind: 'invalid_transaction' }
  | { kind: 'recorded'; transaction: Transaction };

export const captureTelegramTransaction = async (
  input: TelegramCaptureInput,
  cues: string[],
  extractor: TransactionExtractor,
  api: TelegramTransactionApi,
  logger?: Logger
): Promise<TelegramCaptureResult> => {
  const matched = looksLikeTransaction(input.text, cues);
  logger?.log('debug', 'transaction.cue_check.completed', {
    updateId: input.updateId,
    matched,
    textLength: input.text.length
  });
  if (!matched) return { kind: 'not_transaction' };

  const output = await extractor.extract(input.text);
  const extracted = transactionExtractionSchema.safeParse(output);
  if (!extracted.success) {
    logger?.log('warn', 'transaction.extraction.rejected', { updateId: input.updateId, reason: 'invalid_shape' });
    return { kind: 'invalid_transaction' };
  }
  if (!extracted.data.ok) {
    logger?.log('info', 'transaction.extraction.rejected', { updateId: input.updateId, reason: 'insufficient_data' });
    return { kind: 'invalid_transaction' };
  }

  const { type, amount, description } = extracted.data;
  const transaction = createTransactionSchema.safeParse({ type, amount, description });
  if (!transaction.success) {
    logger?.log('warn', 'transaction.extraction.rejected', { updateId: input.updateId, reason: 'invalid_transaction_fields' });
    return { kind: 'invalid_transaction' };
  }

  const saved = await api.create(input.telegramUserId, input.updateId, transaction.data);
  logger?.log('info', 'transaction.capture.completed', { updateId: input.updateId, outcome: 'recorded' });
  return { kind: 'recorded', transaction: saved };
};
