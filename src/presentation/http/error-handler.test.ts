import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../domain/errors.js';
import { loadMessages } from '../../config/messages.js';
import { createErrorHandler } from './error-handler.js';

const messages = loadMessages('config/messages.es.json').httpErrors;

const response = () => {
  const result = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; }
  };
  return result;
};

const callHandler = (error: unknown) => {
  const res = response();
  createErrorHandler(messages)(error, {} as Request, res as unknown as Response, vi.fn() as NextFunction);
  return res;
};

describe('createErrorHandler', () => {
  it('maps application and validation errors to configured messages', () => {
    expect(callHandler(new AppError('unauthorized'))).toMatchObject({
      statusCode: 401,
      body: { error: 'unauthorized', message: messages.unauthorized }
    });
    let validationError: unknown;
    try { z.string().parse(1); } catch (error) { validationError = error; }
    expect(callHandler(validationError)).toMatchObject({
      statusCode: 400,
      body: { error: 'validation', message: messages.validation }
    });
  });

  it.each([
    ['not_found', 404],
    ['forbidden', 403],
    ['conflict', 409],
    ['provider', 502],
    ['persistence', 500]
  ] as const)('maps %s errors to status %i', (code, statusCode) => {
    expect(callHandler(new AppError(code))).toMatchObject({
      statusCode,
      body: { error: code, message: messages[code] }
    });
  });

  it('hides details from unknown internal errors', () => {
    const result = callHandler(new Error('secret detail'));
    expect(result.statusCode).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('secret detail');
  });
});
