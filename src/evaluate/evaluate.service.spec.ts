import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { EvaluateService } from './evaluate.service';
import { PrismaService } from '../shared/prisma.service';
import { S3Service } from '../shared/s3.service';
import { LLMService } from '../shared/llm.service';
import { ChromaService } from '../shared/chroma.service';

describe('EvaluateService.startEvaluation', () => {
  const cvFindUnique = jest.fn<() => Promise<unknown>>();
  const projectFindUnique = jest.fn<() => Promise<unknown>>();
  const evaluationCreate = jest.fn<() => Promise<unknown>>();
  const evaluationUpdate = jest.fn<() => Promise<unknown>>();
  const queueAdd = jest.fn<() => Promise<unknown>>();

  const prismaService = {
    cV: { findUnique: cvFindUnique },
    projectReport: { findUnique: projectFindUnique },
    evaluation: {
      create: evaluationCreate,
      update: evaluationUpdate,
    },
  } as unknown as PrismaService;

  const service = new EvaluateService(
    prismaService,
    {} as S3Service,
    {} as LLMService,
    {} as ChromaService,
    {} as ConfigService,
    { add: queueAdd } as unknown as Queue,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    cvFindUnique.mockResolvedValue({ id: 1 });
    projectFindUnique.mockResolvedValue({ id: 2, cv_id: 1 });
    evaluationCreate.mockResolvedValue({ id: 42 });
    evaluationUpdate.mockResolvedValue({ id: 42, status: 'failed' });
    queueAdd.mockResolvedValue(undefined);
  });

  it('creates and enqueues an evaluation', async () => {
    await expect(
      service.startEvaluation('Backend Developer', 1, 2),
    ).resolves.toEqual({ id: 42, status: 'queued' });

    expect(evaluationCreate).toHaveBeenCalledWith({
      data: {
        cv_id: 1,
        project_report_id: 2,
        job_title: 'Backend Developer',
        status: 'queued',
      },
    });
    expect(queueAdd).toHaveBeenCalledWith(
      'process-evaluation',
      {
        evaluationId: 42,
        jobTitle: 'Backend Developer',
        cvId: 1,
        projectReportId: 2,
      },
      {
        jobId: 'evaluation-42',
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    );
  });

  it('rejects a missing CV before creating an evaluation', async () => {
    cvFindUnique.mockResolvedValue(null);

    await expect(
      service.startEvaluation('Backend Developer', 1, 2),
    ).rejects.toThrow(new BadRequestException('CV not found'));
    expect(evaluationCreate).not.toHaveBeenCalled();
  });

  it('rejects a project report owned by another CV', async () => {
    projectFindUnique.mockResolvedValue({ id: 2, cv_id: 999 });

    await expect(
      service.startEvaluation('Backend Developer', 1, 2),
    ).rejects.toThrow('Project Report does not belong to the specified CV');
    expect(evaluationCreate).not.toHaveBeenCalled();
  });

  it('marks the record failed when enqueueing fails', async () => {
    queueAdd.mockRejectedValue(new Error('Redis unavailable'));

    await expect(
      service.startEvaluation('Backend Developer', 1, 2),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(evaluationUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        status: 'failed',
        error_message: 'Failed to enqueue evaluation: Redis unavailable',
        completed_at: expect.any(Date),
      },
    });
  });
});
