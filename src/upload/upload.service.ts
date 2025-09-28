import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/shared/prisma.service';

@Injectable()
export class UploadService {
  constructor(private prismaService: PrismaService) {}

  async processUploadedFile(file: Express.MulterS3.File) {
    await this.prismaService.cV.create({
      data: {
        originalName: file.originalname,
        hostedName: file.key,
        url: file.location,
      },
    });
    return {
      id: this.generateFileId(),
      url: file.location,
      key: file.key,
      originalName: file.originalname,
      size: file.size,
      message: 'File uploaded successfully',
    };
  }

  validateFile(file: Express.Multer.File, callback: any) {
    const allowedExtensions = ['.pdf'];
    const allowedMimeTypes = ['application/pdf'];

    const fileExtension = file.originalname
      .toLowerCase()
      .substring(file.originalname.lastIndexOf('.'));

    if (!allowedExtensions.includes(fileExtension)) {
      return callback(
        new BadRequestException('Only PDF files are allowed!'),
        false,
      );
    }

    if (!allowedMimeTypes.includes(file.mimetype)) {
      return callback(new BadRequestException('Invalid file type!'), false);
    }

    callback(null, true);
  }

  private generateFileId(): string {
    return `file_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
