import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
  UseFilters,
  UsePipes,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { FilesValidationPipe } from './validators/file-validation.pipe';
import { UploadExceptionFilter } from './upload-exception.filter';

@Controller('upload')
@UseFilters(UploadExceptionFilter)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'cv', maxCount: 1 },
      { name: 'project_report', maxCount: 1 },
    ]),
  )
  @UsePipes(FilesValidationPipe)
  async uploadFile(
    @UploadedFiles()
    files: {
      cv: Express.MulterS3.File[];
      project_report: Express.MulterS3.File[];
    },
  ) {
    return await this.uploadService.processUploadedFiles(
      files.cv[0],
      files.project_report[0],
    );
  }
}
