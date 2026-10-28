import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../domain/errors.js';
import type { TelegramUserRepository } from '../../domain/telegram-user-repository.js';
import { createServiceAuthentication, createTelegramOwnerResolver } from './bot-auth.js';

const serviceToken = 't'.repeat(32);

const call = async (handler: Function, headers: Record<string, string>, users?: TelegramUserRepository, body?: unknown, query?: unknown) => {
  const request = { get: (name: string) => headers[name.toLowerCase()], body, query };
  const response = { locals: {} as Record<string, unknown> };
  const next = vi.fn();
  await handler(request as Request, response as Response, next as NextFunction);
  return { request, response, next };
};

describe('bot service authentication and Telegram owner resolution', () => {
  it('rejects missing and invalid service credentials without continuing', async () => {
    const auth = createServiceAuthentication(serviceToken);
    for (const authorization of ['', 'Bearer wrong']) {
      const { next } = await call(auth, { authorization });
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'unauthorized' } satisfies Partial<AppError>));
    }
  });

  it('accepts only the configured service credential', async () => {
    const { next } = await call(createServiceAuthentication(serviceToken), { authorization: `Bearer ${serviceToken}` });
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('derives the internal owner from the Telegram identity mapping only', async () => {
    const users = { findOwnerIdByTelegramUserId: vi.fn(async () => 'internal-user-uuid') } satisfies TelegramUserRepository;
    const { response, next } = await call(createTelegramOwnerResolver(users), {
      'x-telegram-user-id': '42'
    }, users, { owner_id: 'forged-body-owner' }, { owner_id: 'forged-query-owner' });
    expect(users.findOwnerIdByTelegramUserId).toHaveBeenCalledWith('42');
    expect(response.locals.ownerId).toBe('internal-user-uuid');
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects malformed sender IDs and IDs without a user association', async () => {
    const users = { findOwnerIdByTelegramUserId: vi.fn(async () => null) } satisfies TelegramUserRepository;
    const resolver = createTelegramOwnerResolver(users);
    const missing = await call(resolver, {}, users);
    const unassociated = await call(resolver, { 'x-telegram-user-id': '42' }, users);
    expect(missing.next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ZodError' }));
    expect(unassociated.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'forbidden' }));
  });

  it('propagates user-association database failures', async () => {
    const users = { findOwnerIdByTelegramUserId: vi.fn(async () => { throw new AppError('persistence'); }) } satisfies TelegramUserRepository;
    const { next } = await call(createTelegramOwnerResolver(users), { 'x-telegram-user-id': '42' }, users);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'persistence' }));
  });
});
