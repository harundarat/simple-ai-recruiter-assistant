const REQUIRED_ENVIRONMENT_VARIABLES = [
  'DATABASE_URL',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET_NAME',
  'GOOGLE_GEMINI_API_KEY',
] as const;

function parsePort(value: unknown, name: string, defaultValue: number): number {
  const port =
    value === undefined || value === '' ? defaultValue : Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return port;
}

function parseNonNegativeNumber(
  value: unknown,
  name: string,
  defaultValue: number,
): number {
  const parsed =
    value === undefined || value === '' ? defaultValue : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function parsePositiveInteger(
  value: unknown,
  name: string,
  defaultValue: number,
): number {
  const parsed =
    value === undefined || value === '' ? defaultValue : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseBoolean(value: unknown, name: string, defaultValue: boolean) {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const missingVariables = REQUIRED_ENVIRONMENT_VARIABLES.filter((name) => {
    const value = environment[name];
    return typeof value !== 'string' || value.trim() === '';
  });

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVariables.join(', ')}`,
    );
  }

  return {
    ...environment,
    PORT: parsePort(environment.PORT, 'PORT', 3000),
    REDIS_HOST: environment.REDIS_HOST || 'localhost',
    REDIS_PORT: parsePort(environment.REDIS_PORT, 'REDIS_PORT', 6379),
    CHROMA_HOST: environment.CHROMA_HOST || 'localhost',
    CHROMA_PORT: parsePort(environment.CHROMA_PORT, 'CHROMA_PORT', 8000),
    CHROMA_COLLECTION_NAME:
      environment.CHROMA_COLLECTION_NAME || 'ground_truth',
    S3_FORCE_PATH_STYLE: parseBoolean(
      environment.S3_FORCE_PATH_STYLE,
      'S3_FORCE_PATH_STYLE',
      false,
    ),
    CIRCUIT_BREAKER_ENABLED: parseBoolean(
      environment.CIRCUIT_BREAKER_ENABLED,
      'CIRCUIT_BREAKER_ENABLED',
      true,
    ),
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: parsePositiveInteger(
      environment.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      'CIRCUIT_BREAKER_FAILURE_THRESHOLD',
      3,
    ),
    CIRCUIT_BREAKER_RESET_TIMEOUT_MS: parsePositiveInteger(
      environment.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
      'CIRCUIT_BREAKER_RESET_TIMEOUT_MS',
      30_000,
    ),
    GEMINI_RETRY_DELAY_MS: parseNonNegativeNumber(
      environment.GEMINI_RETRY_DELAY_MS,
      'GEMINI_RETRY_DELAY_MS',
      500,
    ),
    GEMINI_TIMEOUT_MS: parseNonNegativeNumber(
      environment.GEMINI_TIMEOUT_MS,
      'GEMINI_TIMEOUT_MS',
      90_000,
    ),
    ENQUEUE_RETRY_DELAY_MS: parseNonNegativeNumber(
      environment.ENQUEUE_RETRY_DELAY_MS,
      'ENQUEUE_RETRY_DELAY_MS',
      250,
    ),
    ENQUEUE_TIMEOUT_MS: parseNonNegativeNumber(
      environment.ENQUEUE_TIMEOUT_MS,
      'ENQUEUE_TIMEOUT_MS',
      5_000,
    ),
    BULL_RETRY_DELAY_MS: parseNonNegativeNumber(
      environment.BULL_RETRY_DELAY_MS,
      'BULL_RETRY_DELAY_MS',
      1_000,
    ),
    RETRY_JITTER_RATIO: parseNonNegativeNumber(
      environment.RETRY_JITTER_RATIO,
      'RETRY_JITTER_RATIO',
      0.2,
    ),
  };
}
