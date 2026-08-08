import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CircuitBreakerExecutor,
  CircuitOpenError,
} from './circuit-breaker.executor';

function createExecutor(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    CIRCUIT_BREAKER_ENABLED: true,
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
    CIRCUIT_BREAKER_RESET_TIMEOUT_MS: 30_000,
    ...overrides,
  };
  return new CircuitBreakerExecutor({
    get: jest.fn((name: string) => values[name]),
  } as unknown as ConfigService);
}

function transientFailure() {
  return Object.assign(new Error('temporary upstream failure'), {
    status: 503,
  });
}

function rateLimitFailure() {
  return Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 });
}

describe('CircuitBreakerExecutor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('opens after three transient failures and rejects the fourth call', async () => {
    const executor = createExecutor();
    const operation = jest
      .fn<() => Promise<string>>()
      .mockRejectedValue(transientFailure());

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        executor.execute('gemini', 'generate', operation),
      ).rejects.toThrow('temporary upstream failure');
    }

    await expect(
      executor.execute('gemini', 'generate', operation),
    ).rejects.toMatchObject({
      name: 'CircuitOpenError',
      service: 'gemini',
      operationName: 'generate',
      circuitState: 'open',
    });
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('uses one successful half-open probe to close the circuit', async () => {
    const executor = createExecutor();
    const operation = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(transientFailure())
      .mockRejectedValueOnce(transientFailure())
      .mockRejectedValueOnce(transientFailure())
      .mockResolvedValue('recovered');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        executor.execute('chroma', 'query', operation),
      ).rejects.toThrow();
    }
    jest.advanceTimersByTime(30_000);

    await expect(executor.execute('chroma', 'query', operation)).resolves.toBe(
      'recovered',
    );
    await expect(executor.execute('chroma', 'query', operation)).resolves.toBe(
      'recovered',
    );
    expect(operation).toHaveBeenCalledTimes(5);
  });

  it('reopens after a failed half-open probe', async () => {
    const executor = createExecutor();
    const operation = jest
      .fn<() => Promise<string>>()
      .mockRejectedValue(transientFailure());

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        executor.execute('s3', 'get-object', operation),
      ).rejects.toThrow();
    }
    jest.advanceTimersByTime(30_000);
    await expect(
      executor.execute('s3', 'get-object', operation),
    ).rejects.toThrow('temporary upstream failure');

    await expect(
      executor.execute('s3', 'get-object', operation),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(operation).toHaveBeenCalledTimes(4);
  });

  it('does not count permanent errors toward the threshold', async () => {
    const executor = createExecutor();
    const operation = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(transientFailure())
      .mockRejectedValueOnce({ status: 400 })
      .mockRejectedValueOnce(transientFailure())
      .mockResolvedValue('ok');

    await expect(
      executor.execute('redis', 'enqueue', operation),
    ).rejects.toThrow();
    await expect(
      executor.execute('redis', 'enqueue', operation),
    ).rejects.toEqual({
      status: 400,
    });
    await expect(
      executor.execute('redis', 'enqueue', operation),
    ).rejects.toThrow();
    await expect(executor.execute('redis', 'enqueue', operation)).resolves.toBe(
      'ok',
    );
    expect(operation).toHaveBeenCalledTimes(4);
  });

  it('does not count rate limits toward the circuit threshold', async () => {
    const executor = createExecutor();
    const operation = jest
      .fn<() => Promise<string>>()
      .mockRejectedValue(rateLimitFailure());

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        executor.execute('gemini', 'generate', operation),
      ).rejects.toThrow('RESOURCE_EXHAUSTED');
    }
    expect(operation).toHaveBeenCalledTimes(4);
  });

  it('keeps circuit state isolated by external service', async () => {
    const executor = createExecutor();
    const failing = jest
      .fn<() => Promise<string>>()
      .mockRejectedValue(transientFailure());
    const healthy = jest.fn<() => Promise<string>>().mockResolvedValue('ok');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        executor.execute('gemini', 'generate', failing),
      ).rejects.toThrow();
    }

    await expect(executor.execute('chroma', 'query', healthy)).resolves.toBe(
      'ok',
    );
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('bypasses policies when the kill switch is disabled', async () => {
    const executor = createExecutor({ CIRCUIT_BREAKER_ENABLED: false });
    const operation = jest
      .fn<() => Promise<string>>()
      .mockRejectedValue(transientFailure());

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        executor.execute('gemini', 'generate', operation),
      ).rejects.toThrow('temporary upstream failure');
    }
    expect(operation).toHaveBeenCalledTimes(4);
  });
});
