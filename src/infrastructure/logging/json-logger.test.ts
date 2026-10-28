import { describe, expect, it, vi } from 'vitest';
import { JsonLogger } from './json-logger.js';

describe('JsonLogger', () => {
  it('writes structured records at or above the configured level', () => {
    const output = vi.fn();
    const error = vi.fn();
    const logger = new JsonLogger('info', output, error);

    logger.log('debug', 'test.ignored');
    logger.log('info', 'test.started', { attempt: 1 });
    logger.log('warn', 'test.warning');

    expect(output).toHaveBeenCalledOnce();
    expect(JSON.parse(output.mock.calls[0]?.[0] ?? '{}')).toMatchObject({ level: 'info', event: 'test.started', attempt: 1 });
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.parse(error.mock.calls[0]?.[0] ?? '{}')).toMatchObject({ level: 'warn', event: 'test.warning' });
  });
});
