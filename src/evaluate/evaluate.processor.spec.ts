import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Job } from 'bullmq';
import { EvaluationProcessor } from './evaluate.processor';
import { EvaluateService } from './evaluate.service';
import { PrismaService } from '../shared/prisma.service';

const job = {
  data: {
    evaluationId: 42,
    jobTitle: 'Backend Developer',
    cvId: 1,
    projectReportId: 2,
  },
} as Job<{
  evaluationId: number;
  jobTitle: string;
  cvId: number;
  projectReportId: number;
}>;

describe('EvaluationProcessor', () => {
  const update = jest.fn<() => Promise<unknown>>();
  const findUnique = jest.fn<() => Promise<unknown>>();
  const performEvaluation = jest.fn<() => Promise<unknown>>();

  const processor = new EvaluationProcessor(
    {
      evaluation: { update, findUnique },
    } as unknown as PrismaService,
    { performEvaluation } as unknown as EvaluateService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    update.mockResolvedValue({ id: 42 });
    findUnique.mockResolvedValue({ retry_count: 0 });
  });

  it('stores a completed evaluation result', async () => {
    performEvaluation.mockResolvedValue({
      cv_match_rate: 0.8,
      cv_feedback: 'Strong CV',
      project_score: 4.2,
      project_feedback: 'Strong project',
      overall_summary: 'Recommended',
    });

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: 42 },
      data: {
        status: 'processing',
        started_at: expect.any(Date),
      },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 42 },
      data: {
        status: 'completed',
        cv_match_rate: 0.8,
        cv_feedback: 'Strong CV',
        project_score: 4.2,
        project_feedback: 'Strong project',
        overall_summary: 'Recommended',
        completed_at: expect.any(Date),
      },
    });
  });

  it('stores failure details and rethrows the worker error', async () => {
    const error = Object.assign(new Error('upstream timeout'), {
      code: 'ETIMEDOUT',
    });
    performEvaluation.mockRejectedValue(error);
    findUnique.mockResolvedValue({ retry_count: 2 });

    await expect(processor.process(job)).rejects.toBe(error);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: { retry_count: true },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 42 },
      data: {
        status: 'failed',
        error_message: 'upstream timeout',
        retry_count: 3,
        completed_at: expect.any(Date),
      },
    });
  });
});
