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

function getHeaderValue(headers: unknown, name: string): unknown {
  if (!isRecord(headers)) {
    return undefined;
  }

  if (typeof headers.get === 'function') {
    try {
      return (headers.get as (headerName: string) => unknown)(name);
    } catch {
      return undefined;
    }
  }

  const matchingEntry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name.toLowerCase(),
  );
  return matchingEntry?.[1];
}

function parseNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseRetryAfter(value: unknown, nowMs: number): number | undefined {
  const seconds = parseNonNegativeNumber(value);
  if (seconds !== undefined) {
    return Math.round(seconds * 1_000);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

function parseProtobufDuration(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!match) {
    return undefined;
  }

  return Math.round(Number(match[1]) * 1_000);
}

function collectRetryHints(
  value: unknown,
  nowMs: number,
  hints: number[],
  depth = 0,
): void {
  if (depth > 8 || !isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    let hint: number | undefined;

    if (
      normalizedKey === 'retryafterms' ||
      normalizedKey === 'retry-after-ms'
    ) {
      hint = parseNonNegativeNumber(nestedValue);
    } else if (
      normalizedKey === 'retryafter' ||
      normalizedKey === 'retry-after'
    ) {
      hint = parseRetryAfter(nestedValue, nowMs);
    } else if (normalizedKey === 'retrydelay') {
      hint = parseProtobufDuration(nestedValue);
    }

    if (hint !== undefined) {
      hints.push(Math.round(hint));
    }

    if (Array.isArray(nestedValue)) {
      for (const item of nestedValue) {
        collectRetryHints(item, nowMs, hints, depth + 1);
      }
    } else {
      collectRetryHints(nestedValue, nowMs, hints, depth + 1);
    }
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function isRateLimitError(error: unknown): boolean {
  if (getStatusCode(error) === 429) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('resource_exhausted') ||
    message.includes('too many requests') ||
    message.includes('rate limit')
  );
}

export function extractRetryAfterMs(
  error: unknown,
  nowMs = Date.now(),
): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const hints: number[] = [];
  const response = isRecord(error.response) ? error.response : undefined;
  const headerSources = [error.headers, response?.headers];

  for (const headers of headerSources) {
    const retryAfterMs = parseNonNegativeNumber(
      getHeaderValue(headers, 'retry-after-ms'),
    );
    if (retryAfterMs !== undefined) {
      hints.push(Math.round(retryAfterMs));
    }

    const retryAfter = parseRetryAfter(
      getHeaderValue(headers, 'retry-after'),
      nowMs,
    );
    if (retryAfter !== undefined) {
      hints.push(retryAfter);
    }
  }

  collectRetryHints(error, nowMs, hints);
  collectRetryHints(parseJson(error.message), nowMs, hints);
  collectRetryHints(parseJson(response?.data), nowMs, hints);

  return hints.length > 0 ? Math.max(...hints) : undefined;
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
