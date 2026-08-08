import { describe, expect, it, jest } from '@jest/globals';
import { RetryExecutor } from './retry.executor';
import { RateLimitCoordinator } from './rate-limit.coordinator';

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

  it('preserves an exhausted rate-limit cooldown for the next call', async () => {
    jest.useFakeTimers();
    try {
      const coordinator = new RateLimitCoordinator();
      const executor = new RetryExecutor(coordinator);
      const rateLimit = Object.assign(new Error('Too Many Requests'), {
        status: 429,
      });
      const rejected = jest
        .fn<() => Promise<string>>()
        .mockRejectedValue(rateLimit);

      await expect(
        executor.execute('first', rejected, {
          ...options,
          maxAttempts: 1,
          initialDelayMs: 100,
          maxDelayMs: 100,
          rateLimitKey: 'gemini:model',
        }),
      ).rejects.toBe(rateLimit);

      const nextOperation = jest
        .fn<() => Promise<string>>()
        .mockResolvedValue('recovered');
      const nextCall = executor.execute('second', nextOperation, {
        ...options,
        maxAttempts: 1,
        initialDelayMs: 100,
        maxDelayMs: 100,
        rateLimitKey: 'gemini:model',
      });
      await Promise.resolve();
      expect(nextOperation).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(100);
      await expect(nextCall).resolves.toBe('recovered');
      expect(nextOperation).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
