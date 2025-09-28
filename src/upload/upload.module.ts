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
          key: (req, file, cb) =>
            cb(null, `${Date.now()}-${file.originalname}`),
        }),
        fileFilter: (req, file, cb) => {
          const isPdf =
            file.mimetype === 'application/pdf' ||
            /\.pdf$/i.test(file.originalname);

          if (!isPdf) {
            return cb(
              new BadRequestException('Only PDF files are allowed'),
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
