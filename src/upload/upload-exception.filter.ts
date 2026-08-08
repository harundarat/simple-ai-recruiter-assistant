import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { toPipelineError } from '../shared/pipeline-error';

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

    const error = toPipelineError(exception, 'LOAD_FILES');
    this.logger.error(
      {
        event: 'upload.failed',
        errorCode: error.errorCode,
        failedStage: error.failedStage,
        err: error.cause ?? exception,
      },
      'Upload failed',
    );
    response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error_code: error.errorCode,
      failed_stage: error.failedStage,
      message: error.publicMessage,
    });
  }
}
