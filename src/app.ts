import express from 'express';
import type { Router } from 'express';
import type { Messages } from './config/messages.js';
import { createErrorHandler } from './presentation/http/error-handler.js';
import type { Logger } from './service/logger.js';

interface AppOptions {
  transactionRouter: Router;
  httpErrors: Messages['httpErrors'];
  telegramRouter?: Router;
  logger?: Logger;
}

export const createApp = ({ transactionRouter, httpErrors, telegramRouter, logger }: AppOptions) => {
  const app = express();
  app.use(express.json());
  if (telegramRouter) app.use('/webhooks/telegram', telegramRouter);
  app.use('/api/transactions', transactionRouter);
  app.use(createErrorHandler(httpErrors, logger));
  return app;
};
