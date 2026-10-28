import { z } from 'zod';
import { AppError } from '../../domain/errors.js';
import type { Logger } from '../../service/logger.js';

const fileResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    file_path: z.string().min(1),
    file_size: z.number().int().positive().optional()
  })
});

export interface TelegramFileInfo {
  filePath: string;
  fileSize?: number;
}

export class TelegramFileClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly botToken: string,
    private readonly timeoutMs: number,
    private readonly fetcher: typeof fetch = fetch,
    private readonly logger?: Logger
  ) {}

  async getFile(fileId: string): Promise<TelegramFileInfo> {
    const url = new URL(`/bot${this.botToken}/getFile`, this.apiBaseUrl);
    url.searchParams.set('file_id', fileId);
    let response: Response;
    try {
      response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      this.logger?.log('error', 'telegram.file_lookup.failed', { failure: 'network_or_timeout' });
      throw new AppError('provider');
    }
    if (!response.ok) {
      this.logger?.log('error', 'telegram.file_lookup.failed', { httpStatus: response.status });
      throw new AppError('provider');
    }

    let parsed: z.infer<typeof fileResponseSchema>;
    try {
      parsed = fileResponseSchema.parse(await response.json());
    } catch {
      this.logger?.log('error', 'telegram.file_lookup.failed', { outcome: 'invalid_response' });
      throw new AppError('provider');
    }
    if (!isSafeFilePath(parsed.result.file_path)) {
      this.logger?.log('error', 'telegram.file_lookup.failed', { outcome: 'invalid_file_path' });
      throw new AppError('provider');
    }
    this.logger?.log('debug', 'telegram.file_lookup.completed', { hasFileSize: parsed.result.file_size !== undefined });
    return {
      filePath: parsed.result.file_path,
      ...(parsed.result.file_size === undefined ? {} : { fileSize: parsed.result.file_size })
    };
  }

  async download(filePath: string, maxBytes: number): Promise<Buffer> {
    if (!isSafeFilePath(filePath)) throw new AppError('provider');
    let response: Response;
    try {
      response = await this.fetcher(this.fileUrl(filePath), {
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      this.logger?.log('error', 'telegram.file_download.failed', { failure: 'network_or_timeout' });
      throw new AppError('provider');
    }
    if (!response.ok || !response.body) {
      this.logger?.log('error', 'telegram.file_download.failed', { httpStatus: response.status });
      throw new AppError('provider');
    }

    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      await response.body.cancel();
      throw new AppError('validation');
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new AppError('validation');
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger?.log('error', 'telegram.file_download.failed', { failure: 'stream_error' });
      throw new AppError('provider');
    }
    this.logger?.log('info', 'telegram.file_download.completed', { byteCount: totalBytes });
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }

  private fileUrl(filePath: string): URL {
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    return new URL(`/file/bot${this.botToken}/${encodedPath}`, this.apiBaseUrl);
  }
}

const isSafeFilePath = (filePath: string): boolean =>
  filePath.length <= 512 &&
  !filePath.startsWith('/') &&
  !filePath.includes('\\') &&
  filePath.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..' && /^[A-Za-z0-9_.-]+$/.test(part));
