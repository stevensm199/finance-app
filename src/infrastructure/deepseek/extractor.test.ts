import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../domain/errors.js';
import { DeepSeekExtractor } from './extractor.js';

const setup = (response: Response) => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response.clone());
  const extractor = new DeepSeekExtractor({
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'private-api-key',
    model: 'configured-model',
    timeoutMs: 1000,
    prompt: 'configured extraction prompt',
    fetcher: fetcher as unknown as typeof fetch
  });
  return { extractor, fetcher };
};

describe('DeepSeekExtractor', () => {
  it('uses the configured model, prompt, key, and user message', async () => {
    const { extractor, fetcher } = setup(Response.json({ choices: [{ message: { content: '{"ok":true,"type":"expense","amount":"120000"}' } }] }));
    await expect(extractor.extract('gasté 120000 en Netflix')).resolves.toEqual({ ok: true, type: 'expense', amount: '120000' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe('/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer private-api-key');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'configured-model',
      messages: [
        { role: 'system', content: 'configured extraction prompt' },
        { role: 'user', content: 'gasté 120000 en Netflix' }
      ]
    });
  });

  it('maps provider and network failures while returning malformed model content for domain validation', async () => {
    const { extractor: failed } = setup(new Response('private provider error', { status: 500 }));
    await expect(failed.extract('text')).rejects.toMatchObject({ code: 'provider' });
    const { extractor: invalid } = setup(Response.json({ choices: [{ message: { content: 'not-json' } }] }));
    await expect(invalid.extract('text')).resolves.toBe('not-json');
    const network = new DeepSeekExtractor({
      baseUrl: 'https://api.deepseek.com', apiKey: 'private-api-key', model: 'configured-model', timeoutMs: 1000,
      prompt: 'configured prompt', fetcher: vi.fn(async () => { throw new Error('private network error'); }) as unknown as typeof fetch
    });
    await expect(network.extract('text')).rejects.toBeInstanceOf(AppError);
  });
});
