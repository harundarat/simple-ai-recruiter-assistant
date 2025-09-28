import { Module } from '@nestjs/common';
import { EvaluateController } from './evaluate.controller';
import { EvaluateService } from './evaluate.service';

@Module({
  controllers: [EvaluateController],
  providers: [EvaluateService],
  exports: [EvaluateService],
})
export class EvaluateModule {}
