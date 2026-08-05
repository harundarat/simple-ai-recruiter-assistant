import { HttpStatus } from '@nestjs/common';
import { ZodError } from 'zod';
import { getErrorMessage, isRetryableError } from './retry.utils';

export const PIPELINE_ERROR_CODES = [
  'QUEUE_UNAVAILABLE',
  'STORAGE_UNAVAILABLE',
  'STORAGE_OBJECT_NOT_FOUND',
  'KNOWLEDGE_BASE_UNAVAILABLE',
  'GROUND_TRUTH_NOT_FOUND',
  'LLM_UNAVAILABLE',
  'LLM_INVALID_RESPONSE',
  'INTERNAL_ERROR',
] as const;

export type PipelineErrorCode = (typeof PIPELINE_ERROR_CODES)[number];

export const PIPELINE_STAGES = [
  'ENQUEUE',
  'LOAD_FILES',
  'LOAD_GROUND_TRUTH',
  'CV_EVALUATION',
  'PROJECT_EVALUATION',
  'FINAL_SYNTHESIS',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

const PUBLIC_MESSAGES: Record<PipelineErrorCode, string> = {
  QUEUE_UNAVAILABLE: 'Evaluation queue is temporarily unavailable',
  STORAGE_UNAVAILABLE: 'File storage is temporarily unavailable',
  STORAGE_OBJECT_NOT_FOUND: 'An uploaded file could not be found',
  KNOWLEDGE_BASE_UNAVAILABLE:
    'Evaluation knowledge base is temporarily unavailable',
  GROUND_TRUTH_NOT_FOUND: 'Required evaluation reference data was not found',
  LLM_UNAVAILABLE: 'AI evaluation service is temporarily unavailable',
  LLM_INVALID_RESPONSE: 'AI evaluation service returned an invalid response',
  INTERNAL_ERROR: 'Evaluation failed because of an internal error',
};

export class PipelineError extends Error {
  readonly errorCode: PipelineErrorCode;
  readonly failedStage: PipelineStage;
  readonly publicMessage: string;
  readonly retryable: boolean;

  constructor(options: {
    errorCode: PipelineErrorCode;
    failedStage: PipelineStage;
    retryable: boolean;
    cause?: unknown;
    publicMessage?: string;
  }) {
    const message = options.publicMessage ?? PUBLIC_MESSAGES[options.errorCode];
    super(message, { cause: options.cause });
    this.name = 'PipelineError';
    this.errorCode = options.errorCode;
    this.failedStage = options.failedStage;
    this.publicMessage = message;
    this.retryable = options.retryable;
  }
}

export class GroundTruthNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroundTruthNotFoundError';
  }
}

export function isStorageObjectNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const record = error as Record<string, unknown>;
  const metadata = record.$metadata;
  const metadataStatus =
    typeof metadata === 'object' && metadata !== null
      ? (metadata as Record<string, unknown>).httpStatusCode
      : undefined;

  return (
    record.name === 'NoSuchKey' ||
    record.Code === 'NoSuchKey' ||
    record.code === 'NoSuchKey' ||
    record.status === HttpStatus.NOT_FOUND ||
    record.statusCode === HttpStatus.NOT_FOUND ||
    metadataStatus === HttpStatus.NOT_FOUND
  );
}

function isInvalidLlmResponse(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    error instanceof ZodError ||
    (error instanceof Error && error.name === 'InvalidLlmResponseError')
  );
}

export function toPipelineError(
  error: unknown,
  failedStage: PipelineStage,
): PipelineError {
  if (error instanceof PipelineError) {
    return error;
  }

  if (failedStage === 'ENQUEUE') {
    return new PipelineError({
      errorCode: 'QUEUE_UNAVAILABLE',
      failedStage,
      retryable: true,
      cause: error,
    });
  }

  if (failedStage === 'LOAD_FILES') {
    return new PipelineError({
      errorCode: isStorageObjectNotFound(error)
        ? 'STORAGE_OBJECT_NOT_FOUND'
        : 'STORAGE_UNAVAILABLE',
      failedStage,
      retryable: !isStorageObjectNotFound(error),
      cause: error,
    });
  }

  if (failedStage === 'LOAD_GROUND_TRUTH') {
    const missing =
      error instanceof GroundTruthNotFoundError ||
      getErrorMessage(error).toLowerCase().includes('not found') ||
      getErrorMessage(error).toLowerCase().includes('missing role');
    return new PipelineError({
      errorCode: missing
        ? 'GROUND_TRUTH_NOT_FOUND'
        : 'KNOWLEDGE_BASE_UNAVAILABLE',
      failedStage,
      retryable: !missing,
      cause: error,
    });
  }

  if (
    failedStage === 'CV_EVALUATION' ||
    failedStage === 'PROJECT_EVALUATION' ||
    failedStage === 'FINAL_SYNTHESIS'
  ) {
    const invalidResponse = isInvalidLlmResponse(error);
    return new PipelineError({
      errorCode: invalidResponse ? 'LLM_INVALID_RESPONSE' : 'LLM_UNAVAILABLE',
      failedStage,
      retryable: !invalidResponse && isRetryableError(error),
      cause: error,
    });
  }

  return new PipelineError({
    errorCode: 'INTERNAL_ERROR',
    failedStage,
    retryable: false,
    cause: error,
  });
}

export function invalidLlmResponse(message: string, cause?: unknown): Error {
  const error = new Error(message, { cause });
  error.name = 'InvalidLlmResponseError';
  return error;
}
