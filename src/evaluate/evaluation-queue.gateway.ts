import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  EvaluationJobData,
  EvaluationQueue,
} from '../shared/infrastructure.tokens';

@Injectable()
export class BullEvaluationQueueGateway implements EvaluationQueue {
  constructor(
    @InjectQueue('evaluation') private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async enqueue(data: EvaluationJobData, jobId: string): Promise<void> {
    await this.queue.add('process-evaluation', data, {
      jobId,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: this.configService.get<number>('BULL_RETRY_DELAY_MS') ?? 1_000,
        jitter: this.configService.get<number>('RETRY_JITTER_RATIO') ?? 0.2,
      },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
  }
}
