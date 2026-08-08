import { Injectable, Logger } from '@nestjs/common';
import type { RetryOptions } from './retry.executor';
import { extractRetryAfterMs, sleep } from './retry.utils';

interface RateLimitState {
  consecutiveRateLimits: number;
  cooldownUntil: number;
}

export interface RateLimitDecision {
  delayMs: number;
  providerDelayMs?: number;
  consecutiveRateLimits: number;
}

@Injectable()
export class RateLimitCoordinator {
  private readonly logger = new Logger(RateLimitCoordinator.name);
  private readonly states = new Map<string, RateLimitState>();

  async wait(key: string): Promise<void> {
    while (true) {
      const state = this.states.get(key);
      const remainingMs = Math.max(0, (state?.cooldownUntil ?? 0) - Date.now());
      if (remainingMs === 0) {
        return;
      }

      this.logger.warn(
        {
          event: 'rate_limit.cooldown_wait',
          rateLimitKey: key,
          delayMs: remainingMs,
        },
        'Waiting for shared rate limit cooldown',
      );
      await sleep(remainingMs);
    }
  }

  recordRateLimit(
    key: string,
    error: unknown,
    attemptNumber: number,
    options: RetryOptions,
  ): RateLimitDecision {
    const now = Date.now();
    const previous = this.states.get(key);
    const consecutiveRateLimits = (previous?.consecutiveRateLimits ?? 0) + 1;
    const exponent = Math.max(attemptNumber, consecutiveRateLimits - 1);
    const exponentialDelay = Math.min(
      options.initialDelayMs * options.backoffMultiplier ** exponent,
      options.maxDelayMs,
    );
    const providerDelayMs = extractRetryAfterMs(error, now);
    const minimumDelay = Math.max(exponentialDelay, providerDelayMs ?? 0);
    const jitteredDelay =
      options.jitterRatio === 0
        ? minimumDelay
        : minimumDelay + Math.random() * minimumDelay * options.jitterRatio;
    const boundedDelay = Math.max(
      0,
      Math.min(Math.floor(jitteredDelay), options.maxDelayMs),
    );
    const cooldownUntil = Math.max(
      previous?.cooldownUntil ?? 0,
      now + boundedDelay,
    );

    this.states.set(key, { consecutiveRateLimits, cooldownUntil });
    return {
      delayMs: Math.max(0, cooldownUntil - now),
      providerDelayMs,
      consecutiveRateLimits,
    };
  }

  recordSuccess(key: string): void {
    const state = this.states.get(key);
    if (state && Date.now() >= state.cooldownUntil) {
      this.states.delete(key);
    }
  }
}
