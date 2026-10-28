import { z } from 'zod';

const telegramMessageSchema = z.object({
  message_id: z.number().int().nonnegative().optional(),
  from: z.object({ id: z.number().int().positive() }).passthrough().optional(),
  chat: z.object({ id: z.number().int() }).passthrough().optional(),
  text: z.string().optional(),
  voice: z.unknown().optional(),
  audio: z.unknown().optional()
}).passthrough();

export const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: telegramMessageSchema.optional()
}).passthrough();

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
