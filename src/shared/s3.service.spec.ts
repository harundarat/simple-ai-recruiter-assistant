import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { S3Service } from './s3.service';

jest.mock('@aws-sdk/client-s3');

describe('S3Service configuration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('configures a path-style endpoint for MinIO', () => {
    const values: Record<string, unknown> = {
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'minio',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_ENDPOINT: 'http://127.0.0.1:19000',
      S3_FORCE_PATH_STYLE: true,
    };
    const config = {
      getOrThrow: jest.fn((name: string) => values[name]),
      get: jest.fn((name: string) => values[name]),
    } as unknown as ConfigService;

    new S3Service(config);

    expect(S3Client).toHaveBeenCalledWith({
      region: 'us-east-1',
      credentials: { accessKeyId: 'minio', secretAccessKey: 'secret' },
      endpoint: 'http://127.0.0.1:19000',
      forcePathStyle: true,
    });
  });

  it('leaves AWS endpoint behavior unchanged when no endpoint is set', () => {
    const values: Record<string, unknown> = {
      S3_REGION: 'ap-southeast-1',
      S3_ACCESS_KEY_ID: 'aws-key',
      S3_SECRET_ACCESS_KEY: 'aws-secret',
    };
    const config = {
      getOrThrow: jest.fn((name: string) => values[name]),
      get: jest.fn((name: string) => values[name]),
    } as unknown as ConfigService;

    new S3Service(config);

    expect(S3Client).toHaveBeenCalledWith({
      region: 'ap-southeast-1',
      credentials: { accessKeyId: 'aws-key', secretAccessKey: 'aws-secret' },
    });
  });
});
