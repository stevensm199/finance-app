import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { TransactionRepository } from '../../domain/transaction-repository.js';
import { createTransactionController } from './transaction-controller.js';

const saved = {
  id: '6b7f23e0-07ba-4d02-9b8e-55af619ad001',
  ownerId: 'telegram:42',
  type: 'expense' as const,
  description: 'Netflix',
  amount: '120000',
  registeredAt: '2026-10-28T00:00:00.000Z'
};

const setup = () => {
  const repository = {
    create: vi.fn(async () => saved),
    update: vi.fn(async () => saved),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [saved], page: 1, pageSize: 20, total: 1 }))
  } satisfies TransactionRepository;
  const response = {
    locals: { ownerId: 'telegram:42' },
    status: vi.fn(function (this: unknown) { return this; }),
    json: vi.fn(function (this: unknown) { return this; })
  };
  const request = { params: { id: saved.id }, body: { type: 'expense', amount: '120000' }, query: {}, get: (name: string) => name === 'idempotency-key' ? '123' : undefined };
  const next = vi.fn();
  const controller = createTransactionController(repository, { defaultPageSize: 20, maxPageSize: 100 });
  return { repository, response, request, next, controller };
};

const invoke = async (handler: Function, request: unknown, response: unknown, next: NextFunction) =>
  handler(request as Request, response as Response, next);

describe('transaction controllers', () => {
  it('creates, edits, deletes, and lists using the authenticated owner', async () => {
    const { repository, response, request, next, controller } = setup();
    await invoke(controller.create, request, response, next);
    await invoke(controller.update, request, response, next);
    await invoke(controller.delete, request, response, next);
    await invoke(controller.list, request, response, next);
    expect(repository.create).toHaveBeenCalledWith('telegram:42', { ...request.body, description: 'expense' }, 123);
    expect(repository.update).toHaveBeenCalledWith('telegram:42', saved.id, request.body);
    expect(repository.delete).toHaveBeenCalledWith('telegram:42', saved.id);
    expect(repository.list).toHaveBeenCalledWith('telegram:42', 1, 20);
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({ deleted: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards validation and repository failures from every route to the central error handler', async () => {
    const { repository, response, request, next, controller } = setup();
    repository.delete.mockRejectedValue(new Error('database unavailable'));
    await invoke(controller.create, { ...request, body: { amount: '0' } }, response, next as NextFunction);
    await invoke(controller.update, { ...request, params: { id: 'invalid' } }, response, next as NextFunction);
    await invoke(controller.delete, request, response, next as NextFunction);
    await invoke(controller.list, { ...request, query: { page: '0' } }, response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(4);

    next.mockClear();
    repository.create.mockRejectedValue(new Error('database unavailable'));
    repository.update.mockRejectedValue(new Error('database unavailable'));
    repository.delete.mockRejectedValue(new Error('database unavailable'));
    repository.list.mockRejectedValue(new Error('database unavailable'));
    await invoke(controller.create, request, response, next as NextFunction);
    await invoke(controller.update, request, response, next as NextFunction);
    await invoke(controller.delete, request, response, next as NextFunction);
    await invoke(controller.list, request, response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(4);
  });
});
