import { describe, expect, it } from '@jest/globals';
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
});
