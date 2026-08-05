import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Retry } from './retry.decorator';

const retryConfig = {
  maxRetries: 2,
  initialDelayMs: 10,
  maxDelayMs: 20,
  backoffMultiplier: 2,
  timeoutMs: 100,
  enableJitter: false,
};

class RetrySubject {
  attempts = 0;

  @Retry(retryConfig)
  async transientFailure(): Promise<string> {
    await Promise.resolve();
    this.attempts += 1;
    if (this.attempts < 3) {
      throw Object.assign(new Error('network timeout'), {
        code: 'ETIMEDOUT',
      });
    }
    return 'recovered';
  }

  @Retry(retryConfig)
  async permanentFailure(): Promise<never> {
    await Promise.resolve();
    this.attempts += 1;
    throw new Error('Invalid API key');
  }

  @Retry({ ...retryConfig, maxRetries: 1, timeoutMs: 50 })
  async hangs(): Promise<never> {
    this.attempts += 1;
    return new Promise(() => undefined);
  }
}

describe('@Retry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries transient failures with backoff', async () => {
    const subject = new RetrySubject();
    const result = expect(subject.transientFailure()).resolves.toBe(
      'recovered',
    );

    await jest.runAllTimersAsync();
    await result;

    expect(subject.attempts).toBe(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not retry permanent failures', async () => {
    const subject = new RetrySubject();

    await expect(subject.permanentFailure()).rejects.toThrow('Invalid API key');
    expect(subject.attempts).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects calls that exceed the configured timeout', async () => {
    const subject = new RetrySubject();
    const result = expect(subject.hangs()).rejects.toThrow(
      'Operation timed out after 50ms',
    );

    await jest.runAllTimersAsync();
    await result;

    expect(subject.attempts).toBe(2);
    expect(jest.getTimerCount()).toBe(0);
  });
});
