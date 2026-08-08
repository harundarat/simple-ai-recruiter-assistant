import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { EvaluateService } from './evaluate.service';
import { EvaluateRequestDto } from './dto/evaluate-request.dto';

@Controller('evaluate')
export class EvaluateController {
  constructor(private readonly evaluateService: EvaluateService) {}

  @Post()
  async startEvaluation(
    @Body() evaluateRequest: EvaluateRequestDto,
    @Req() request: Request,
  ) {
    const requestId =
      typeof request.id === 'string'
        ? request.id
        : typeof request.id === 'number'
          ? request.id.toString()
          : 'unknown-request';
    return this.evaluateService.startEvaluation(
      evaluateRequest.job_title,
      evaluateRequest.cv_id,
      evaluateRequest.project_report_id,
      requestId,
    );
  }
}
