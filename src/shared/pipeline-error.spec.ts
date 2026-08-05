import { describe, expect, it } from '@jest/globals';
import { CircuitOpenError } from './circuit-breaker.executor';
import { invalidLlmResponse, toPipelineError } from './pipeline-error';

describe('pipeline error mapping', () => {
  it('maps an S3 missing object to a permanent structured error', () => {
    expect(
      toPipelineError(
        { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } },
        'LOAD_FILES',
      ),
    ).toMatchObject({
      errorCode: 'STORAGE_OBJECT_NOT_FOUND',
      failedStage: 'LOAD_FILES',
      retryable: false,
      publicMessage: 'An uploaded file could not be found',
    });
  });

  it('maps transient service failures to retryable errors', () => {
    expect(toPipelineError({ status: 503 }, 'LOAD_GROUND_TRUTH')).toMatchObject(
      {
        errorCode: 'KNOWLEDGE_BASE_UNAVAILABLE',
        retryable: true,
      },
    );
  });

  it('maps invalid model output to a permanent response error', () => {
    expect(
      toPipelineError(invalidLlmResponse('bad json'), 'FINAL_SYNTHESIS'),
    ).toMatchObject({
      errorCode: 'LLM_INVALID_RESPONSE',
      retryable: false,
    });
  });

  it.each([
    ['redis', 'enqueue', 'ENQUEUE', 'QUEUE_UNAVAILABLE'],
    ['s3', 'get-object', 'LOAD_FILES', 'STORAGE_UNAVAILABLE'],
    ['chroma', 'query', 'LOAD_GROUND_TRUTH', 'KNOWLEDGE_BASE_UNAVAILABLE'],
    ['gemini', 'generate', 'CV_EVALUATION', 'LLM_UNAVAILABLE'],
    ['gemini', 'generate', 'PROJECT_EVALUATION', 'LLM_UNAVAILABLE'],
    ['gemini', 'generate', 'FINAL_SYNTHESIS', 'LLM_UNAVAILABLE'],
  ] as const)(
    'maps an open %s circuit at %s to %s without retry',
    (service, operation, stage, errorCode) => {
      expect(
        toPipelineError(new CircuitOpenError(service, operation), stage),
      ).toMatchObject({ errorCode, failedStage: stage, retryable: false });
    },
  );
});
