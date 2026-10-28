import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../domain/errors.js';
import { createTelegramWebhookHandler } from './webhook.js';

const secret = 'telegram-secret-token';
const update = {
  update_id: 123,
  message: { message_id: 50, from: { id: 42 }, chat: { id: 42 }, text: 'gasté 120.000 en Netflix' }
};

const invoke = async (handler: Function, suppliedSecret: string, body: unknown) => {
  const request = { get: (name: string) => name === 'x-telegram-bot-api-secret-token' ? suppliedSecret : undefined, body };
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; }
  };
  const next = vi.fn();
  await handler(request as Request, response as unknown as Response, next as NextFunction);
  return { response, next };
};

describe('Telegram webhook authentication and normalization', () => {
  it('accepts authenticated text messages and normalizes update fields', async () => {
    const processUpdate = vi.fn(async () => undefined);
    const result = await invoke(createTelegramWebhookHandler(secret, processUpdate), secret, update);
    expect(result.response.statusCode).toBe(200);
    expect(processUpdate).toHaveBeenCalledWith(update);
    expect(result.next).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated webhook requests before processing', async () => {
    const processUpdate = vi.fn(async () => undefined);
    const result = await invoke(createTelegramWebhookHandler(secret, processUpdate), 'wrong-secret', update);
    expect(result.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'unauthorized' }));
    expect(processUpdate).not.toHaveBeenCalled();
  });

  it('accepts authenticated unsupported updates without inventing a sender or text', async () => {
    const processUpdate = vi.fn(async () => undefined);
    const result = await invoke(createTelegramWebhookHandler(secret, processUpdate), secret, { update_id: 124, callback_query: { id: 'cb' } });
    expect(result.response.statusCode).toBe(200);
    expect(processUpdate).toHaveBeenCalledWith({ update_id: 124, callback_query: { id: 'cb' } });
  });

  it('forwards malformed updates and processing failures to the error handler', async () => {
    const processUpdate = vi.fn(async () => undefined);
    const malformed = await invoke(createTelegramWebhookHandler(secret, processUpdate), secret, { update_id: 'bad' });
    expect(malformed.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'validation' }));
    processUpdate.mockRejectedValue(new Error('processing failure'));
    const failed = await invoke(createTelegramWebhookHandler(secret, processUpdate), secret, update);
    expect(failed.next).toHaveBeenCalledWith(expect.objectContaining({ message: 'processing failure' }));
  });

  it('acknowledges audio only after durable processing acceptance', async () => {
    const accepted = await invoke(createTelegramWebhookHandler(secret, vi.fn(async () => undefined)), secret, {
      update_id: 130,
      message: { from: { id: 42 }, chat: { id: 42 }, voice: { file_id: 'file', duration: 8, file_size: 100 } }
    });
    expect(accepted.response.statusCode).toBe(200);

    const failed = await invoke(createTelegramWebhookHandler(secret, vi.fn(async () => { throw new AppError('persistence'); })), secret, {
      update_id: 131,
      message: { from: { id: 42 }, chat: { id: 42 }, voice: { file_id: 'file', duration: 8, file_size: 100 } }
    });
    expect(failed.response.statusCode).toBe(0);
    expect(failed.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'persistence' }));
  });
});
