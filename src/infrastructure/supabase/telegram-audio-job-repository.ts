import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AppError } from '../../domain/errors.js';
import type { NewTelegramAudioJob, TelegramAudioJob, TelegramAudioJobStatus } from '../../domain/telegram-audio-job.js';
import type { TelegramAudioJobRepository } from '../../domain/telegram-audio-job-repository.js';
import type { Logger } from '../../service/logger.js';

const rowSchema = z.object({
  update_id: z.coerce.number().int().nonnegative().safe(),
  telegram_file_id: z.string().nullable(),
  telegram_user_id: z.union([z.string(), z.number()]).nullable(),
  chat_id: z.coerce.number().nullable(),
  duration_seconds: z.number().int().nullable(),
  file_size_bytes: z.coerce.number().nullable(),
  mime_type: z.string().nullable(),
  file_name: z.string().nullable(),
  status: z.enum(['queued', 'processing', 'retry', 'reply_pending', 'completed', 'failed']),
  attempt_count: z.number().int().nonnegative(),
  reply_attempt_count: z.number().int().nonnegative(),
  deduplicate_until: z.string(),
  outbound_message: z.string().nullable(),
  outbound_type: z.string().nullable(),
  last_error_code: z.string().nullable()
});

const mapRow = (value: unknown): TelegramAudioJob => {
  const row = rowSchema.parse(value);
  if (row.status !== 'completed' && row.status !== 'failed' && (
    row.telegram_file_id === null || row.telegram_user_id === null || row.chat_id === null ||
    row.duration_seconds === null || row.file_size_bytes === null
  )) throw new AppError('persistence');
  return {
    updateId: row.update_id,
    telegramFileId: row.telegram_file_id ?? '',
    telegramUserId: row.telegram_user_id === null ? '' : String(row.telegram_user_id),
    chatId: row.chat_id ?? 0,
    durationSeconds: row.duration_seconds ?? 0,
    fileSizeBytes: row.file_size_bytes ?? 0,
    mimeType: row.mime_type,
    fileName: row.file_name,
    status: row.status as TelegramAudioJobStatus,
    attemptCount: row.attempt_count,
    replyAttemptCount: row.reply_attempt_count,
    deduplicateUntil: row.deduplicate_until,
    outboundMessage: row.outbound_message,
    outboundType: row.outbound_type,
    lastErrorCode: row.last_error_code
  };
};

export class SupabaseTelegramAudioJobRepository implements TelegramAudioJobRepository {
  constructor(private readonly client: SupabaseClient, private readonly logger?: Logger) {}

  async enqueue(job: NewTelegramAudioJob): Promise<{ inserted: boolean; receiptNeeded: boolean }> {
    const { data, error } = await this.client.from('telegram_audio_jobs').upsert({
      update_id: job.updateId,
      telegram_file_id: job.telegramFileId,
      telegram_user_id: job.telegramUserId,
      chat_id: job.chatId,
      duration_seconds: job.durationSeconds,
      file_size_bytes: job.fileSizeBytes,
      mime_type: job.mimeType ?? null,
      file_name: job.fileName ?? null,
      deduplicate_until: job.deduplicateUntil
    }, { onConflict: 'update_id', ignoreDuplicates: true }).select('update_id').maybeSingle();
    if (error) {
      this.logger?.log('error', 'supabase.audio_job.enqueue.failed', { errorCode: error.code ?? 'unknown' });
      throw new AppError('persistence');
    }
    if (data) {
      this.logger?.log('info', 'supabase.audio_job.enqueue.completed', { created: true });
      return { inserted: true, receiptNeeded: true };
    }
    const existing = await this.client.from('telegram_audio_jobs').select('status,receipt_sent_at').eq('update_id', job.updateId).maybeSingle();
    if (existing.error || !existing.data) {
      this.logger?.log('error', 'supabase.audio_job.enqueue.failed', { errorCode: existing.error?.code ?? 'missing_duplicate' });
      throw new AppError('persistence');
    }
    const receiptNeeded = existing.data.status === 'queued' && existing.data.receipt_sent_at === null;
    this.logger?.log('debug', 'supabase.audio_job.enqueue.completed', { created: false, receiptNeeded });
    return { inserted: false, receiptNeeded };
  }

  async claimReceipt(updateId: number, leaseSeconds: number): Promise<'claimed' | 'already_sent' | 'in_progress'> {
    const claim = await this.client.rpc('claim_telegram_audio_receipt', {
      p_update_id: updateId,
      p_lease_seconds: leaseSeconds
    });
    if (claim.error || typeof claim.data !== 'boolean') {
      this.logger?.log('error', 'supabase.audio_job.receipt_claim.failed', { errorCode: claim.error?.code ?? 'invalid_result' });
      throw new AppError('persistence');
    }
    if (claim.data) return 'claimed';
    const existing = await this.client.from('telegram_audio_jobs').select('receipt_sent_at').eq('update_id', updateId).maybeSingle();
    if (existing.error || !existing.data) {
      this.logger?.log('error', 'supabase.audio_job.receipt_claim.failed', { errorCode: existing.error?.code ?? 'not_found' });
      throw new AppError('persistence');
    }
    return existing.data.receipt_sent_at === null ? 'in_progress' : 'already_sent';
  }

  async markReceiptSent(updateId: number): Promise<void> {
    const { data, error } = await this.client.from('telegram_audio_jobs').update({
      receipt_sent_at: new Date().toISOString(), receipt_lease_expires_at: null, updated_at: new Date().toISOString()
    }).eq('update_id', updateId).is('receipt_sent_at', null).select('update_id').maybeSingle();
    if (error) {
      this.logger?.log('error', 'supabase.audio_job.receipt.failed', { errorCode: error.code ?? 'unknown' });
      throw new AppError('persistence');
    }
    if (!data) throw new AppError('conflict');
    this.logger?.log('debug', 'supabase.audio_job.receipt.marked');
  }

  async claim(leaseSeconds: number): Promise<TelegramAudioJob | null> {
    const { data, error } = await this.client.rpc('claim_telegram_audio_job', { p_lease_seconds: leaseSeconds }).maybeSingle();
    if (error) {
      this.logger?.log('error', 'supabase.audio_job.claim.failed', { errorCode: error.code ?? 'unknown' });
      throw new AppError('persistence');
    }
    if (!data) return null;
    try {
      return mapRow(data);
    } catch {
      this.logger?.log('error', 'supabase.audio_job.claim.failed', { reason: 'invalid_row' });
      throw new AppError('persistence');
    }
  }

  async retry(updateId: number, nextAttemptAt: string, errorCode: string): Promise<void> {
    await this.update(updateId, {
      status: 'retry', next_attempt_at: nextAttemptAt, lease_expires_at: null, last_error_code: errorCode
    }, 'retry');
  }

  async retryReply(updateId: number, nextAttemptAt: string, errorCode: string): Promise<void> {
    await this.update(updateId, {
      status: 'reply_pending', next_attempt_at: nextAttemptAt, lease_expires_at: null, last_error_code: errorCode
    }, 'reply_retry');
  }

  async queueReply(updateId: number, message: string, type: string): Promise<void> {
    await this.update(updateId, {
      status: 'reply_pending', outbound_message: message, outbound_type: type,
      reply_attempt_count: 0, next_attempt_at: new Date().toISOString(), lease_expires_at: null
    }, 'reply_queue');
  }

  async complete(updateId: number, deduplicateUntil: string): Promise<void> {
    await this.update(updateId, {
      status: 'completed', ...this.clearMetadata(), deduplicate_until: deduplicateUntil,
      completed_at: new Date().toISOString(), lease_expires_at: null, last_error_code: null
    }, 'complete');
  }

  async fail(updateId: number, errorCode: string, deduplicateUntil: string): Promise<void> {
    await this.update(updateId, {
      status: 'failed', ...this.clearMetadata(), deduplicate_until: deduplicateUntil,
      completed_at: new Date().toISOString(), lease_expires_at: null, last_error_code: errorCode
    }, 'fail');
  }

  async deleteExpired(): Promise<number> {
    const { data, error } = await this.client.rpc('delete_expired_telegram_audio_jobs');
    if (error || typeof data !== 'number') {
      this.logger?.log('error', 'supabase.audio_job.cleanup.failed', { errorCode: error?.code ?? 'invalid_result' });
      throw new AppError('persistence');
    }
    this.logger?.log('debug', 'supabase.audio_job.cleanup.completed', { deletedCount: data });
    return data;
  }

  private async update(updateId: number, values: Record<string, string | number | null>, operation: string): Promise<void> {
    const { data, error } = await this.client.from('telegram_audio_jobs').update(values).eq('update_id', updateId).select('update_id').maybeSingle();
    if (error || !data) {
      this.logger?.log('error', `supabase.audio_job.${operation}.failed`, { errorCode: error?.code ?? 'not_found' });
      throw new AppError('persistence');
    }
    this.logger?.log('debug', `supabase.audio_job.${operation}.completed`);
  }

  private clearMetadata() {
    return {
      telegram_file_id: null,
      telegram_user_id: null,
      chat_id: null,
      duration_seconds: null,
      file_size_bytes: null,
      mime_type: null,
      file_name: null,
      outbound_message: null,
      outbound_type: null
    };
  }
}
