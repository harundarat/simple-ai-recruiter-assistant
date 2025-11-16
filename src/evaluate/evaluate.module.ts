import { Module } from '@nestjs/common';
import { EvaluateController } from './evaluate.controller';
import { EvaluateService } from './evaluate.service';
import { SharedModule } from 'src/shared/shared.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [SharedModule, ConfigModule],
  controllers: [EvaluateController],
  providers: [EvaluateService],
  exports: [EvaluateService],
})
export class EvaluateModule { }
