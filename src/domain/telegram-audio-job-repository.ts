import type { NewTelegramAudioJob, TelegramAudioJob } from './telegram-audio-job.js';

export interface TelegramAudioJobRepository {
  enqueue(job: NewTelegramAudioJob): Promise<{ inserted: boolean; receiptNeeded: boolean }>;
  claimReceipt(updateId: number, leaseSeconds: number): Promise<'claimed' | 'already_sent' | 'in_progress'>;
  markReceiptSent(updateId: number): Promise<void>;
  claim(leaseSeconds: number): Promise<TelegramAudioJob | null>;
  retry(updateId: number, nextAttemptAt: string, errorCode: string): Promise<void>;
  retryReply(updateId: number, nextAttemptAt: string, errorCode: string): Promise<void>;
  queueReply(updateId: number, message: string, type: string): Promise<void>;
  complete(updateId: number, deduplicateUntil: string): Promise<void>;
  fail(updateId: number, errorCode: string, deduplicateUntil: string): Promise<void>;
  deleteExpired(): Promise<number>;
}
