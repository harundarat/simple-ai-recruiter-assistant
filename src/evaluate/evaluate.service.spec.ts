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

const cvEvaluation = {
  technical_skills_score: 4,
  technical_skills_reasoning: 'Strong backend skills',
  experience_score: 4,
  experience_reasoning: 'Relevant experience',
  achievements_score: 3,
  achievements_reasoning: 'Some measurable impact',
  cultural_fit_score: 5,
  cultural_fit_reasoning: 'Strong collaboration',
  cv_match_rate: 0.8,
  cv_feedback: 'Strong overall CV',
};

const projectEvaluation = {
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
  project_score: 4.2,
  project_feedback: 'Strong implementation',
};

const finalSynthesis = {
  overall_summary: 'Strong candidate for the role',
  key_strengths: ['Backend engineering', 'Communication'],
  areas_for_improvement: ['Production AI experience'],
  hiring_recommendation: 'hire',
  confidence_level: 4,
  confidence_reasoning: 'Evidence is consistent',
  interview_focus_areas: ['System design'],
  role_fit_percentage: 84,
  next_steps: 'Proceed to technical interview',
};

describe('EvaluateService pipeline', () => {
  const getFile = jest.fn<() => Promise<Buffer>>();
  const getJobDescription = jest.fn<() => Promise<unknown>>();
  const getCaseStudyBrief = jest.fn<() => Promise<string>>();
  const getScoringRubric = jest.fn<() => Promise<string>>();
  const callPDF = jest.fn<() => Promise<unknown>>();
  const callText = jest.fn<() => Promise<unknown>>();

  const service = new EvaluateService(
    {
      cV: {
        findUnique: jest.fn(() =>
          Promise.resolve({ id: 1, hosted_name: 'cv/file.pdf' }),
        ),
      },
      projectReport: {
        findUnique: jest.fn(() =>
          Promise.resolve({ id: 2, hosted_name: 'project/file.pdf' }),
        ),
      },
    } as unknown as PrismaService,
    { getFile } as unknown as S3Service,
    {
      callGeminiFlashLiteWithPDF: callPDF,
      callGeminiFlash: callText,
    } as unknown as LLMService,
    {
      getJobDescription,
      getCaseStudyBrief,
      getScoringRubric,
    } as unknown as ChromaService,
    {
      getOrThrow: jest.fn(() => 'candidate-bucket'),
    } as unknown as ConfigService,
    {} as Queue,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getFile.mockResolvedValue(Buffer.from('pdf'));
    getJobDescription.mockResolvedValue({
      document: 'Backend job description',
      role: 'backend',
    });
    getCaseStudyBrief.mockResolvedValue('Case study requirements');
    getScoringRubric.mockResolvedValue('Scoring rubric');
    callPDF
      .mockResolvedValueOnce({ text: JSON.stringify(cvEvaluation) })
      .mockResolvedValueOnce({ text: JSON.stringify(projectEvaluation) });
    callText.mockResolvedValue({ text: JSON.stringify(finalSynthesis) });
  });

  it('evaluates both documents against role-scoped ground truth', async () => {
    await expect(
      service.performEvaluation('Backend Developer', 1, 2),
    ).resolves.toEqual({
      cv_match_rate: 0.8,
      cv_feedback: 'Strong overall CV',
      project_score: 4.2,
      project_feedback: 'Strong implementation',
      overall_summary: 'Strong candidate for the role',
    });

    expect(getFile).toHaveBeenNthCalledWith(
      1,
      'candidate-bucket',
      'cv/file.pdf',
    );
    expect(getFile).toHaveBeenNthCalledWith(
      2,
      'candidate-bucket',
      'project/file.pdf',
    );
    expect(getCaseStudyBrief).toHaveBeenCalledWith('backend');
    expect(getScoringRubric).toHaveBeenCalledWith('cv', 'backend');
    expect(getScoringRubric).toHaveBeenCalledWith('project', 'backend');
    expect(callPDF).toHaveBeenCalledTimes(2);
    expect(callText).toHaveBeenCalledTimes(1);
  });

  it('rejects an out-of-range LLM score', async () => {
    callPDF.mockReset();
    callPDF.mockResolvedValue({
      text: JSON.stringify({ ...cvEvaluation, technical_skills_score: 10 }),
    });

    await expect(
      service.evaluateCV(Buffer.from('pdf'), 'Job', 'Rubric'),
    ).rejects.toThrow('Failed to evaluate CV');
  });

  it('rejects an empty LLM response', async () => {
    callPDF.mockReset();
    callPDF.mockResolvedValue({ text: undefined });

    await expect(
      service.evaluateProjectReport(Buffer.from('pdf'), 'Brief', 'Rubric'),
    ).rejects.toThrow('LLM response did not contain text output');
  });
});
