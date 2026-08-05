import {
  NON_RETRYABLE_ERROR_PATTERNS,
  NON_RETRYABLE_HTTP_STATUS_CODES,
  RETRYABLE_ERROR_PATTERNS,
  RETRYABLE_HTTP_STATUS_CODES,
  RetryConfig,
} from './retry.config';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function getStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const directStatus = error.status ?? error.statusCode;
  if (typeof directStatus === 'number') {
    return directStatus;
  }

  const response = error.response;
  if (isRecord(response) && typeof response.status === 'number') {
    return response.status;
  }

  const metadata = error.$metadata;
  if (isRecord(metadata) && typeof metadata.httpStatusCode === 'number') {
    return metadata.httpStatusCode;
  }

  return undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

export function isRetryableError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  const statusCode = getStatusCode(error);
  if (statusCode !== undefined) {
    if (NON_RETRYABLE_HTTP_STATUS_CODES.includes(statusCode)) {
      return false;
    }

    if (RETRYABLE_HTTP_STATUS_CODES.includes(statusCode)) {
      return true;
    }
  }

  const errorMessage = getErrorMessage(error).toLowerCase();
  if (
    NON_RETRYABLE_ERROR_PATTERNS.some((pattern) =>
      errorMessage.includes(pattern.toLowerCase()),
    )
  ) {
    return false;
  }

  if (
    RETRYABLE_ERROR_PATTERNS.some((pattern) =>
      errorMessage.includes(pattern.toLowerCase()),
    )
  ) {
    return true;
  }

  const errorCode = getErrorCode(error);
  return (
    errorCode !== undefined &&
    [
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ECONNREFUSED',
      'ECONNRESET',
      'EPIPE',
      'ENOTFOUND',
      'EAI_AGAIN',
    ].includes(errorCode)
  );
}

export function calculateBackoffDelay(
  attemptNumber: number,
  config: RetryConfig,
): number {
  const exponentialDelay =
    config.initialDelayMs * config.backoffMultiplier ** attemptNumber;
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  if (config.enableJitter) {
    return Math.floor(cappedDelay * (0.5 + Math.random()));
  }

  return cappedDelay;
}

export function calculateRetryDelay(
  attemptNumber: number,
  config: {
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitterRatio: number;
  },
): number {
  const exponentialDelay = Math.min(
    config.initialDelayMs * config.backoffMultiplier ** attemptNumber,
    config.maxDelayMs,
  );
  if (config.jitterRatio === 0) {
    return exponentialDelay;
  }

  const variation = exponentialDelay * config.jitterRatio;
  return Math.max(
    0,
    Math.floor(exponentialDelay - variation + Math.random() * variation * 2),
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(seconds / 60);

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const remainingMs = ms % 1_000;
  return remainingMs > 0
    ? `${seconds}.${Math.floor(remainingMs / 100)}s`
    : `${seconds}s`;
}

export function getErrorMessage(error: unknown): string {
  if (isRecord(error)) {
    const response = error.response;
    if (isRecord(response)) {
      const data = response.data;
      if (isRecord(data) && typeof data.message === 'string') {
        return data.message;
      }
    }

    if (typeof error.message === 'string') {
      return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : String(error);
}

export function createErrorContext(
  error: unknown,
  attemptNumber: number,
  maxRetries: number,
) {
  return {
    message: getErrorMessage(error),
    statusCode: getStatusCode(error),
    errorCode: getErrorCode(error),
    attemptNumber: attemptNumber + 1,
    maxAttempts: maxRetries + 1,
    isRetryable: isRetryableError(error),
  };
}
