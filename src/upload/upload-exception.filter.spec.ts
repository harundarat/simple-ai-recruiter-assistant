import { describe, expect, it, jest } from '@jest/globals';
import { ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';
import { CircuitOpenError } from '../shared/circuit-breaker.executor';
import { UploadExceptionFilter } from './upload-exception.filter';

describe('UploadExceptionFilter', () => {
  it('maps an open S3 circuit without exposing circuit details', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }) as unknown as Response,
      }),
    } as unknown as ArgumentsHost;

    new UploadExceptionFilter().catch(
      new CircuitOpenError('s3', 'PutObjectCommand'),
      host,
    );

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      statusCode: 503,
      error_code: 'STORAGE_UNAVAILABLE',
      failed_stage: 'LOAD_FILES',
      message: 'File storage is temporarily unavailable',
    });
  });
});
