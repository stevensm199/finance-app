export type ErrorCode = 'validation' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'provider' | 'persistence';

export class AppError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}
