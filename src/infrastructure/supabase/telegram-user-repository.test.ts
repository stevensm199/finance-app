import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../domain/errors.js';
import { SupabaseTelegramUserRepository } from './telegram-user-repository.js';

const setup = (result: unknown) => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result)
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn(() => query);
  const client = { from } as unknown as SupabaseClient;
  return { repository: new SupabaseTelegramUserRepository(client), query };
};

describe('SupabaseTelegramUserRepository', () => {
  it('resolves a Telegram sender to its internal owner UUID', async () => {
    const { repository, query } = setup({ data: { id: 'internal-user-uuid' }, error: null });
    await expect(repository.findOwnerIdByTelegramUserId('42')).resolves.toBe('internal-user-uuid');
    expect(query.eq).toHaveBeenCalledWith('telegram_user_id', '42');
  });

  it('returns no owner for an unassociated sender', async () => {
    const { repository } = setup({ data: null, error: null });
    await expect(repository.findOwnerIdByTelegramUserId('42')).resolves.toBeNull();
  });

  it('maps database errors without exposing database details', async () => {
    const { repository } = setup({ data: null, error: { message: 'private database detail' } });
    await expect(repository.findOwnerIdByTelegramUserId('42')).rejects.toMatchObject({ code: 'persistence' });
  });
});
