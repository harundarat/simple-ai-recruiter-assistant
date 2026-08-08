import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../shared/prisma.service';
import { FILE_STORE } from '../shared/infrastructure.tokens';
import type {
  FileStore,
  StoredFileReference,
} from '../shared/infrastructure.tokens';
import { PipelineError } from '../shared/pipeline-error';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @Inject(FILE_STORE) private readonly fileStore: FileStore,
    private readonly configService: ConfigService,
  ) {}

  async processUploadedFiles(
    cvFile: Express.MulterS3.File,
    projectReportFile: Express.MulterS3.File,
  ) {
    try {
      const { cvDetail, projectReportDetail } =
        await this.prismaService.$transaction(async (transaction) => {
          const cvDetail = await transaction.cV.create({
            data: {
              original_name: cvFile.originalname,
              hosted_name: cvFile.key,
              url: cvFile.location,
            },
          });

          const projectReportDetail = await transaction.projectReport.create({
            data: {
              cv_id: cvDetail.id,
              original_name: projectReportFile.originalname,
              hosted_name: projectReportFile.key,
              url: projectReportFile.location,
            },
          });

          return { cvDetail, projectReportDetail };
        });

      return {
        cv_id: cvDetail.id,
        project_report_id: projectReportDetail.id,
        message: 'Files uploaded successfully',
      };
    } catch (cause: unknown) {
      await this.cleanupUploadedFiles([cvFile, projectReportFile]);
      throw new PipelineError({
        errorCode: 'STORAGE_UNAVAILABLE',
        failedStage: 'LOAD_FILES',
        retryable: true,
        cause,
      });
    }
  }

  private async cleanupUploadedFiles(
    files: Express.MulterS3.File[],
  ): Promise<void> {
    const fallbackBucket =
      this.configService.get<string>('S3_BUCKET_NAME') ?? '';
    const references = files
      .filter((file) => Boolean(file?.key))
      .map<StoredFileReference>((file) => ({
        bucket: file.bucket || fallbackBucket,
        key: file.key,
      }))
      .filter((file) => file.bucket.length > 0);

    if (references.length === 0) {
      return;
    }

    try {
      await this.fileStore.deleteFiles(references);
    } catch (cleanupError: unknown) {
      this.logger.error(
        {
          event: 'upload.cleanup_failed',
          err: cleanupError,
          keys: references.map(({ key }) => key),
        },
        'Failed to clean up uploaded files',
      );
    }
  }
}
