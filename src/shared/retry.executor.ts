import { Injectable, Logger } from '@nestjs/common';
import {
  calculateRetryDelay,
  formatDuration,
  getErrorMessage,
  isRetryableError,
  sleep,
} from './retry.utils';

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
}

@Injectable()
export class RetryExecutor {
  private readonly logger = new Logger(RetryExecutor.name);

  async execute<T>(
    operationName: string,
    operation: () => Promise<T>,
    options: RetryExecutionOptions,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
      try {
        return await this.withTimeout(operation(), options.timeoutMs);
      } catch (error: unknown) {
        lastError = error;
        const retryable =
          options.shouldRetry?.(error) ?? isRetryableError(error);
        if (!retryable || attempt === options.maxAttempts) {
          throw error;
        }

        const delayMs = calculateRetryDelay(attempt - 1, options);
        this.logger.warn(
          `${operationName} failed (attempt ${attempt}/${options.maxAttempts}); retrying after ${formatDuration(delayMs)}`,
          { error: getErrorMessage(error) },
        );
        await sleep(delayMs);
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
