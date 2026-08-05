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
  };
}
