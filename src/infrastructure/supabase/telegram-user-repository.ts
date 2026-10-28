import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../domain/errors.js';
import type { TelegramUserRepository } from '../../domain/telegram-user-repository.js';
import type { Logger } from '../../service/logger.js';

export class SupabaseTelegramUserRepository implements TelegramUserRepository {
  constructor(private readonly client: SupabaseClient, private readonly logger?: Logger) {}

  async findOwnerIdByTelegramUserId(telegramUserId: string): Promise<string | null> {
    this.logger?.log('debug', 'supabase.user_lookup.started');
    const { data, error } = await this.client.from('users').select('id').eq('telegram_user_id', telegramUserId).maybeSingle();
    if (error) {
      this.logger?.log('error', 'supabase.user_lookup.failed', { errorCode: error.code ?? 'unknown' });
      throw new AppError('persistence');
    }
    this.logger?.log(data ? 'info' : 'warn', data ? 'supabase.user_lookup.completed' : 'supabase.user_lookup.unlinked');
    return data?.id ?? null;
  }
}
