import { BadRequestException, Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { SharedModule } from '../shared/shared.module';
import { MulterModule } from '@nestjs/platform-express';
import { S3Service } from '../shared/s3.service';
import multerS3 from 'multer-s3';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  FILE_VALIDATION_CONSTANTS,
  FILE_VALIDATION_ERROR_MESSAGES,
} from './constants/file-validation.constants';
import { randomUUID } from 'node:crypto';
import { FilesValidationPipe } from './validators/file-validation.pipe';
import { UploadExceptionFilter } from './upload-exception.filter';

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [SharedModule, ConfigModule],
      inject: [S3Service, ConfigService],
      useFactory: (s3Service: S3Service, configService: ConfigService) => ({
        // Configure Multer to stream incoming files directly to S3
        storage: multerS3({
          s3: s3Service.getS3Client(),
          bucket: configService.getOrThrow<string>('S3_BUCKET_NAME'),
          // Generate a namespaced key that is unique and safe to log/use in URLs.
          key: (req, file, cb) => {
            const prefix = file.fieldname || 'files';
            const safeName = file.originalname.replace(
              /[^a-zA-Z0-9._-]+/g,
              '-',
            );
            cb(null, `${prefix}/${randomUUID()}-${safeName}`);
          },
        }),
        // Allow only PDF files as per case study requirements
        fileFilter: (req, file, cb) => {
          const filename = file?.originalname ?? '';

          // Check MIME type against allowed types
          const isMimeTypeValid =
            FILE_VALIDATION_CONSTANTS.ALLOWED_MIME_TYPES.some(
              (mimeType) => mimeType === file.mimetype,
            );

          // Check file extension against allowed extensions
          const isExtensionValid =
            FILE_VALIDATION_CONSTANTS.ALLOWED_EXTENSIONS.some((ext) =>
              filename.toLowerCase().endsWith(ext.toLowerCase()),
            );

          if (!isMimeTypeValid || !isExtensionValid) {
            return cb(
              new BadRequestException(
                FILE_VALIDATION_ERROR_MESSAGES.ONLY_PDF_ALLOWED,
              ),
              false,
            );
          }

          cb(null, true);
        },
        // File size and count limits
        limits: {
          fileSize: FILE_VALIDATION_CONSTANTS.MAX_FILE_SIZE_BYTES,
          files: FILE_VALIDATION_CONSTANTS.MAX_FILES_COUNT,
        },
      }),
    }),
    SharedModule,
    ConfigModule,
  ],
  controllers: [UploadController],
  providers: [UploadService, FilesValidationPipe, UploadExceptionFilter],
  exports: [UploadService],
})
export class UploadModule {}
