import { describe, expect, it, jest } from '@jest/globals';
import { RetryExecutor } from './retry.executor';

const options = {
  maxAttempts: 2,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 2,
  timeoutMs: 100,
  jitterRatio: 0,
};

describe('RetryExecutor', () => {
  it('retries a transient operation and returns its result', async () => {
    const operation = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
      )
      .mockResolvedValueOnce('ok');

    await expect(
      new RetryExecutor().execute('operation', operation, options),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not exceed the configured total attempts', async () => {
    const error = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    const operation = jest.fn<() => Promise<string>>().mockRejectedValue(error);

    await expect(
      new RetryExecutor().execute('operation', operation, options),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
