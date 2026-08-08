import { Writable } from 'node:stream';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  BadRequestException,
  Controller,
  Get,
  Logger as NestLogger,
  Module,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Logger, LoggerErrorInterceptor, LoggerModule } from 'nestjs-pino';
import { createPinoHttpOptions } from './logging';

class MemoryLogStream extends Writable {
  private output = '';

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.output += chunk.toString('utf8');
    callback();
  }

  records(): Array<Record<string, unknown>> {
    return this.output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  text(): string {
    return this.output;
  }
}

@Controller('logging-test')
class LoggingTestController {
  private readonly logger = new NestLogger(LoggingTestController.name);

  @Get('ok')
  ok(): { ok: true } {
    this.logger.log(
      {
        event: 'test.application_log',
        password: 'application-secret',
      },
      'Application log',
    );
    return { ok: true };
  }

  @Get('bad-request')
  badRequest(): never {
    throw new BadRequestException('Invalid test request');
  }

  @Get('error')
  error(): never {
    throw new Error('Unexpected test failure');
  }
}

describe('structured logging', () => {
  let app: INestApplication<Server>;
  let stream: MemoryLogStream;

  beforeAll(async () => {
    stream = new MemoryLogStream();

    @Module({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: [
            createPinoHttpOptions({
              environment: 'test',
              level: 'info',
            }),
            stream,
          ],
        }),
      ],
      controllers: [LoggingTestController],
      providers: [
        {
          provide: APP_INTERCEPTOR,
          useClass: LoggerErrorInterceptor,
        },
      ],
    })
    class LoggingTestModule {}

    const moduleFixture = await Test.createTestingModule({
      imports: [LoggingTestModule],
    }).compile();
    app = moduleFixture.createNestApplication<Server>();
    app.useLogger(app.get(Logger));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('emits correlated JSON without request secrets', async () => {
    const response = await request(app.getHttpServer())
      .get('/logging-test/ok?token=query-secret')
      .set('X-Request-ID', 'request-123')
      .set('Authorization', 'Bearer header-secret')
      .set('Cookie', 'session=cookie-secret')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('request-123');

    const records = stream.records();
    const applicationLog = records.find(
      (record) => record.event === 'test.application_log',
    );
    const requestLog = records.find(
      (record) =>
        record.event === 'http.request.completed' &&
        record.requestId === 'request-123',
    );

    expect(applicationLog).toMatchObject({
      level: 'info',
      service: 'evalu8',
      environment: 'test',
      context: LoggingTestController.name,
      requestId: 'request-123',
      password: '[REDACTED]',
      msg: 'Application log',
    });
    expect(requestLog).toMatchObject({
      level: 'info',
      requestId: 'request-123',
      req: { method: 'GET', path: '/logging-test/ok' },
      res: { statusCode: 200 },
    });
    expect(requestLog).toHaveProperty('responseTime');
    expect(requestLog).toHaveProperty('time');
    expect(stream.text()).not.toContain('query-secret');
    expect(stream.text()).not.toContain('header-secret');
    expect(stream.text()).not.toContain('cookie-secret');
  });

  it('replaces an invalid request ID with a UUID', async () => {
    const response = await request(app.getHttpServer())
      .get('/logging-test/ok')
      .set('X-Request-ID', 'invalid request id')
      .expect(200);

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it.each([
    ['/logging-test/bad-request', 400, 'warn'],
    ['/logging-test/error', 500, 'error'],
  ] as const)(
    'logs HTTP %s responses at %s level',
    async (path, status, level) => {
      const requestId = `request-${status}`;
      await request(app.getHttpServer())
        .get(path)
        .set('X-Request-ID', requestId)
        .expect(status);

      expect(
        stream
          .records()
          .find(
            (record) =>
              record.event === 'http.request.failed' &&
              record.requestId === requestId,
          ),
      ).toMatchObject({ level, err: expect.any(Object) });
    },
  );
});
