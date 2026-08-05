import { Injectable } from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';

@Injectable()
export class UploadService {
  constructor(private prismaService: PrismaService) {}

  async processUploadedFiles(
    cvFile: Express.MulterS3.File,
    projectReportFile: Express.MulterS3.File,
  ) {
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
  }
}
