import { describe, expect, it, vi } from 'vitest';
import { TelegramFileClient } from './file-client.js';

describe('TelegramFileClient', () => {
  it('looks up a file without logging its identifier or token', async () => {
    let requestedUrl: URL | undefined;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      requestedUrl = new URL(String(url));
      return Response.json({ ok: true, result: { file_path: 'voice/file_0.oga', file_size: 1200 } });
    });
    const client = new TelegramFileClient('https://api.telegram.org', 'bot-token', 1000, fetcher as typeof fetch);

    await expect(client.getFile('private-file-id')).resolves.toEqual({ filePath: 'voice/file_0.oga', fileSize: 1200 });
    expect(requestedUrl?.pathname).toBe('/botbot-token/getFile');
    expect(requestedUrl?.searchParams.get('file_id')).toBe('private-file-id');
  });

  it('rejects malformed paths and provider responses', async () => {
    const malformed = new TelegramFileClient(
      'https://api.telegram.org', 'bot-token', 1000,
      vi.fn(async () => Response.json({ ok: true, result: { file_path: '../secret' } })) as typeof fetch
    );
    await expect(malformed.getFile('file-id')).rejects.toMatchObject({ code: 'provider' });

    const failed = new TelegramFileClient(
      'https://api.telegram.org', 'bot-token', 1000,
      vi.fn(async () => Response.json({ ok: false }, { status: 500 })) as typeof fetch
    );
    await expect(failed.getFile('file-id')).rejects.toMatchObject({ code: 'provider' });
  });

  it('downloads under the configured byte limit and rejects oversized content', async () => {
    let requestedUrl: URL | undefined;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      requestedUrl = new URL(String(url));
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const client = new TelegramFileClient('https://api.telegram.org', 'bot-token', 1000, fetcher as typeof fetch);
    await expect(client.download('voice/file.oga', 3)).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(client.download('voice/file.oga', 2)).rejects.toMatchObject({ code: 'validation' });
    expect(requestedUrl?.pathname).toBe('/file/botbot-token/voice/file.oga');
  });

  it('rejects oversized content-length without reading the body', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array([1])); }
    });
    const fetcher = vi.fn(async () => new Response(body, { headers: { 'content-length': '9' } }));
    const client = new TelegramFileClient('https://api.telegram.org', 'bot-token', 1000, fetcher as typeof fetch);
    await expect(client.download('voice/file.oga', 8)).rejects.toMatchObject({ code: 'validation' });
  });

  it('maps network errors to safe provider errors', async () => {
    const client = new TelegramFileClient(
      'https://api.telegram.org', 'bot-token', 1000,
      vi.fn(async () => { throw new Error('private URL with token'); }) as typeof fetch
    );
    await expect(client.getFile('file-id')).rejects.toMatchObject({ code: 'provider' });
  });
});
