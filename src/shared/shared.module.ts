import { Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { PrismaService } from './prisma.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LLMService } from './llm.service';
import { ChromaService } from './chroma.service';
import {
  GEMINI_CLIENT,
  GEMINI_RETRY_OPTIONS,
  GoogleGeminiClient,
} from './gemini-client';
import { RetryExecutor } from './retry.executor';
import type { RetryOptions } from './retry.executor';
import { FILE_STORE, KNOWLEDGE_BASE } from './infrastructure.tokens';
import { CircuitBreakerExecutor } from './circuit-breaker.executor';

@Module({
  imports: [ConfigModule],
  providers: [
    S3Service,
    PrismaService,
    GoogleGeminiClient,
    RetryExecutor,
    CircuitBreakerExecutor,
    { provide: GEMINI_CLIENT, useExisting: GoogleGeminiClient },
    {
      provide: GEMINI_RETRY_OPTIONS,
      useFactory: (configService: ConfigService): RetryOptions => ({
        maxAttempts: 2,
        initialDelayMs:
          configService.get<number>('GEMINI_RETRY_DELAY_MS') ?? 500,
        maxDelayMs: 2_000,
        backoffMultiplier: 2,
        timeoutMs: configService.get<number>('GEMINI_TIMEOUT_MS') ?? 90_000,
        jitterRatio: configService.get<number>('RETRY_JITTER_RATIO') ?? 0.2,
      }),
      inject: [ConfigService],
    },
    LLMService,
    ChromaService,
    { provide: FILE_STORE, useExisting: S3Service },
    { provide: KNOWLEDGE_BASE, useExisting: ChromaService },
  ],
  exports: [
    S3Service,
    PrismaService,
    LLMService,
    ChromaService,
    RetryExecutor,
    CircuitBreakerExecutor,
    GEMINI_CLIENT,
    GEMINI_RETRY_OPTIONS,
    FILE_STORE,
    KNOWLEDGE_BASE,
  ],
})
export class SharedModule {}
