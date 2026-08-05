import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { PipelineError } from '../shared/pipeline-error';
import { getErrorMessage } from '../shared/retry.utils';

@Catch()
export class UploadExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(UploadExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response
        .status(exception.getStatus())
        .json(
          typeof body === 'string'
            ? { statusCode: exception.getStatus(), message: body }
            : body,
        );
      return;
    }

    const error =
      exception instanceof PipelineError
        ? exception
        : new PipelineError({
            errorCode: 'STORAGE_UNAVAILABLE',
            failedStage: 'LOAD_FILES',
            retryable: true,
            cause: exception,
          });
    this.logger.error('Upload failed', {
      cause: getErrorMessage(error.cause ?? exception),
    });
    response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error_code: error.errorCode,
      failed_stage: error.failedStage,
      message: error.publicMessage,
    });
  }
}
