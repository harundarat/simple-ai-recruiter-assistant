import { describe, expect, it } from '@jest/globals';
import { TEXT_RETRY_CONFIG } from './retry.config';
import {
  calculateBackoffDelay,
  formatDuration,
  getErrorMessage,
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

  it('prioritizes permanent error messages', () => {
    expect(
      isRetryableError({ message: 'Bad Request after a network timeout' }),
    ).toBe(false);
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
