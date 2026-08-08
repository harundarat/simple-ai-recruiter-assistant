import { Injectable, Logger } from '@nestjs/common';
import {
  calculateRetryDelay,
  formatDuration,
  isRateLimitError,
  isRetryableError,
  sleep,
} from './retry.utils';
import { RateLimitCoordinator } from './rate-limit.coordinator';

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  timeoutMs: number;
  jitterRatio: number;
}

export interface RetryExecutionOptions extends RetryOptions {
  shouldRetry?: (error: unknown) => boolean;
  rateLimitKey?: string;
}

@Injectable()
export class RetryExecutor {
  private readonly logger = new Logger(RetryExecutor.name);

  constructor(
    private readonly rateLimitCoordinator: RateLimitCoordinator = new RateLimitCoordinator(),
  ) {}

  async execute<T>(
    operationName: string,
    operation: () => Promise<T>,
    options: RetryExecutionOptions,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
      if (options.rateLimitKey) {
        await this.rateLimitCoordinator.wait(options.rateLimitKey);
      }

      try {
        const result = await this.withTimeout(operation(), options.timeoutMs);
        if (options.rateLimitKey) {
          this.rateLimitCoordinator.recordSuccess(options.rateLimitKey);
        }
        return result;
      } catch (error: unknown) {
        lastError = error;
        const rateLimitDecision =
          options.rateLimitKey && isRateLimitError(error)
            ? this.rateLimitCoordinator.recordRateLimit(
                options.rateLimitKey,
                error,
                attempt - 1,
                options,
              )
            : undefined;
        const retryable =
          options.shouldRetry?.(error) ?? isRetryableError(error);
        if (!retryable || attempt === options.maxAttempts) {
          throw error;
        }

        const delayMs =
          rateLimitDecision?.delayMs ??
          calculateRetryDelay(attempt - 1, options);
        this.logger.warn(
          {
            event: 'retry.scheduled',
            operation: operationName,
            attempt,
            maxAttempts: options.maxAttempts,
            delayMs,
            providerDelayMs: rateLimitDecision?.providerDelayMs,
            err: error,
          },
          'Operation failed; scheduling retry',
        );
        if (!rateLimitDecision) {
          await sleep(delayMs);
        }
      }
    }

    throw lastError;
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          Object.assign(
            new Error(`Operation timed out after ${formatDuration(timeoutMs)}`),
            { code: 'ETIMEDOUT' },
          ),
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
