import { BadRequestException, Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { SharedModule } from '../shared/shared.module';
import { MulterModule } from '@nestjs/platform-express';
import { S3Service } from 'src/shared/s3.service';
import multerS3 from 'multer-s3';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [SharedModule, ConfigModule],
      inject: [S3Service, ConfigService],
      useFactory: (s3Service: S3Service, configService: ConfigService) => ({
        storage: multerS3({
          s3: s3Service.getS3Client() as any,
          bucket: configService.getOrThrow<string>('S3_BUCKET_NAME'),
          key: (req, file, cb) => {
            const prefix = file.fieldname || 'files';
            const safeName = file.originalname.replace(/\s+/g, '-');
            cb(null, `${prefix}/${Date.now()}-${safeName}`);
          },
        }),
        fileFilter: (req, file, cb) => {
          const allowedMimes = [
            'application/pdf',
            'text/plain',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ];

          const filename = file?.originalname ?? '';
          const isAllowed =
            allowedMimes.includes(file.mimetype) ||
            /\.(pdf|txt|docx|doc)$/i.test(filename);

          if (!isAllowed) {
            return cb(
              new BadRequestException(
                'Only PDF, TXT and DOC/DOCX files are allowed',
              ),
              false,
            );
          }

          cb(null, true);
        },
        limits: { fileSize: 10 * 1024 * 1024 },
      }),
    }),
    SharedModule,
    ConfigModule,
  ],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
