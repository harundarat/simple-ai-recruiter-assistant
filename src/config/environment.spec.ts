import { describe, expect, it } from '@jest/globals';
import { validateEnvironment } from './environment';

const validEnvironment = {
  DATABASE_URL: 'postgresql://localhost/evalu8',
  S3_REGION: 'ap-southeast-1',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'secret-key',
  S3_BUCKET_NAME: 'bucket',
  GOOGLE_GEMINI_API_KEY: 'gemini-key',
};

describe('validateEnvironment', () => {
  it('applies local service defaults', () => {
    expect(validateEnvironment(validEnvironment)).toEqual(
      expect.objectContaining({
        PORT: 3000,
        REDIS_HOST: 'localhost',
        REDIS_PORT: 6379,
        CHROMA_HOST: 'localhost',
        CHROMA_PORT: 8000,
        CHROMA_COLLECTION_NAME: 'ground_truth',
        S3_FORCE_PATH_STYLE: false,
      }),
    );
  });

  it('parses MinIO and retry settings for deterministic E2E runs', () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        S3_ENDPOINT: 'http://localhost:19000',
        S3_FORCE_PATH_STYLE: 'true',
        GEMINI_RETRY_DELAY_MS: '5',
        RETRY_JITTER_RATIO: '0',
      }),
    ).toEqual(
      expect.objectContaining({
        S3_ENDPOINT: 'http://localhost:19000',
        S3_FORCE_PATH_STYLE: true,
        GEMINI_RETRY_DELAY_MS: 5,
        RETRY_JITTER_RATIO: 0,
      }),
    );
  });

  it('parses configured ports', () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        PORT: '4000',
        REDIS_PORT: '6380',
        CHROMA_PORT: '8100',
      }),
    ).toEqual(
      expect.objectContaining({
        PORT: 4000,
        REDIS_PORT: 6380,
        CHROMA_PORT: 8100,
      }),
    );
  });

  it('reports every missing required variable', () => {
    expect(() => validateEnvironment({})).toThrow(
      'Missing required environment variables: DATABASE_URL, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME, GOOGLE_GEMINI_API_KEY',
    );
  });

  it.each(['0', '65536', 'not-a-number', '1.5'])(
    'rejects invalid port %s',
    (port) => {
      expect(() =>
        validateEnvironment({ ...validEnvironment, REDIS_PORT: port }),
      ).toThrow('REDIS_PORT must be an integer between 1 and 65535');
    },
  );
});
