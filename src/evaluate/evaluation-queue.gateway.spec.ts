import { describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { BullEvaluationQueueGateway } from './evaluation-queue.gateway';

describe('BullEvaluationQueueGateway', () => {
  it('configures three job attempts with exponential backoff and jitter', async () => {
    const add = jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
    const config = {
      get: jest.fn((name: string) => (name === 'BULL_RETRY_DELAY_MS' ? 25 : 0)),
    } as unknown as ConfigService;
    const gateway = new BullEvaluationQueueGateway(
      { add } as unknown as Queue,
      config,
    );
    const data = {
      evaluationId: 1,
      jobTitle: 'Backend Developer',
      cvId: 2,
      projectReportId: 3,
    };

    await gateway.enqueue(data, 'evaluation-1');

    expect(add).toHaveBeenCalledWith('process-evaluation', data, {
      jobId: 'evaluation-1',
      attempts: 3,
      backoff: { type: 'exponential', delay: 25, jitter: 0 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
  });
});
