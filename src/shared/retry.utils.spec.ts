import { describe, expect, it } from '@jest/globals';
import { TEXT_RETRY_CONFIG } from './retry.config';
import {
  calculateBackoffDelay,
  extractRetryAfterMs,
  formatDuration,
  getErrorMessage,
  isRateLimitError,
  isRetryableError,
} from './retry.utils';

describe('retry utilities', () => {
  it.each([429, 500, 502, 503, 504])(
    'classifies HTTP %i as retryable',
    (status) => {
      expect(isRetryableError({ status })).toBe(true);
    },
  );

  it.each([400, 401, 403, 404, 405, 422])(
    'classifies HTTP %i as permanent',
    (status) => {
      expect(isRetryableError({ status })).toBe(false);
    },
  );

  it.each([500, 502, 503, 504])(
    'classifies AWS SDK HTTP %i metadata as retryable',
    (httpStatusCode) => {
      expect(isRetryableError({ $metadata: { httpStatusCode } })).toBe(true);
    },
  );

  it.each([400, 401, 403, 404, 405, 422])(
    'classifies AWS SDK HTTP %i metadata as permanent',
    (httpStatusCode) => {
      expect(isRetryableError({ $metadata: { httpStatusCode } })).toBe(false);
    },
  );

  it('prioritizes permanent error messages', () => {
    expect(
      isRetryableError({ message: 'Bad Request after a network timeout' }),
    ).toBe(false);
  });

  it.each([
    [{ status: 429 }, true],
    [{ response: { status: 429 } }, true],
    [{ message: 'RESOURCE_EXHAUSTED' }, true],
    [{ message: 'Too Many Requests' }, true],
    [{ status: 503, message: 'Service Unavailable' }, false],
  ] as const)('classifies rate limit errors', (error, expected) => {
    expect(isRateLimitError(error)).toBe(expected);
  });

  it('extracts Retry-After seconds and HTTP dates case-insensitively', () => {
    const now = Date.parse('2026-08-08T00:00:00.000Z');

    expect(
      extractRetryAfterMs({ headers: { 'Retry-After': '2.5' } }, now),
    ).toBe(2_500);
    expect(
      extractRetryAfterMs(
        {
          response: {
            headers: { 'retry-after': 'Sat, 08 Aug 2026 00:00:04 GMT' },
          },
        },
        now,
      ),
    ).toBe(4_000);
  });

  it('extracts millisecond and Google RetryInfo hints', () => {
    const error = Object.assign(
      new Error(
        JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                retryDelay: '3.25s',
              },
            ],
          },
        }),
      ),
      { response: { headers: { 'retry-after-ms': '1200' } } },
    );

    expect(extractRetryAfterMs(error)).toBe(3_250);
  });

  it('ignores malformed or negative retry hints', () => {
    expect(
      extractRetryAfterMs({
        retryAfterMs: -1,
        retryDelay: 'tomorrow',
        headers: { 'retry-after': 'invalid' },
      }),
    ).toBeUndefined();
  });

  it('calculates capped exponential backoff without jitter', () => {
    const config = { ...TEXT_RETRY_CONFIG, enableJitter: false };

    expect(calculateBackoffDelay(0, config)).toBe(500);
    expect(calculateBackoffDelay(2, config)).toBe(2_000);
    expect(calculateBackoffDelay(20, config)).toBe(config.maxDelayMs);
  });

  it.each([
    [500, '500ms'],
    [1_500, '1.5s'],
    [65_000, '1m 5s'],
  ])('formats %i milliseconds as %s', (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it('extracts messages from Error instances', () => {
    expect(getErrorMessage(new Error('failed'))).toBe('failed');
  });
});
