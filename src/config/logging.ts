import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pino, { stdTimeFunctions } from 'pino';
import type { LevelWithSilent, LoggerOptions } from 'pino';
import type { Options } from 'pino-http';
import { getLogContext } from '../shared/log-context';

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const satisfies readonly LevelWithSilent[];

export type LogLevel = (typeof LOG_LEVELS)[number];

interface LoggingOptions {
  environment: string;
  level: LogLevel;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const SENSITIVE_LOG_PATHS = [
  'authorization',
  'cookie',
  'password',
  'token',
  'apiKey',
  'DATABASE_URL',
  'GOOGLE_GEMINI_API_KEY',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.DATABASE_URL',
  '*.GOOGLE_GEMINI_API_KEY',
  '*.S3_ACCESS_KEY_ID',
  '*.S3_SECRET_ACCESS_KEY',
];

export function createPinoHttpOptions({
  environment,
  level,
}: LoggingOptions): Options {
  return {
    ...createLoggerOptions({ environment, level }),
    quietReqLogger: true,
    customAttributeKeys: {
      reqId: 'requestId',
    },
    genReqId: (request, response) => createRequestId(request, response),
    serializers: {
      req: (request: { method?: string; url?: string }) => ({
        method: request.method,
        path: request.url?.split('?', 1)[0],
      }),
      res: (response: { statusCode?: number | null }) => ({
        statusCode: response.statusCode,
      }),
    },
    customLogLevel: (_request, response, error) => {
      if (response.statusCode >= 500 || (error && response.statusCode < 400)) {
        return 'error';
      }
      if (response.statusCode >= 400) {
        return 'warn';
      }
      return 'info';
    },
    customSuccessMessage: () => 'HTTP request completed',
    customErrorMessage: () => 'HTTP request failed',
    customSuccessObject: (_request, _response, value: unknown) => ({
      ...toRecord(value),
      event: 'http.request.completed',
    }),
    customErrorObject: (_request, _response, _error, value: unknown) => ({
      ...toRecord(value),
      event: 'http.request.failed',
    }),
  };
}

export function logBootstrapError(error: unknown): void {
  const logger = pino(
    createLoggerOptions({
      environment: process.env.NODE_ENV || 'development',
      level: 'error',
    }),
  );
  logger.fatal(
    { err: toError(error), event: 'application.bootstrap_failed' },
    'Application bootstrap failed',
  );
}

function createLoggerOptions({
  environment,
  level,
}: LoggingOptions): LoggerOptions {
  return {
    level,
    base: {
      service: 'evalu8',
      environment,
      pid: process.pid,
      hostname: hostname(),
    },
    timestamp: stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    mixin: () => ({ ...getLogContext() }),
    redact: {
      paths: SENSITIVE_LOG_PATHS,
      censor: '[REDACTED]',
    },
  };
}

function createRequestId(
  request: IncomingMessage,
  response: ServerResponse,
): string {
  const header = request.headers['x-request-id'];
  const requestId =
    typeof header === 'string' && REQUEST_ID_PATTERN.test(header)
      ? header
      : randomUUID();
  response.setHeader('X-Request-ID', requestId);
  return requestId;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(typeof value === 'string' ? value : 'Unknown error');
}
