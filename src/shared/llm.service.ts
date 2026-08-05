import { GenerateContentParameters } from '@google/genai';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  GEMINI_CLIENT,
  GEMINI_RETRY_OPTIONS,
  GeminiGenerationOperation,
} from './gemini-client';
import type { GeminiClient } from './gemini-client';
import { RetryExecutor } from './retry.executor';
import type { RetryOptions } from './retry.executor';
import { CircuitBreakerExecutor } from './circuit-breaker.executor';

type LLMCallParameters = Omit<GenerateContentParameters, 'model'>;

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);

  constructor(
    @Inject(GEMINI_CLIENT) private readonly gemini: GeminiClient,
    private readonly retryExecutor: RetryExecutor,
    @Inject(GEMINI_RETRY_OPTIONS)
    private readonly retryOptions: RetryOptions,
    private readonly circuitBreakerExecutor: CircuitBreakerExecutor,
  ) {}

  async callGeminiFlashLiteWithPDF(
    operation: Extract<
      GeminiGenerationOperation,
      'CV_EVALUATION' | 'PROJECT_EVALUATION'
    >,
    pdfBuffer: Buffer,
    prompt: string,
    config?: LLMCallParameters['config'],
  ) {
    this.logger.debug(
      `Calling Gemini Flash Lite for ${operation} (PDF size: ${pdfBuffer.length} bytes)`,
    );

    return this.circuitBreakerExecutor.execute('gemini', operation, () =>
      this.retryExecutor.execute(
        operation,
        () =>
          this.gemini.generateContent(operation, {
            model: 'gemini-2.5-flash-lite',
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: 'application/pdf',
                      data: pdfBuffer.toString('base64'),
                    },
                  },
                  { text: prompt },
                ],
              },
            ],
            config,
          }),
        this.retryOptions,
      ),
    );
  }

  async callGeminiFlash(
    operation: Extract<GeminiGenerationOperation, 'FINAL_SYNTHESIS'>,
    params: LLMCallParameters,
  ) {
    this.logger.debug(`Calling Gemini Flash for ${operation}`);
    return this.circuitBreakerExecutor.execute('gemini', operation, () =>
      this.retryExecutor.execute(
        operation,
        () =>
          this.gemini.generateContent(operation, {
            model: 'gemini-2.5-flash',
            ...params,
          }),
        this.retryOptions,
      ),
    );
  }
}
