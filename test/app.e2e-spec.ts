import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { EvaluateController } from '../src/evaluate/evaluate.controller';
import { EvaluateService } from '../src/evaluate/evaluate.service';
import { ResultController } from '../src/result/result.controller';
import { ResultService } from '../src/result/result.service';

describe('HTTP API (integration)', () => {
  let app: INestApplication<Server>;

  const startEvaluation = jest.fn(() =>
    Promise.resolve({ id: 42, status: 'queued' }),
  );
  const getEvaluationResult = jest.fn(() =>
    Promise.resolve({ id: 42, status: 'processing' }),
  );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController, EvaluateController, ResultController],
      providers: [
        AppService,
        {
          provide: EvaluateService,
          useValue: { startEvaluation },
        },
        {
          provide: ResultService,
          useValue: { getEvaluationResult },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication<Server>();
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / returns the service greeting', async () => {
    await request(app.getHttpServer()).get('/').expect(200, 'Hello World!');
  });

  it('POST /evaluate validates and forwards the request', async () => {
    await request(app.getHttpServer())
      .post('/evaluate')
      .send({
        job_title: 'Backend Developer',
        cv_id: 1,
        project_report_id: 2,
      })
      .expect(201, { id: 42, status: 'queued' });

    expect(startEvaluation).toHaveBeenCalledWith('Backend Developer', 1, 2);
  });

  it('POST /evaluate rejects invalid IDs before calling the service', async () => {
    await request(app.getHttpServer())
      .post('/evaluate')
      .send({
        job_title: 'Backend Developer',
        cv_id: 0,
        project_report_id: 2,
      })
      .expect(400);

    expect(startEvaluation).not.toHaveBeenCalled();
  });

  it('POST /evaluate rejects unknown properties', async () => {
    await request(app.getHttpServer())
      .post('/evaluate')
      .send({
        job_title: 'Backend Developer',
        cv_id: 1,
        project_report_id: 2,
        unexpected: true,
      })
      .expect(400);
  });

  it('GET /result/:id parses the identifier', async () => {
    await request(app.getHttpServer())
      .get('/result/42')
      .expect(200, { id: 42, status: 'processing' });

    expect(getEvaluationResult).toHaveBeenCalledWith(42);
  });

  it('GET /result/:id rejects non-numeric identifiers', async () => {
    await request(app.getHttpServer()).get('/result/not-a-number').expect(400);
    expect(getEvaluationResult).not.toHaveBeenCalled();
  });
});
