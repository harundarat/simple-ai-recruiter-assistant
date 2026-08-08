import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { ResultService } from './result.service';
import { PrismaService } from '../shared/prisma.service';

type EvaluationRecord = Awaited<
  ReturnType<PrismaService['evaluation']['findUnique']>
>;

const cvCheckpoint = {
  technical_skills_score: 4,
  technical_skills_reasoning: 'Strong backend skills',
  experience_score: 4,
  experience_reasoning: 'Relevant experience',
  achievements_score: 3,
  achievements_reasoning: 'Some measurable impact',
  cultural_fit_score: 5,
  cultural_fit_reasoning: 'Strong collaboration',
  cv_match_rate: 0.9,
  cv_feedback: 'Strong match',
};

const projectCheckpoint = {
  correctness_score: 5,
  correctness_reasoning: 'Requirements met',
  code_quality_score: 4,
  code_quality_reasoning: 'Well structured',
  resilience_score: 4,
  resilience_reasoning: 'Handles failures',
  documentation_score: 4,
  documentation_reasoning: 'Clear documentation',
  creativity_score: 3,
  creativity_reasoning: 'Useful additions',
  project_score: 4.5,
  project_feedback: 'Well built',
};

const completedEvaluation = {
  id: 42,
  cv_id: 1,
  project_report_id: 2,
  job_title: 'Backend Developer',
  status: 'completed',
  cv_match_rate: 0.9,
  cv_feedback: 'Strong match',
  project_score: 4.5,
  project_feedback: 'Well built',
  overall_summary: 'Recommended',
  cv_checkpoint: null,
  project_checkpoint: null,
  error_code: null,
  failed_stage: null,
  error_message: null,
  retry_count: 0,
  started_at: new Date('2026-01-01T00:00:00Z'),
  completed_at: new Date('2026-01-01T00:01:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:01:00Z'),
} satisfies NonNullable<EvaluationRecord>;

function createService(evaluation: EvaluationRecord) {
  const findUnique = jest.fn(() => Promise.resolve(evaluation));
  const prismaService = {
    evaluation: { findUnique },
  } as unknown as PrismaService;

  return { service: new ResultService(prismaService), findUnique };
}

describe('ResultService', () => {
  it.each(['queued', 'processing'] as const)(
    'returns minimal data for %s evaluations',
    async (status) => {
      const { service } = createService({ ...completedEvaluation, status });

      await expect(service.getEvaluationResult(42)).resolves.toEqual({
        id: 42,
        status,
      });
    },
  );

  it('returns the failure reason', async () => {
    const { service } = createService({
      ...completedEvaluation,
      status: 'failed',
      error_code: 'LLM_UNAVAILABLE',
      failed_stage: 'CV_EVALUATION',
      error_message: 'Gemini unavailable',
    });

    await expect(service.getEvaluationResult(42)).resolves.toEqual({
      id: 42,
      status: 'failed',
      error_code: 'LLM_UNAVAILABLE',
      failed_stage: 'CV_EVALUATION',
      error_message: 'Gemini unavailable',
      retry_count: 0,
    });
  });

  it('returns a summarized partial result for a failed evaluation', async () => {
    const { service } = createService({
      ...completedEvaluation,
      status: 'failed',
      error_code: 'LLM_INVALID_RESPONSE',
      failed_stage: 'FINAL_SYNTHESIS',
      error_message: 'Invalid synthesis',
      cv_checkpoint: cvCheckpoint,
      project_checkpoint: projectCheckpoint,
    });

    await expect(service.getEvaluationResult(42)).resolves.toEqual({
      id: 42,
      status: 'failed',
      error_code: 'LLM_INVALID_RESPONSE',
      failed_stage: 'FINAL_SYNTHESIS',
      error_message: 'Invalid synthesis',
      retry_count: 0,
      partial_result: {
        cv_match_rate: 0.9,
        cv_feedback: 'Strong match',
        project_score: 4.5,
        project_feedback: 'Well built',
      },
    });
  });

  it('returns only the available valid checkpoint while processing', async () => {
    const { service } = createService({
      ...completedEvaluation,
      status: 'processing',
      cv_checkpoint: { invalid: true },
      project_checkpoint: projectCheckpoint,
    });

    await expect(service.getEvaluationResult(42)).resolves.toEqual({
      id: 42,
      status: 'processing',
      partial_result: {
        project_score: 4.5,
        project_feedback: 'Well built',
      },
    });
  });

  it('returns completed evaluation fields', async () => {
    const { service } = createService(completedEvaluation);

    await expect(service.getEvaluationResult(42)).resolves.toEqual({
      id: 42,
      status: 'completed',
      result: {
        cv_match_rate: 0.9,
        cv_feedback: 'Strong match',
        project_score: 4.5,
        project_feedback: 'Well built',
        overall_summary: 'Recommended',
      },
    });
  });

  it('throws a 404 when the evaluation does not exist', async () => {
    const { service } = createService(null);

    await expect(service.getEvaluationResult(999)).rejects.toThrow(
      NotFoundException,
    );
  });
});
