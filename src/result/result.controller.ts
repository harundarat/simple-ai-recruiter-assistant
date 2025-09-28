import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ResultService } from './result.service';

@Controller('result')
export class ResultController {
  constructor(private readonly resultService: ResultService) {}

  @Get(':id')
  async getEvaluationResult(@Param('id') id: string) {
    const result = await this.resultService.getEvaluationResult(id);

    if (!result) {
      throw new NotFoundException(`Evaluation with ID ${id} not found`);
    }

    return result;
  }
}
