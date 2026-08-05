import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { ResultService } from './result.service';
import { PrismaService } from '../shared/prisma.service';

type EvaluationRecord = Awaited<
  ReturnType<PrismaService['evaluation']['findUnique']>
>;

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
      error_message: 'Gemini unavailable',
    });

    await expect(service.getEvaluationResult(42)).resolves.toEqual({
      id: 42,
      status: 'failed',
      error_message: 'Gemini unavailable',
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
