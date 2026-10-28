import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseTelegramAudioJobRepository } from './telegram-audio-job-repository.js';

const input = {
  updateId: 12,
  telegramFileId: 'private-file-id',
  telegramUserId: '42',
  chatId: 42,
  durationSeconds: 8,
  fileSizeBytes: 1500,
  mimeType: 'audio/ogg',
  fileName: 'voice.oga',
  deduplicateUntil: '2026-11-04T00:00:00.000Z'
};
const row = {
  update_id: 12,
  telegram_file_id: 'private-file-id',
  telegram_user_id: '42',
  chat_id: 42,
  duration_seconds: 8,
  file_size_bytes: 1500,
  mime_type: 'audio/ogg',
  file_name: 'voice.oga',
  status: 'processing',
  attempt_count: 1,
  reply_attempt_count: 0,
  deduplicate_until: input.deduplicateUntil,
  outbound_message: null,
  outbound_type: null,
  last_error_code: null
};

const setup = () => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['upsert', 'update', 'select', 'eq', 'is']) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn();
  const from = vi.fn(() => query);
  const rpc = vi.fn();
  const client = { from, rpc } as unknown as SupabaseClient;
  return { repository: new SupabaseTelegramAudioJobRepository(client), query, from, rpc };
};

describe('SupabaseTelegramAudioJobRepository', () => {
  it('enqueues a job once and reports duplicate updates without replacing the existing row', async () => {
    const { repository, query } = setup();
    query.maybeSingle.mockResolvedValueOnce({ data: { update_id: 12 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { status: 'queued', receipt_sent_at: null }, error: null });
    await expect(repository.enqueue(input)).resolves.toEqual({ inserted: true, receiptNeeded: true });
    await expect(repository.enqueue(input)).resolves.toEqual({ inserted: false, receiptNeeded: true });
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ update_id: 12, telegram_file_id: 'private-file-id' }), {
      onConflict: 'update_id', ignoreDuplicates: true
    });
  });

  it('atomically claims the processing receipt and marks it sent', async () => {
    const { repository, query, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    query.maybeSingle.mockResolvedValueOnce({ data: { receipt_sent_at: null }, error: null })
      .mockResolvedValueOnce({ data: { receipt_sent_at: '2026-10-28T00:00:00.000Z' }, error: null })
      .mockResolvedValueOnce({ data: { update_id: 12 }, error: null });
    await expect(repository.claimReceipt(12, 12)).resolves.toBe('claimed');
    await expect(repository.claimReceipt(12, 12)).resolves.toBe('in_progress');
    await expect(repository.claimReceipt(12, 12)).resolves.toBe('already_sent');
    await expect(repository.markReceiptSent(12)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('claim_telegram_audio_receipt', { p_update_id: 12, p_lease_seconds: 12 });
    expect(query.is).toHaveBeenCalledWith('receipt_sent_at', null);
  });

  it('claims and maps the next leased job', async () => {
    const { repository, rpc } = setup();
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    rpc.mockReturnValue({ maybeSingle });
    await expect(repository.claim(90)).resolves.toMatchObject({
      updateId: 12, telegramUserId: '42', telegramFileId: 'private-file-id', status: 'processing', attemptCount: 1
    });
    expect(rpc).toHaveBeenCalledWith('claim_telegram_audio_job', { p_lease_seconds: 90 });
  });

  it('persists retry scheduling and a pending outbound reply', async () => {
    const { repository, query } = setup();
    query.maybeSingle.mockResolvedValue({ data: { update_id: 12 }, error: null });
    await repository.retry(12, '2026-10-28T00:00:05.000Z', 'provider');
    expect(query.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'retry', next_attempt_at: '2026-10-28T00:00:05.000Z', last_error_code: 'provider' }));
    await repository.queueReply(12, 'Transacción registrada', 'success');
    expect(query.update).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 'reply_pending', outbound_message: 'Transacción registrada', outbound_type: 'success' }));
    await repository.retryReply(12, '2026-10-28T00:00:10.000Z', 'provider');
    expect(query.update).toHaveBeenNthCalledWith(3, expect.objectContaining({ status: 'reply_pending', next_attempt_at: '2026-10-28T00:00:10.000Z', last_error_code: 'provider' }));
  });

  it('clears private metadata when a job reaches a terminal state', async () => {
    const { repository, query } = setup();
    query.maybeSingle.mockResolvedValue({ data: { update_id: 12 }, error: null });
    await repository.complete(12, '2026-11-04T00:00:00.000Z');
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed', telegram_file_id: null, telegram_user_id: null, chat_id: null,
      outbound_message: null, outbound_type: null
    }));
    await repository.fail(12, 'provider', '2026-11-04T00:00:00.000Z');
    expect(query.update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', last_error_code: 'provider', file_name: null }));
  });

  it('cleans expired rows and maps database failures safely', async () => {
    const { repository, rpc, query } = setup();
    rpc.mockResolvedValue({ data: 2, error: null });
    await expect(repository.deleteExpired()).resolves.toBe(2);
    rpc.mockResolvedValue({ data: null, error: { code: '08006' } });
    await expect(repository.deleteExpired()).rejects.toMatchObject({ code: 'persistence' });
    query.maybeSingle.mockResolvedValue({ data: null, error: { code: '08006' } });
    await expect(repository.enqueue(input)).rejects.toMatchObject({ code: 'persistence' });
    rpc.mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { code: '08006' } }) });
    await expect(repository.claim(90)).rejects.toMatchObject({ code: 'persistence' });
  });
});
