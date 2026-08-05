import { Body, Controller, Post } from '@nestjs/common';
import { EvaluateService } from './evaluate.service';
import { EvaluateRequestDto } from './dto/evaluate-request.dto';

@Controller('evaluate')
export class EvaluateController {
  constructor(private readonly evaluateService: EvaluateService) {}

  @Post()
  async startEvaluation(@Body() evaluateRequest: EvaluateRequestDto) {
    return this.evaluateService.startEvaluation(
      evaluateRequest.job_title,
      evaluateRequest.cv_id,
      evaluateRequest.project_report_id,
    );
  }
}
