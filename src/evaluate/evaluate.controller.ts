import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { EvaluateService } from './evaluate.service';
import { EvaluateRequestDto } from './dto/evaluate-request.dto';

@Controller('evaluate')
export class EvaluateController {
  constructor(private readonly evaluateService: EvaluateService) {}

  @Get('/hi')
  async test() {
    return 'hi';
  }

  @Post()
  async startEvaluation(@Body() evaluateRequest: EvaluateRequestDto) {
    return this.evaluateService.startEvaluation(
      evaluateRequest.job_title,
      evaluateRequest.cv_id,
      evaluateRequest.project_report_id,
    );
  }

  @Get('result/:id')
  async getEvaluationResult(@Param('id', ParseIntPipe) id: number) {
    return this.evaluateService.getEvaluationResult(id);
  }
}
