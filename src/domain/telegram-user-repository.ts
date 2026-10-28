export interface TelegramUserRepository {
  findOwnerIdByTelegramUserId(telegramUserId: string): Promise<string | null>;
}
