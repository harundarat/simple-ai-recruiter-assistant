import { Module } from '@nestjs/common';
import { EvaluateController } from './evaluate.controller';
import { EvaluateService } from './evaluate.service';
import { EvaluationProcessor } from './evaluate.processor';
import { SharedModule } from '../shared/shared.module';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { BullEvaluationQueueGateway } from './evaluation-queue.gateway';
import { EVALUATION_QUEUE } from '../shared/infrastructure.tokens';

@Module({
  imports: [
    SharedModule,
    ConfigModule,
    BullModule.registerQueue({
      name: 'evaluation',
    }),
  ],
  controllers: [EvaluateController],
  providers: [
    EvaluateService,
    EvaluationProcessor,
    BullEvaluationQueueGateway,
    {
      provide: EVALUATION_QUEUE,
      useExisting: BullEvaluationQueueGateway,
    },
  ],
  exports: [EvaluateService],
})
export class EvaluateModule {}
