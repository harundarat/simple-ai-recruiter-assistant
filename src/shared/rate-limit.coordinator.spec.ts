import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import { RateLimitCoordinator } from './rate-limit.coordinator';

const options = {
  maxAttempts: 2,
  initialDelayMs: 100,
  maxDelayMs: 1_000,
  backoffMultiplier: 2,
  timeoutMs: 1_000,
  jitterRatio: 0,
};

function rateLimitError(retryDelay?: string): Error {
  return Object.assign(
    new Error(
      JSON.stringify({
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          details: retryDelay ? [{ retryDelay }] : [],
        },
      }),
    ),
    { status: 429 },
  );
}

describe('RateLimitCoordinator', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-08-08T00:00:00.000Z') });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('uses the provider hint as the minimum cooldown', () => {
    const decision = new RateLimitCoordinator().recordRateLimit(
      'gemini:model',
      rateLimitError('0.75s'),
      0,
      options,
    );

    expect(decision).toEqual({
      delayMs: 750,
      providerDelayMs: 750,
      consecutiveRateLimits: 1,
    });
  });

  it('escalates consecutive rate limits and caps the delay', () => {
    const coordinator = new RateLimitCoordinator();
    const cappedOptions = { ...options, maxDelayMs: 250 };

    expect(
      coordinator.recordRateLimit(
        'gemini:model',
        rateLimitError(),
        0,
        cappedOptions,
      ).delayMs,
    ).toBe(100);
    expect(
      coordinator.recordRateLimit(
        'gemini:model',
        rateLimitError(),
        0,
        cappedOptions,
      ).delayMs,
    ).toBe(200);
    expect(
      coordinator.recordRateLimit(
        'gemini:model',
        rateLimitError(),
        0,
        cappedOptions,
      ).delayMs,
    ).toBe(250);
  });

  it('shares cooldown by key while leaving other models available', async () => {
    const coordinator = new RateLimitCoordinator();
    coordinator.recordRateLimit(
      'gemini:flash-lite',
      rateLimitError(),
      0,
      options,
    );

    await expect(coordinator.wait('gemini:flash')).resolves.toBeUndefined();
    const sharedWait = coordinator.wait('gemini:flash-lite');
    let resolved = false;
    void sharedWait.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    await jest.advanceTimersByTimeAsync(100);
    await expect(sharedWait).resolves.toBeUndefined();
  });

  it('resets escalation after a successful post-cooldown request', async () => {
    const coordinator = new RateLimitCoordinator();
    coordinator.recordRateLimit('gemini:model', rateLimitError(), 0, options);
    const wait = coordinator.wait('gemini:model');
    await jest.advanceTimersByTimeAsync(100);
    await wait;
    coordinator.recordSuccess('gemini:model');

    expect(
      coordinator.recordRateLimit('gemini:model', rateLimitError(), 0, options)
        .consecutiveRateLimits,
    ).toBe(1);
  });

  it('adds only upward jitter and keeps it bounded', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const decision = new RateLimitCoordinator().recordRateLimit(
      'gemini:model',
      rateLimitError('0.8s'),
      0,
      { ...options, jitterRatio: 0.5 },
    );

    expect(decision.delayMs).toBe(1_000);
    expect(decision.delayMs).toBeGreaterThanOrEqual(800);
  });
});
