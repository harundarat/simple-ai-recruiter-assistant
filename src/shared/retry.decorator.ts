import { Logger } from '@nestjs/common';
import { DEFAULT_RETRY_CONFIG, RetryConfig } from './retry.config';
import {
  calculateBackoffDelay,
  createErrorContext,
  formatDuration,
  isRetryableError,
  sleep,
} from './retry.utils';

type AsyncMethod = (...args: never[]) => Promise<unknown>;

async function withTimeout<T>(
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

export function Retry(config: RetryConfig = DEFAULT_RETRY_CONFIG) {
  return function <T extends AsyncMethod>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ): void {
    const originalMethod = descriptor.value;
    if (!originalMethod) {
      throw new Error('@Retry can only decorate a method');
    }

    const methodName = String(propertyKey);
    const logger = new Logger(`${target.constructor.name}.${methodName}`);

    descriptor.value = async function (
      this: unknown,
      ...args: Parameters<T>
    ): Promise<Awaited<ReturnType<T>>> {
      let lastError: unknown;

      for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            logger.log(
              {
                event: 'retry.attempt_started',
                operation: methodName,
                retryAttempt: attempt,
                maxRetries: config.maxRetries,
              },
              'Retry attempt started',
            );
          }

          const operation = originalMethod.apply(this, args) as ReturnType<T>;
          const result = await withTimeout(operation, config.timeoutMs);

          if (attempt > 0) {
            logger.log(
              {
                event: 'retry.succeeded',
                operation: methodName,
                retryAttempts: attempt,
              },
              'Operation succeeded after retry',
            );
          }

          return result as Awaited<ReturnType<T>>;
        } catch (error: unknown) {
          lastError = error;
          const errorContext = createErrorContext(
            error,
            attempt,
            config.maxRetries,
          );
          const isLastAttempt = attempt === config.maxRetries;
          const shouldRetry = isRetryableError(error);

          if (isLastAttempt || !shouldRetry) {
            logger.error(
              {
                event: 'retry.exhausted',
                operation: methodName,
                attempts: attempt + 1,
                retryable: shouldRetry,
                statusCode: errorContext.statusCode,
                errorCode: errorContext.errorCode,
                err: error,
              },
              shouldRetry
                ? 'Operation failed after all retry attempts'
                : 'Operation failed with a non-retryable error',
            );
            throw error;
          }

          const delayMs = calculateBackoffDelay(attempt, config);
          logger.warn(
            {
              event: 'retry.scheduled',
              operation: methodName,
              attempt: attempt + 1,
              maxAttempts: config.maxRetries + 1,
              delayMs,
              retriesRemaining: config.maxRetries - attempt,
              err: error,
            },
            'Operation failed; scheduling retry',
          );
          await sleep(delayMs);
        }
      }

      throw lastError;
    } as T;
  };
}
