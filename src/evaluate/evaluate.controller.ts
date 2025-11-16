import { Controller, Post, Body, Get } from '@nestjs/common';
import { EvaluateService } from './evaluate.service';
import { LLMService } from 'src/shared/llm.service';
import { EvaluateRequestDto } from './dto/evaluate-request.dto';

@Controller('evaluate')
export class EvaluateController {
  constructor(
    private readonly evaluateService: EvaluateService,
    private readonly llmService: LLMService,
  ) { }

  @Get('/hi')
  async test() {
    return "hi"
  }

  @Post()
  async startEvaluation(@Body() evaluateRequest: EvaluateRequestDto) {
    return this.evaluateService.startEvaluation(
      evaluateRequest.title,
      evaluateRequest.cv_id,
      evaluateRequest.project_report_id,
    );
  }
}
