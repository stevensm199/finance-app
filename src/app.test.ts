import { describe, expect, it } from 'vitest';
import { Router } from 'express';
import { createApp } from './app.js';
import { loadMessages } from './config/messages.js';

describe('createApp', () => {
  it('creates an Express application', () => {
    expect(typeof createApp({ transactionRouter: Router(), httpErrors: loadMessages('config/messages.es.json').httpErrors }).listen).toBe('function');
  });
});
