import { describe, expect, it, vi } from 'vitest';
import { TelegramBotClient } from './bot-client.js';

describe('TelegramBotClient', () => {
  it('sends the configured user message without backend service credentials', async () => {
    let requestUrl: URL | undefined;
    let requestInit: RequestInit | undefined;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = new URL(url.toString());
      requestInit = init;
      return Response.json({ ok: true });
    });
    const client = new TelegramBotClient('https://api.telegram.org', '123456:telegram-bot-token', 1000, fetcher as unknown as typeof fetch);
    await client.sendMessage(42, 'Transacción registrada.');
    expect(requestUrl?.pathname).toBe('/bot123456:telegram-bot-token/sendMessage');
    expect(requestUrl?.protocol).toBe('https:');
    expect(requestUrl?.hostname).toBe('api.telegram.org');
    expect(JSON.parse(String(requestInit?.body))).toEqual({ chat_id: 42, text: 'Transacción registrada.' });
    expect(JSON.stringify(requestInit?.body)).not.toContain('BOT_SERVICE_TOKEN');
  });

  it('maps Telegram API and network failures to a safe provider error', async () => {
    const failed = new TelegramBotClient('https://api.telegram.org', 'telegram-bot-token', 1000, vi.fn(async () => Response.json({ ok: false })) as unknown as typeof fetch);
    await expect(failed.sendMessage(42, 'text')).rejects.toMatchObject({ code: 'provider' });
    const network = new TelegramBotClient('https://api.telegram.org', 'telegram-bot-token', 1000, vi.fn(async () => { throw new Error('private network detail'); }) as unknown as typeof fetch);
    await expect(network.sendMessage(42, 'text')).rejects.toMatchObject({ code: 'provider' });
  });
});
