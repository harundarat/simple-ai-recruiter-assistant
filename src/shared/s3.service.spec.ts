import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { S3Service } from './s3.service';
import {
  CircuitBreakerExecutor,
  CircuitOpenError,
} from './circuit-breaker.executor';

jest.mock('@aws-sdk/client-s3');

describe('S3Service configuration', () => {
  const middlewareAdd =
    jest.fn<(middleware: unknown, options: unknown) => void>();
  const send = jest.fn<() => Promise<any>>();

  function createCircuitBreaker(failureThreshold = 3) {
    const values: Record<string, unknown> = {
      CIRCUIT_BREAKER_ENABLED: true,
      CIRCUIT_BREAKER_FAILURE_THRESHOLD: failureThreshold,
      CIRCUIT_BREAKER_RESET_TIMEOUT_MS: 30_000,
    };
    return new CircuitBreakerExecutor({
      get: jest.fn((name: string) => values[name]),
    } as unknown as ConfigService);
  }

  function createConfig(overrides: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      S3_REGION: 'ap-southeast-1',
      S3_ACCESS_KEY_ID: 'aws-key',
      S3_SECRET_ACCESS_KEY: 'aws-secret',
      ...overrides,
    };
    return {
      getOrThrow: jest.fn((name: string) => values[name]),
      get: jest.fn((name: string) => values[name]),
    } as unknown as ConfigService;
  }

  function getMiddleware() {
    return middlewareAdd.mock.calls[0]?.[0] as (
      next: (args: object) => Promise<object>,
      context: { commandName?: string },
    ) => (args: object) => Promise<object>;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(S3Client).mockImplementation(
      () =>
        ({
          middlewareStack: { add: middlewareAdd },
          send,
        }) as unknown as S3Client,
    );
  });

  it('configures a path-style endpoint for MinIO', () => {
    const values: Record<string, unknown> = {
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'minio',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_ENDPOINT: 'http://127.0.0.1:19000',
      S3_FORCE_PATH_STYLE: true,
    };
    const config = createConfig(values);

    new S3Service(config, createCircuitBreaker());

    expect(S3Client).toHaveBeenCalledWith({
      region: 'us-east-1',
      credentials: { accessKeyId: 'minio', secretAccessKey: 'secret' },
      endpoint: 'http://127.0.0.1:19000',
      forcePathStyle: true,
    });
    expect(middlewareAdd).toHaveBeenCalledWith(expect.any(Function), {
      step: 'initialize',
      name: 's3CircuitBreaker',
    });
  });

  it('leaves AWS endpoint behavior unchanged when no endpoint is set', () => {
    const values: Record<string, unknown> = {
      S3_REGION: 'ap-southeast-1',
      S3_ACCESS_KEY_ID: 'aws-key',
      S3_SECRET_ACCESS_KEY: 'aws-secret',
    };
    const config = createConfig(values);

    new S3Service(config, createCircuitBreaker());

    expect(S3Client).toHaveBeenCalledWith({
      region: 'ap-southeast-1',
      credentials: { accessKeyId: 'aws-key', secretAccessKey: 'aws-secret' },
    });
  });

  it('wraps a complete AWS command in the S3 circuit', async () => {
    new S3Service(createConfig(), createCircuitBreaker());
    const next = jest
      .fn<(args: object) => Promise<object>>()
      .mockResolvedValue({
        output: { $metadata: { httpStatusCode: 200 } },
        response: {},
      });
    const handler = getMiddleware()(next, {
      commandName: 'PutObjectCommand',
    });

    await expect(handler({ input: {} })).resolves.toMatchObject({
      output: { $metadata: { httpStatusCode: 200 } },
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('opens for final AWS 5xx failures and short-circuits later commands', async () => {
    new S3Service(createConfig(), createCircuitBreaker());
    const failure = Object.assign(new Error('S3 unavailable'), {
      $metadata: { httpStatusCode: 503 },
    });
    const next = jest
      .fn<(args: object) => Promise<object>>()
      .mockRejectedValue(failure);
    const handler = getMiddleware()(next, {
      commandName: 'GetObjectCommand',
    });

    for (let call = 0; call < 3; call += 1) {
      await expect(handler({ input: {} })).rejects.toBe(failure);
    }
    await expect(handler({ input: {} })).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('does not count an AWS 404 response against the S3 circuit', async () => {
    new S3Service(createConfig(), createCircuitBreaker());
    const failure = Object.assign(new Error('No such key'), {
      $metadata: { httpStatusCode: 404 },
    });
    const next = jest
      .fn<(args: object) => Promise<object>>()
      .mockRejectedValue(failure);
    const handler = getMiddleware()(next, {
      commandName: 'GetObjectCommand',
    });

    for (let call = 0; call < 4; call += 1) {
      await expect(handler({ input: {} })).rejects.toBe(failure);
    }
    expect(next).toHaveBeenCalledTimes(4);
  });
});
