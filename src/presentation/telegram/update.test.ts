import { describe, expect, it } from 'vitest';
import { telegramUpdateSchema } from './update.js';

describe('telegramUpdateSchema audio metadata', () => {
  it.each(['voice', 'audio'] as const)('preserves a valid %s message for service validation', (kind) => {
    const update = telegramUpdateSchema.parse({
      update_id: 1,
      message: {
        from: { id: 42 },
        chat: { id: 42 },
        [kind]: { file_id: 'telegram-file', duration: 12, mime_type: 'audio/ogg', file_size: 1024 }
      }
    });

    expect(update.message?.[kind]).toMatchObject({ file_id: 'telegram-file', duration: 12 });
  });

  it('preserves malformed audio metadata so the bot can send configured validation guidance', () => {
    expect(telegramUpdateSchema.parse({ update_id: 1, message: { audio: { duration: 12 } } }).message?.audio)
      .toEqual({ duration: 12 });
    expect(telegramUpdateSchema.parse({ update_id: 2, message: { voice: 'invalid' } }).message?.voice).toBe('invalid');
  });

  it('keeps accepting ordinary text updates', () => {
    expect(telegramUpdateSchema.parse({
      update_id: 2,
      message: { from: { id: 7 }, chat: { id: 7 }, text: 'gaste 2000 en café' }
    }).message?.text).toBe('gaste 2000 en café');
  });
});
