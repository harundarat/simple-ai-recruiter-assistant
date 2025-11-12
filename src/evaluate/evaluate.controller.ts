import { Controller, Post, Body, Get } from '@nestjs/common';
import { EvaluateService } from './evaluate.service';
import { LLMService } from 'src/shared/llm.service';

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
  constructor(
    private readonly evaluateService: EvaluateService,
    private readonly llmService: LLMService,
  ) {}

  @Get('/hi')
  async test() {
    const response = await this.llmService.extractCV(2);
    return JSON.parse(response);
  }

  @Post()
  async startEvaluation(@Body() evaluateRequest: EvaluateRequestDto) {
    return this.evaluateService.startEvaluation(evaluateRequest);
  }
}
