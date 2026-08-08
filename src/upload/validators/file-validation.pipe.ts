import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  PipeTransform,
} from '@nestjs/common';
import {
  FILE_VALIDATION_CONSTANTS,
  FILE_VALIDATION_ERROR_MESSAGES,
} from '../constants/file-validation.constants';
import { FILE_STORE } from '../../shared/infrastructure.tokens';
import type { FileStore } from '../../shared/infrastructure.tokens';

export interface FileValidationOptions {
  maxSize?: number; // in bytes
  allowedMimeTypes?: readonly string[];
  allowedExtensions?: readonly string[];
  fieldName?: string;
}

@Injectable()
export class FileValidationPipe implements PipeTransform {
  private readonly options: Required<FileValidationOptions>;

  constructor(options?: FileValidationOptions) {
    this.options = {
      maxSize:
        options?.maxSize || FILE_VALIDATION_CONSTANTS.MAX_FILE_SIZE_BYTES,
      allowedMimeTypes:
        options?.allowedMimeTypes ||
        FILE_VALIDATION_CONSTANTS.ALLOWED_MIME_TYPES,
      allowedExtensions:
        options?.allowedExtensions ||
        FILE_VALIDATION_CONSTANTS.ALLOWED_EXTENSIONS,
      fieldName: options?.fieldName || 'file',
    };
  }

  transform(file: Express.MulterS3.File): Express.MulterS3.File {
    // Check if file exists
    if (!file) {
      throw new BadRequestException(
        `${this.options.fieldName} is required and must be a PDF file`,
      );
    }

    // Validate file size
    if (file.size > this.options.maxSize) {
      const maxSizeMB = FILE_VALIDATION_CONSTANTS.MAX_FILE_SIZE_MB;
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
      throw new BadRequestException(
        FILE_VALIDATION_ERROR_MESSAGES.FILE_TOO_LARGE(
          this.options.fieldName,
          maxSizeMB,
          fileSizeMB,
        ),
      );
    }

    // Validate MIME type
    if (!this.options.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        FILE_VALIDATION_ERROR_MESSAGES.INVALID_TYPE(
          this.options.fieldName,
          file.mimetype,
        ),
      );
    }

    // Validate file extension
    const filename = file.originalname.toLowerCase();
    const hasValidExtension = this.options.allowedExtensions.some((ext) =>
      filename.endsWith(ext.toLowerCase()),
    );

    if (!hasValidExtension) {
      throw new BadRequestException(
        FILE_VALIDATION_ERROR_MESSAGES.INVALID_EXTENSION(
          this.options.fieldName,
        ),
      );
    }

    return file;
  }
}

/**
 * Validates uploaded files object with multiple fields
 * Ensures both CV and Project Report are present and valid PDFs
 */
@Injectable()
export class FilesValidationPipe implements PipeTransform {
  private readonly logger = new Logger(FilesValidationPipe.name);

  constructor(
    @Optional() @Inject(FILE_STORE) private readonly fileStore?: FileStore,
  ) {}

  transform(files: {
    cv?: Express.MulterS3.File[];
    project_report?: Express.MulterS3.File[];
  }):
    | {
        cv: Express.MulterS3.File[];
        project_report: Express.MulterS3.File[];
      }
    | Promise<never> {
    try {
      return this.validate(files);
    } catch (error: unknown) {
      const uploadedFiles = [
        ...(files?.cv ?? []),
        ...(files?.project_report ?? []),
      ];
      if (this.fileStore && uploadedFiles.length > 0) {
        return this.cleanupAndRethrow(uploadedFiles, error);
      }
      throw error;
    }
  }

  private validate(files: {
    cv?: Express.MulterS3.File[];
    project_report?: Express.MulterS3.File[];
  }): {
    cv: Express.MulterS3.File[];
    project_report: Express.MulterS3.File[];
  } {
    // Validate that files object exists
    if (!files) {
      throw new BadRequestException(FILE_VALIDATION_ERROR_MESSAGES.NO_FILES);
    }

    // Validate CV file presence
    if (!files.cv || files.cv.length === 0) {
      throw new BadRequestException(FILE_VALIDATION_ERROR_MESSAGES.CV_REQUIRED);
    }

    // Validate Project Report file presence
    if (!files.project_report || files.project_report.length === 0) {
      throw new BadRequestException(
        FILE_VALIDATION_ERROR_MESSAGES.PROJECT_REPORT_REQUIRED,
      );
    }

    // Validate CV file (size, type, extension)
    const cvValidator = new FileValidationPipe({
      fieldName: FILE_VALIDATION_CONSTANTS.DISPLAY_NAMES.CV,
    });
    cvValidator.transform(files.cv[0]);

    // Validate Project Report file (size, type, extension)
    const projectValidator = new FileValidationPipe({
      fieldName: FILE_VALIDATION_CONSTANTS.DISPLAY_NAMES.PROJECT_REPORT,
    });
    projectValidator.transform(files.project_report[0]);

    return files as {
      cv: Express.MulterS3.File[];
      project_report: Express.MulterS3.File[];
    };
  }

  private async cleanupAndRethrow(
    files: Express.MulterS3.File[],
    validationError: unknown,
  ): Promise<never> {
    const references = files
      .filter((file) => Boolean(file.key && file.bucket))
      .map((file) => ({ bucket: file.bucket, key: file.key }));
    if (references.length > 0) {
      try {
        await this.fileStore?.deleteFiles(references);
      } catch (cleanupError: unknown) {
        this.logger.error(
          {
            event: 'upload.validation_cleanup_failed',
            err: cleanupError,
            keys: references.map(({ key }) => key),
          },
          'Failed to clean up files after upload validation',
        );
      }
    }
    throw validationError;
  }
}
