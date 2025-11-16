import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/shared/prisma.service';

@Injectable()
export class UploadService {
  constructor(private prismaService: PrismaService) { }

  async processUploadedFiles(
    cvFile: Express.MulterS3.File,
    projectReportFile: Express.MulterS3.File,
  ) {
    const cvDetail = await this.prismaService.cV.create({
      data: {
        original_name: cvFile.originalname,
        hosted_name: cvFile.key,
        url: cvFile.location,
      },
    });

    const projectReportDetail = await this.prismaService.projectReport.create({
      data: {
        cv_id: cvDetail.id,
        original_name: projectReportFile.originalname,
        hosted_name: projectReportFile.key,
        url: projectReportFile.location,
      },
    });

    return {
      cv_id: cvDetail.id,
      project_report_id: projectReportDetail.id,
      message: 'Files uploaded successfully',
    };
  }

  // validateFile(file: Express.Multer.File, callback: any) {
  //   const allowedExtensions = ['.pdf'];
  //   const allowedMimeTypes = ['application/pdf'];

  //   const fileExtension = file.originalname
  //     .toLowerCase()
  //     .substring(file.originalname.lastIndexOf('.'));

  //   if (!allowedExtensions.includes(fileExtension)) {
  //     return callback(
  //       new BadRequestException('Only PDF files are allowed!'),
  //       false,
  //     );
  //   }

  //   if (!allowedMimeTypes.includes(file.mimetype)) {
  //     return callback(new BadRequestException('Invalid file type!'), false);
  //   }

  //   callback(null, true);
  // }
}
