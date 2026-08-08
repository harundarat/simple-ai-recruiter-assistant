import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvaluateService } from './evaluate.service';
import { PrismaService } from '../shared/prisma.service';
import { S3Service } from '../shared/s3.service';
import { LLMService } from '../shared/llm.service';
import { ChromaService } from '../shared/chroma.service';
import { RetryExecutor } from '../shared/retry.executor';
import { PipelineError } from '../shared/pipeline-error';
import { CircuitBreakerExecutor } from '../shared/circuit-breaker.executor';

function createCircuitBreaker(failureThreshold = 3) {
  const values: Record<string, unknown> = {
    CIRCUIT_BREAKER_ENABLED: true,
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: failureThreshold,
    CIRCUIT_BREAKER_RESET_TIMEOUT_MS: 30_000,
  };
  return new CircuitBreakerExecutor({
    get: jest.fn((name: string) => values[name]),
  } as unknown as ConfigService);
}

describe('EvaluateService.startEvaluation', () => {
  const cvFindUnique = jest.fn<() => Promise<unknown>>();
  const projectFindUnique = jest.fn<() => Promise<unknown>>();
  const evaluationCreate = jest.fn<() => Promise<unknown>>();
  const evaluationUpdate = jest.fn<() => Promise<unknown>>();
  const queueAdd = jest.fn<() => Promise<void>>();

  const prismaService = {
    cV: { findUnique: cvFindUnique },
    projectReport: { findUnique: projectFindUnique },
    evaluation: {
      create: evaluationCreate,
      update: evaluationUpdate,
    },
  } as unknown as PrismaService;

  let service: EvaluateService;

  beforeEach(() => {
    jest.clearAllMocks();
    cvFindUnique.mockResolvedValue({ id: 1 });
    projectFindUnique.mockResolvedValue({ id: 2, cv_id: 1 });
    evaluationCreate.mockResolvedValue({ id: 42 });
    evaluationUpdate.mockResolvedValue({ id: 42, status: 'failed' });
    queueAdd.mockResolvedValue(undefined);
    service = new EvaluateService(
      prismaService,
      {} as S3Service,
      {} as LLMService,
      {} as ChromaService,
      { get: jest.fn(() => 0) } as unknown as ConfigService,
      { enqueue: queueAdd },
      new RetryExecutor(),
      createCircuitBreaker(),
    );
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
      {
        evaluationId: 42,
        jobTitle: 'Backend Developer',
        cvId: 1,
        projectReportId: 2,
      },
      'evaluation-42',
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
        error_code: 'QUEUE_UNAVAILABLE',
        failed_stage: 'ENQUEUE',
        error_message: 'Evaluation queue is temporarily unavailable',
        completed_at: expect.any(Date),
      },
    });
    expect(queueAdd).toHaveBeenCalledTimes(2);
  });

  it('counts each exhausted enqueue retry sequence once and fails fast when open', async () => {
    queueAdd.mockRejectedValue(
      Object.assign(new Error('Redis unavailable'), { status: 503 }),
    );

    for (let request = 0; request < 3; request += 1) {
      await expect(
        service.startEvaluation('Backend Developer', 1, 2),
      ).rejects.toThrow(ServiceUnavailableException);
    }
    let fourthError: unknown;
    try {
      await service.startEvaluation('Backend Developer', 1, 2);
    } catch (error: unknown) {
      fourthError = error;
    }

    expect(fourthError).toBeInstanceOf(ServiceUnavailableException);
    if (!(fourthError instanceof ServiceUnavailableException)) {
      throw new Error('Expected the fourth enqueue to return HTTP 503');
    }
    expect(fourthError.getStatus()).toBe(503);
    expect(fourthError.getResponse()).toEqual({
      error_code: 'QUEUE_UNAVAILABLE',
      failed_stage: 'ENQUEUE',
      message: 'Evaluation queue is temporarily unavailable',
    });
    expect(queueAdd).toHaveBeenCalledTimes(6);
    expect(evaluationUpdate).toHaveBeenCalledTimes(4);
    expect(evaluationUpdate).toHaveBeenLastCalledWith({
      where: { id: 42 },
      data: {
        status: 'failed',
        error_code: 'QUEUE_UNAVAILABLE',
        failed_stage: 'ENQUEUE',
        error_message: 'Evaluation queue is temporarily unavailable',
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
  const cvFindUnique = jest.fn<() => Promise<unknown>>();
  const projectFindUnique = jest.fn<() => Promise<unknown>>();
  const checkpointFindUnique = jest.fn<() => Promise<unknown>>();
  const checkpointUpdate = jest.fn<() => Promise<unknown>>();
  const getFile = jest.fn<() => Promise<Buffer>>();
  const getJobDescription = jest.fn<() => Promise<unknown>>();
  const getCaseStudyBrief = jest.fn<() => Promise<string>>();
  const getScoringRubric = jest.fn<() => Promise<string>>();
  const callPDF =
    jest.fn<
      (stage: 'CV_EVALUATION' | 'PROJECT_EVALUATION') => Promise<unknown>
    >();
  const callText = jest.fn<() => Promise<unknown>>();

  const service = new EvaluateService(
    {
      cV: { findUnique: cvFindUnique },
      projectReport: { findUnique: projectFindUnique },
      evaluation: {
        findUnique: checkpointFindUnique,
        update: checkpointUpdate,
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
    { enqueue: jest.fn(() => Promise.resolve()) },
    new RetryExecutor(),
    createCircuitBreaker(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    cvFindUnique.mockResolvedValue({ id: 1, hosted_name: 'cv/file.pdf' });
    projectFindUnique.mockResolvedValue({
      id: 2,
      hosted_name: 'project/file.pdf',
    });
    checkpointFindUnique.mockResolvedValue({
      cv_checkpoint: null,
      project_checkpoint: null,
    });
    checkpointUpdate.mockResolvedValue({ id: 42 });
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
      service.performEvaluation(42, 'Backend Developer', 1, 2),
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
    expect(checkpointUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        cv_checkpoint: cvEvaluation,
        cv_match_rate: 0.8,
        cv_feedback: 'Strong overall CV',
      },
    });
    expect(checkpointUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        project_checkpoint: projectEvaluation,
        project_score: 4.2,
        project_feedback: 'Strong implementation',
      },
    });
  });

  it('resumes from both checkpoints without loading external inputs', async () => {
    checkpointFindUnique.mockResolvedValue({
      cv_checkpoint: cvEvaluation,
      project_checkpoint: projectEvaluation,
    });

    await expect(
      service.performEvaluation(42, 'Backend Developer', 1, 2),
    ).resolves.toMatchObject({
      cv_match_rate: 0.8,
      project_score: 4.2,
      overall_summary: 'Strong candidate for the role',
    });

    expect(getJobDescription).not.toHaveBeenCalled();
    expect(getFile).not.toHaveBeenCalled();
    expect(callPDF).not.toHaveBeenCalled();
    expect(checkpointUpdate).not.toHaveBeenCalled();
    expect(callText).toHaveBeenCalledTimes(1);
  });

  it('only evaluates the missing stage when one checkpoint exists', async () => {
    checkpointFindUnique.mockResolvedValue({
      cv_checkpoint: cvEvaluation,
      project_checkpoint: null,
    });
    callPDF.mockReset();
    callPDF.mockResolvedValue({ text: JSON.stringify(projectEvaluation) });

    await service.performEvaluation(42, 'Backend Developer', 1, 2);

    expect(cvFindUnique).not.toHaveBeenCalled();
    expect(projectFindUnique).toHaveBeenCalledTimes(1);
    expect(getFile).toHaveBeenCalledTimes(1);
    expect(getScoringRubric).not.toHaveBeenCalledWith('cv', 'backend');
    expect(getScoringRubric).toHaveBeenCalledWith('project', 'backend');
    expect(callPDF).toHaveBeenCalledTimes(1);
    expect(checkpointUpdate).toHaveBeenCalledTimes(1);
    expect(checkpointUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        project_checkpoint: projectEvaluation,
        project_score: 4.2,
        project_feedback: 'Strong implementation',
      },
    });
  });

  it('stores a successful sibling checkpoint before propagating a failure', async () => {
    const cvError = new PipelineError({
      errorCode: 'LLM_UNAVAILABLE',
      failedStage: 'CV_EVALUATION',
      retryable: true,
    });
    callPDF.mockReset();
    callPDF.mockImplementation((stage) =>
      stage === 'CV_EVALUATION'
        ? Promise.reject(cvError)
        : Promise.resolve({ text: JSON.stringify(projectEvaluation) }),
    );

    await expect(
      service.performEvaluation(42, 'Backend Developer', 1, 2),
    ).rejects.toBe(cvError);

    expect(checkpointUpdate).toHaveBeenCalledTimes(1);
    expect(checkpointUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        project_checkpoint: projectEvaluation,
        project_score: 4.2,
        project_feedback: 'Strong implementation',
      },
    });
    expect(callText).not.toHaveBeenCalled();
  });

  it('recomputes an invalid checkpoint instead of reusing it', async () => {
    checkpointFindUnique.mockResolvedValue({
      cv_checkpoint: { unexpected: true },
      project_checkpoint: projectEvaluation,
    });
    callPDF.mockReset();
    callPDF.mockResolvedValue({ text: JSON.stringify(cvEvaluation) });

    await service.performEvaluation(42, 'Backend Developer', 1, 2);

    expect(cvFindUnique).toHaveBeenCalledTimes(1);
    expect(projectFindUnique).not.toHaveBeenCalled();
    expect(callPDF).toHaveBeenCalledTimes(1);
    expect(checkpointUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        cv_checkpoint: cvEvaluation,
        cv_match_rate: 0.8,
        cv_feedback: 'Strong overall CV',
      },
    });
  });

  it('maps a checkpoint write failure to a retryable checkpoint error', async () => {
    checkpointFindUnique.mockResolvedValue({
      cv_checkpoint: null,
      project_checkpoint: projectEvaluation,
    });
    callPDF.mockReset();
    callPDF.mockResolvedValue({ text: JSON.stringify(cvEvaluation) });
    checkpointUpdate.mockRejectedValue(new Error('database unavailable'));

    await expect(
      service.performEvaluation(42, 'Backend Developer', 1, 2),
    ).rejects.toMatchObject<Partial<PipelineError>>({
      errorCode: 'INTERNAL_ERROR',
      failedStage: 'SAVE_CHECKPOINT',
      retryable: true,
    });
  });

  it('rejects an out-of-range LLM score', async () => {
    callPDF.mockReset();
    callPDF.mockResolvedValue({
      text: JSON.stringify({ ...cvEvaluation, technical_skills_score: 10 }),
    });

    await expect(
      service.evaluateCV(Buffer.from('pdf'), 'Job', 'Rubric'),
    ).rejects.toMatchObject<Partial<PipelineError>>({
      errorCode: 'LLM_INVALID_RESPONSE',
      failedStage: 'CV_EVALUATION',
      retryable: false,
    });
  });

  it('rejects an empty LLM response', async () => {
    callPDF.mockReset();
    callPDF.mockResolvedValue({ text: undefined });

    await expect(
      service.evaluateProjectReport(Buffer.from('pdf'), 'Brief', 'Rubric'),
    ).rejects.toMatchObject<Partial<PipelineError>>({
      errorCode: 'LLM_INVALID_RESPONSE',
      failedStage: 'PROJECT_EVALUATION',
      retryable: false,
    });
  });
});
