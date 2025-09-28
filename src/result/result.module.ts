import { Module } from '@nestjs/common';
import { ResultController } from './result.controller';
import { ResultService } from './result.service';
import { EvaluateModule } from '../evaluate/evaluate.module';

@Module({
  imports: [EvaluateModule],
  controllers: [ResultController],
  providers: [ResultService],
})
export class ResultModule {}
