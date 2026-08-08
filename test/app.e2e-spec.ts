import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { getQueueToken } from '@nestjs/bullmq';
import { Injectable, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';
import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import request from 'supertest';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/prisma.service';
import { S3Service } from '../src/shared/s3.service';
import { ChromaService } from '../src/shared/chroma.service';
import { GEMINI_CLIENT } from '../src/shared/gemini-client';
import {
  EVALUATION_QUEUE,
  FILE_STORE,
  KNOWLEDGE_BASE,
} from '../src/shared/infrastructure.tokens';
import type {
  EvaluationJobData,
  EvaluationQueue,
  FileStore,
  KnowledgeBase,
  StoredFileReference,
} from '../src/shared/infrastructure.tokens';
import { BullEvaluationQueueGateway } from '../src/evaluate/evaluation-queue.gateway';
import { FakeGeminiClient } from './support/fake-gemini-client';
import type { FakeGeminiMode } from './support/fake-gemini-client';

@Injectable()
class ControlledFileStore implements FileStore {
  transientFailuresRemaining = 0;

  constructor(private readonly delegate: S3Service) {}

  getS3Client() {
    return this.delegate.getS3Client();
  }

  async getFile(bucket: string, key: string): Promise<Buffer> {
    if (this.transientFailuresRemaining > 0) {
      this.transientFailuresRemaining -= 1;
      throw Object.assign(new Error('Fake transient file store failure'), {
        status: 503,
      });
    }
    return this.delegate.getFile(bucket, key);
  }

  deleteFiles(files: StoredFileReference[]): Promise<void> {
    return this.delegate.deleteFiles(files);
  }
}

@Injectable()
class ControlledKnowledgeBase implements KnowledgeBase {
  transientFailuresRemaining = 0;

  constructor(private readonly delegate: ChromaService) {}

  async getJobDescription(jobTitle: string) {
    this.maybeFail();
    return this.delegate.getJobDescription(jobTitle);
  }

  async getCaseStudyBrief(role: string) {
    this.maybeFail();
    return this.delegate.getCaseStudyBrief(role);
  }

  async getScoringRubric(type: 'cv' | 'project', role: string) {
    this.maybeFail();
    return this.delegate.getScoringRubric(type, role);
  }

  private maybeFail(): void {
    if (this.transientFailuresRemaining > 0) {
      this.transientFailuresRemaining -= 1;
      throw Object.assign(new Error('Fake transient Chroma failure'), {
        status: 503,
      });
    }
  }
}

@Injectable()
class ControlledEvaluationQueue implements EvaluationQueue {
  failuresRemaining = 0;
  enqueueAttempts = 0;
  lastEnqueuedData: EvaluationJobData | undefined;

  constructor(private readonly delegate: BullEvaluationQueueGateway) {}

  async enqueue(data: EvaluationJobData, jobId: string): Promise<void> {
    this.enqueueAttempts += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw Object.assign(new Error('Fake Redis unavailable'), { status: 503 });
    }
    this.lastEnqueuedData = data;
    await this.delegate.enqueue(data, jobId);
  }
}

interface UploadResponse {
  cv_id: number;
  project_report_id: number;
  message: string;
}

interface StartEvaluationResponse {
  id: number;
  status: 'queued';
}

interface ResultResponse {
  id: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  error_code?: string;
  failed_stage?: string;
  error_message?: string;
  retry_count?: number;
  result?: {
    cv_match_rate: number;
    cv_feedback: string;
    project_score: number;
    project_feedback: string;
    overall_summary: string;
  };
  partial_result?: {
    cv_match_rate?: number;
    cv_feedback?: string;
    project_score?: number;
    project_feedback?: string;
  };
}

describe('Evaluation pipeline with real local infrastructure', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaService;
  let s3: S3Service;
  let queue: Queue;
  let fileStore: ControlledFileStore;
  let knowledgeBase: ControlledKnowledgeBase;
  let evaluationQueue: ControlledEvaluationQueue;
  const fakeGemini = new FakeGeminiClient();
  const bucket = process.env.S3_BUCKET_NAME ?? 'evalu8-e2e';
  const cvFixture = resolve(process.cwd(), 'seed/Resume Harun Al Rasyid.pdf');
  const reportFixture = resolve(
    process.cwd(),
    'seed/Project Report - Harun Al Rasyid.pdf',
  );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GEMINI_CLIENT)
      .useValue(fakeGemini)
      .overrideProvider(FILE_STORE)
      .useClass(ControlledFileStore)
      .overrideProvider(KNOWLEDGE_BASE)
      .useClass(ControlledKnowledgeBase)
      .overrideProvider(EVALUATION_QUEUE)
      .useClass(ControlledEvaluationQueue)
      .compile();

    app = moduleFixture.createNestApplication<Server>();
    app.useLogger(app.get(Logger));
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    app.enableShutdownHooks();
    await app.init();

    prisma = app.get(PrismaService);
    s3 = app.get(S3Service);
    queue = app.get<Queue>(getQueueToken('evaluation'));
    fileStore = app.get(FILE_STORE);
    knowledgeBase = app.get(KNOWLEDGE_BASE);
    evaluationQueue = app.get(EVALUATION_QUEUE);

    const collection = await app.get(ChromaService).getCollection();
    await collection.upsert({
      ids: ['job-backend', 'brief-backend', 'rubric-cv', 'rubric-project'],
      documents: [
        'Backend Developer building reliable TypeScript and PostgreSQL services',
        'Build and document a resilient recruitment evaluation API',
        'Score CV technical skills, experience, achievements, and collaboration',
        'Score project correctness, quality, resilience, documentation, and creativity',
      ],
      metadatas: [
        { type: 'job_description', role: 'backend' },
        { type: 'case_study_brief', role: 'backend' },
        { type: 'rubric', for: 'cv', role: 'backend' },
        { type: 'rubric', for: 'project', role: 'backend' },
      ],
    });
  });

  beforeEach(() => {
    fakeGemini.reset();
    fileStore.transientFailuresRemaining = 0;
    knowledgeBase.transientFailuresRemaining = 0;
    evaluationQueue.failuresRemaining = 0;
    evaluationQueue.enqueueAttempts = 0;
    evaluationQueue.lastEnqueuedData = undefined;
  });

  afterAll(async () => {
    if (queue) {
      await queue.resume();
    }
    if (app) {
      await app.close();
    }
  });

  it('uploads PDFs to MinIO and completes the full deterministic pipeline', async () => {
    const uploaded = await uploadPair();
    const [cv, report] = await Promise.all([
      prisma.cV.findUniqueOrThrow({ where: { id: uploaded.cv_id } }),
      prisma.projectReport.findUniqueOrThrow({
        where: { id: uploaded.project_report_id },
      }),
    ]);
    await expect(
      s3
        .getS3Client()
        .send(new HeadObjectCommand({ Bucket: bucket, Key: cv.hosted_name })),
    ).resolves.toBeDefined();
    await expect(
      s3
        .getS3Client()
        .send(
          new HeadObjectCommand({ Bucket: bucket, Key: report.hosted_name }),
        ),
    ).resolves.toBeDefined();

    const evaluationId = await startEvaluation(uploaded);
    const result = await pollResult(evaluationId);

    expect(result).toEqual({
      id: evaluationId,
      status: 'completed',
      result: {
        cv_match_rate: 0.88,
        cv_feedback: 'Deterministic CV feedback',
        project_score: 4.4,
        project_feedback: 'Deterministic project feedback',
        overall_summary: 'Deterministic recommendation: proceed to interview',
      },
    });
    await expect(
      prisma.evaluation.findUniqueOrThrow({ where: { id: evaluationId } }),
    ).resolves.toMatchObject({
      status: 'completed',
      retry_count: 0,
      error_code: null,
      failed_stage: null,
      cv_checkpoint: expect.objectContaining({
        cv_match_rate: 0.88,
        cv_feedback: 'Deterministic CV feedback',
      }),
      project_checkpoint: expect.objectContaining({
        project_score: 4.4,
        project_feedback: 'Deterministic project feedback',
      }),
    });
  });

  it('preserves the HTTP request ID in the evaluation job', async () => {
    const uploaded = await uploadPair();
    const response = await request(app.getHttpServer())
      .post('/evaluate')
      .set('X-Request-ID', 'e2e-request-123')
      .send({
        job_title: 'Backend Developer',
        cv_id: uploaded.cv_id,
        project_report_id: uploaded.project_report_id,
      })
      .expect(201);
    const body = response.body as StartEvaluationResponse;

    expect(response.headers['x-request-id']).toBe('e2e-request-123');
    expect(evaluationQueue.lastEnqueuedData).toMatchObject({
      requestId: 'e2e-request-123',
      evaluationId: body.id,
    });
    await expect(pollResult(body.id)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('recovers from one transient Gemini failure inside the local retry', async () => {
    fakeGemini.setBehavior('CV_EVALUATION', 'transient', 1);
    const evaluationId = await startEvaluation(await uploadPair());

    await expect(pollResult(evaluationId)).resolves.toMatchObject({
      status: 'completed',
    });
    expect(fakeGemini.getAttemptCount('CV_EVALUATION')).toBe(2);
    await expect(
      prisma.evaluation.findUniqueOrThrow({ where: { id: evaluationId } }),
    ).resolves.toMatchObject({ retry_count: 0 });
  });

  it('honors a Gemini rate-limit hint and recovers inside the local retry', async () => {
    fakeGemini.setBehavior('CV_EVALUATION', 'rate-limited', 1);
    const evaluationId = await startEvaluation(await uploadPair());

    await expect(pollResult(evaluationId)).resolves.toMatchObject({
      status: 'completed',
    });
    expect(fakeGemini.getAttemptCount('CV_EVALUATION')).toBe(2);
    await expect(
      prisma.evaluation.findUniqueOrThrow({ where: { id: evaluationId } }),
    ).resolves.toMatchObject({ retry_count: 0 });
  });

  it('exhausts two local Gemini calls across all three Bull attempts', async () => {
    fakeGemini.setBehavior('CV_EVALUATION', 'persistent-transient');
    const evaluationId = await startEvaluation(await uploadPair());

    await expect(pollResult(evaluationId)).resolves.toMatchObject({
      status: 'failed',
      error_code: 'LLM_UNAVAILABLE',
      failed_stage: 'CV_EVALUATION',
      error_message: 'AI evaluation service is temporarily unavailable',
      retry_count: 3,
      partial_result: {
        project_score: 4.4,
        project_feedback: 'Deterministic project feedback',
      },
    });
    expect(fakeGemini.getAttemptCount('CV_EVALUATION')).toBe(6);
    expect(fakeGemini.getAttemptCount('PROJECT_EVALUATION')).toBe(1);
    expect(fakeGemini.getAttemptCount('FINAL_SYNTHESIS')).toBe(0);
  });

  it('reuses both checkpoints when final synthesis needs a Bull retry', async () => {
    fakeGemini.setBehavior('FINAL_SYNTHESIS', 'transient', 2);
    const evaluationId = await startEvaluation(await uploadPair());

    await expect(pollResult(evaluationId)).resolves.toMatchObject({
      status: 'completed',
    });
    expect(fakeGemini.getAttemptCount('CV_EVALUATION')).toBe(1);
    expect(fakeGemini.getAttemptCount('PROJECT_EVALUATION')).toBe(1);
    expect(fakeGemini.getAttemptCount('FINAL_SYNTHESIS')).toBe(3);
    await expect(
      prisma.evaluation.findUniqueOrThrow({ where: { id: evaluationId } }),
    ).resolves.toMatchObject({ retry_count: 1 });
  });

  it.each(['malformed-json', 'schema-invalid'] as FakeGeminiMode[])(
    'fails permanently for a %s Gemini response without Bull retry',
    async (mode) => {
      fakeGemini.setBehavior('FINAL_SYNTHESIS', mode);
      const evaluationId = await startEvaluation(await uploadPair());

      await expect(pollResult(evaluationId)).resolves.toMatchObject({
        status: 'failed',
        error_code: 'LLM_INVALID_RESPONSE',
        failed_stage: 'FINAL_SYNTHESIS',
        retry_count: 1,
        partial_result: {
          cv_match_rate: 0.88,
          cv_feedback: 'Deterministic CV feedback',
          project_score: 4.4,
          project_feedback: 'Deterministic project feedback',
        },
      });
      expect(fakeGemini.getAttemptCount('FINAL_SYNTHESIS')).toBe(1);
    },
  );

  it('fails permanently when a MinIO object is deleted before processing', async () => {
    await queue.pause();
    const uploaded = await uploadPair();
    const evaluationId = await startEvaluation(uploaded);
    const cv = await prisma.cV.findUniqueOrThrow({
      where: { id: uploaded.cv_id },
    });
    await fileStore.deleteFiles([{ bucket, key: cv.hosted_name }]);
    await queue.resume();

    await expect(pollResult(evaluationId)).resolves.toMatchObject({
      status: 'failed',
      error_code: 'STORAGE_OBJECT_NOT_FOUND',
      failed_stage: 'LOAD_FILES',
      retry_count: 1,
    });
  });

  it('uses a Bull retry after one transient file-store failure', async () => {
    fileStore.transientFailuresRemaining = 1;
    const evaluationId = await startEvaluation(await uploadPair());

    await expect(pollResult(evaluationId)).resolves.toMatchObject({
      status: 'completed',
    });
    await expect(
      prisma.evaluation.findUniqueOrThrow({ where: { id: evaluationId } }),
    ).resolves.toMatchObject({ retry_count: 1 });
  });

  it('uses a Bull retry after one transient Chroma failure', async () => {
    knowledgeBase.transientFailuresRemaining = 1;
    const evaluationId = await startEvaluation(await uploadPair());

    await expect(pollResult(evaluationId)).resolves.toMatchObject({
      status: 'completed',
    });
    await expect(
      prisma.evaluation.findUniqueOrThrow({ where: { id: evaluationId } }),
    ).resolves.toMatchObject({ retry_count: 1 });
  });

  it('returns structured 503 and stores failure when enqueueing stays unavailable', async () => {
    evaluationQueue.failuresRemaining = 2;
    const uploaded = await uploadPair();
    const response = await request(app.getHttpServer())
      .post('/evaluate')
      .send({
        job_title: 'Backend Developer',
        cv_id: uploaded.cv_id,
        project_report_id: uploaded.project_report_id,
      })
      .expect(503);

    expect(response.body as unknown).toMatchObject({
      error_code: 'QUEUE_UNAVAILABLE',
      failed_stage: 'ENQUEUE',
      message: 'Evaluation queue is temporarily unavailable',
    });
    expect(evaluationQueue.enqueueAttempts).toBe(2);
    await expect(
      prisma.evaluation.findFirstOrThrow({
        where: {
          cv_id: uploaded.cv_id,
          project_report_id: uploaded.project_report_id,
        },
        orderBy: { id: 'desc' },
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      error_code: 'QUEUE_UNAVAILABLE',
      failed_stage: 'ENQUEUE',
    });
  });

  it('rejects missing/invalid PDFs and mismatched pairs without jobs or orphan objects', async () => {
    const initialObjectCount = await objectCount();
    await request(app.getHttpServer())
      .post('/upload')
      .attach('cv', cvFixture, {
        filename: 'candidate.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    expect(await objectCount()).toBe(initialObjectCount);

    await request(app.getHttpServer())
      .post('/upload')
      .attach('cv', Buffer.from('not a pdf'), {
        filename: 'candidate.txt',
        contentType: 'text/plain',
      })
      .attach('project_report', reportFixture, {
        filename: 'project.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    expect(await objectCount()).toBe(initialObjectCount);

    const first = await uploadPair();
    const second = await uploadPair();
    const evaluationsBefore = await prisma.evaluation.count();
    await request(app.getHttpServer())
      .post('/evaluate')
      .send({
        job_title: 'Backend Developer',
        cv_id: first.cv_id,
        project_report_id: second.project_report_id,
      })
      .expect(400);
    expect(await prisma.evaluation.count()).toBe(evaluationsBefore);
  });

  async function uploadPair(): Promise<UploadResponse> {
    const response = await request(app.getHttpServer())
      .post('/upload')
      .attach('cv', cvFixture, {
        filename: 'candidate.pdf',
        contentType: 'application/pdf',
      })
      .attach('project_report', reportFixture, {
        filename: 'project.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    return response.body as UploadResponse;
  }

  async function startEvaluation(uploaded: UploadResponse): Promise<number> {
    const response = await request(app.getHttpServer())
      .post('/evaluate')
      .send({
        job_title: 'Backend Developer',
        cv_id: uploaded.cv_id,
        project_report_id: uploaded.project_report_id,
      })
      .expect(201);
    return (response.body as { id: number }).id;
  }

  async function pollResult(evaluationId: number): Promise<ResultResponse> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const response = await request(app.getHttpServer())
        .get(`/result/${evaluationId}`)
        .expect(200);
      const body = response.body as ResultResponse;
      if (body.status === 'completed' || body.status === 'failed') {
        return body;
      }
      await new Promise((resolvePoll) => setTimeout(resolvePoll, 25));
    }
    throw new Error(`Evaluation ${evaluationId} did not finish before timeout`);
  }

  async function objectCount(): Promise<number> {
    const response = await s3
      .getS3Client()
      .send(new ListObjectsV2Command({ Bucket: bucket }));
    return response.Contents?.length ?? 0;
  }
});
