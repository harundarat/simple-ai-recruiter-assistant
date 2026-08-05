import { Logger } from '@nestjs/common';
import { DEFAULT_RETRY_CONFIG, RetryConfig } from './retry.config';
import {
  calculateBackoffDelay,
  createErrorContext,
  formatDuration,
  getErrorMessage,
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
        new Error(`Operation timed out after ${formatDuration(timeoutMs)}`),
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
              `Retry attempt ${attempt}/${config.maxRetries} for ${methodName}`,
            );
          }

          const operation = originalMethod.apply(this, args) as ReturnType<T>;
          const result = await withTimeout(operation, config.timeoutMs);

          if (attempt > 0) {
            logger.log(
              `${methodName} succeeded after ${attempt} retry attempt(s)`,
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
              shouldRetry
                ? `${methodName} failed after ${config.maxRetries + 1} attempts`
                : `${methodName} failed with a non-retryable error`,
              {
                error: getErrorMessage(error),
                statusCode: errorContext.statusCode,
                errorCode: errorContext.errorCode,
              },
            );
            throw error;
          }

          const delayMs = calculateBackoffDelay(attempt, config);
          logger.warn(
            `${methodName} failed (attempt ${attempt + 1}/${config.maxRetries + 1}); retrying after ${formatDuration(delayMs)}`,
            {
              error: getErrorMessage(error),
              nextRetryIn: formatDuration(delayMs),
              retriesRemaining: config.maxRetries - attempt,
            },
          );
          await sleep(delayMs);
        }
      }

      throw lastError;
    } as T;
  };
}
