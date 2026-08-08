import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Job, UnrecoverableError } from 'bullmq';
import { EvaluationProcessor } from './evaluate.processor';
import { EvaluateService } from './evaluate.service';
import { PrismaService } from '../shared/prisma.service';
import { PipelineError, toPipelineError } from '../shared/pipeline-error';
import { CircuitOpenError } from '../shared/circuit-breaker.executor';
import type { EvaluationJobData } from '../shared/infrastructure.tokens';

function createJob(attemptsMade = 0): Job<EvaluationJobData> {
  return {
    data: {
      evaluationId: 42,
      jobTitle: 'Backend Developer',
      cvId: 1,
      projectReportId: 2,
    },
    opts: { attempts: 3 },
    attemptsMade,
  } as Job<EvaluationJobData>;
}

describe('EvaluationProcessor', () => {
  const update = jest.fn<() => Promise<unknown>>();
  const findUnique = jest.fn<() => Promise<any>>();
  const performEvaluation = jest.fn<() => Promise<any>>();

  const processor = new EvaluationProcessor(
    { evaluation: { update, findUnique } } as unknown as PrismaService,
    { performEvaluation } as unknown as EvaluateService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    update.mockResolvedValue({ id: 42 });
    findUnique.mockResolvedValue({ retry_count: 0 });
  });

  it('stores a completed evaluation and clears prior errors', async () => {
    performEvaluation.mockResolvedValue({
      cv_match_rate: 0.8,
      cv_feedback: 'Strong CV',
      project_score: 4.2,
      project_feedback: 'Strong project',
      overall_summary: 'Recommended',
    });

    await expect(processor.process(createJob())).resolves.toBeUndefined();

    expect(performEvaluation).toHaveBeenCalledWith(
      42,
      'Backend Developer',
      1,
      2,
    );
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: 42 },
      data: {
        status: 'processing',
        started_at: expect.any(Date),
        completed_at: null,
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
        error_code: null,
        failed_stage: null,
        error_message: null,
        completed_at: expect.any(Date),
      },
    });
  });

  it('returns a retryable failure to queued between Bull attempts', async () => {
    const error = new PipelineError({
      errorCode: 'LLM_UNAVAILABLE',
      failedStage: 'CV_EVALUATION',
      retryable: true,
      cause: new Error('upstream timeout'),
    });
    performEvaluation.mockRejectedValue(error);

    await expect(processor.process(createJob(0))).rejects.toBe(error);
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 42 },
      data: {
        status: 'queued',
        error_code: 'LLM_UNAVAILABLE',
        failed_stage: 'CV_EVALUATION',
        error_message: 'AI evaluation service is temporarily unavailable',
        retry_count: 1,
        completed_at: null,
      },
    });
  });

  it('stores a final transient failure when Bull attempts are exhausted', async () => {
    const error = new PipelineError({
      errorCode: 'LLM_UNAVAILABLE',
      failedStage: 'CV_EVALUATION',
      retryable: true,
    });
    performEvaluation.mockRejectedValue(error);
    findUnique.mockResolvedValue({ retry_count: 2 });

    await expect(processor.process(createJob(2))).rejects.toBe(error);
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 42 },
      data: {
        status: 'failed',
        error_code: 'LLM_UNAVAILABLE',
        failed_stage: 'CV_EVALUATION',
        error_message: 'AI evaluation service is temporarily unavailable',
        retry_count: 3,
        completed_at: expect.any(Date),
      },
    });
  });

  it('uses UnrecoverableError for a permanent failure', async () => {
    performEvaluation.mockRejectedValue(
      new PipelineError({
        errorCode: 'LLM_INVALID_RESPONSE',
        failedStage: 'FINAL_SYNTHESIS',
        retryable: false,
      }),
    );

    await expect(processor.process(createJob())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 42 },
      data: {
        status: 'failed',
        error_code: 'LLM_INVALID_RESPONSE',
        failed_stage: 'FINAL_SYNTHESIS',
        error_message: 'AI evaluation service returned an invalid response',
        retry_count: 1,
        completed_at: expect.any(Date),
      },
    });
  });

  it('makes an open provider circuit terminal without another Bull attempt', async () => {
    performEvaluation.mockRejectedValue(
      toPipelineError(
        new CircuitOpenError('gemini', 'CV_EVALUATION'),
        'CV_EVALUATION',
      ),
    );

    await expect(processor.process(createJob())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 42 },
      data: {
        status: 'failed',
        error_code: 'LLM_UNAVAILABLE',
        failed_stage: 'CV_EVALUATION',
        error_message: 'AI evaluation service is temporarily unavailable',
        retry_count: 1,
        completed_at: expect.any(Date),
      },
    });
  });
});
