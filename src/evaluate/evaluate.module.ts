import { Module } from '@nestjs/common';
import { EvaluateController } from './evaluate.controller';
import { EvaluateService } from './evaluate.service';
import { EvaluationProcessor } from './evaluate.processor';
import { SharedModule } from 'src/shared/shared.module';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    SharedModule,
    ConfigModule,
    BullModule.registerQueue({
      name: 'evaluation',
    }),
  ],
  controllers: [EvaluateController],
  providers: [EvaluateService, EvaluationProcessor],
  exports: [EvaluateService],
})
export class EvaluateModule { }
