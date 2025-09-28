import { Controller, Post, Body } from '@nestjs/common';
import { EvaluateService } from './evaluate.service';

export interface EvaluateRequestDto {
  fileId: string;
  evaluationType: 'cv' | 'project_report' | 'both';
  criteria?: {
    skills?: string[];
    experience?: string[];
    education?: string[];
  };
}

@Controller('evaluate')
export class EvaluateController {
  constructor(private readonly evaluateService: EvaluateService) {}

  @Post()
  async startEvaluation(@Body() evaluateRequest: EvaluateRequestDto) {
    return this.evaluateService.startEvaluation(evaluateRequest);
  }
}
