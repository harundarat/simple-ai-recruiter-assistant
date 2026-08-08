import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { LLMService } from './llm.service';
import type { GeminiClient } from './gemini-client';
import { RetryExecutor } from './retry.executor';
import { ConfigService } from '@nestjs/config';
import {
  CircuitBreakerExecutor,
  CircuitOpenError,
} from './circuit-breaker.executor';
import { GeminiEmbeddingFunction } from './chroma.service';

const retryOptions = {
  maxAttempts: 2,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 2,
  timeoutMs: 1_000,
  jitterRatio: 0,
};

function createCircuitBreaker(failureThreshold = 3, resetTimeoutMs = 30_000) {
  const values: Record<string, unknown> = {
    CIRCUIT_BREAKER_ENABLED: true,
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: failureThreshold,
    CIRCUIT_BREAKER_RESET_TIMEOUT_MS: resetTimeoutMs,
  };
  return new CircuitBreakerExecutor({
    get: jest.fn((name: string) => values[name]),
  } as unknown as ConfigService);
}

describe('LLMService', () => {
  const generateContent = jest.fn<GeminiClient['generateContent']>();
  const client = {
    generateContent,
    embed: jest.fn<GeminiClient['embed']>(),
  } satisfies GeminiClient;
  let circuitBreaker: CircuitBreakerExecutor;
  let service: LLMService;

  beforeEach(() => {
    jest.clearAllMocks();
    generateContent.mockResolvedValue({ text: 'generated' });
    circuitBreaker = createCircuitBreaker();
    service = new LLMService(
      client,
      new RetryExecutor(),
      retryOptions,
      circuitBreaker,
    );
  });

  it('sends PDFs with an explicit operation to Flash Lite', async () => {
    await expect(
      service.callGeminiFlashLiteWithPDF(
        'CV_EVALUATION',
        Buffer.from('pdf'),
        'Evaluate',
        { temperature: 0.2 },
      ),
    ).resolves.toEqual({ text: 'generated' });

    expect(generateContent).toHaveBeenCalledWith('CV_EVALUATION', {
      model: 'gemini-2.5-flash-lite',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: Buffer.from('pdf').toString('base64'),
              },
            },
            { text: 'Evaluate' },
          ],
        },
      ],
      config: { temperature: 0.2 },
    });
  });

  it('sends final synthesis with an explicit operation to Flash', async () => {
    const params = {
      contents: [{ role: 'user' as const, parts: [{ text: 'Synthesize' }] }],
      config: { responseMimeType: 'application/json' },
    };

    await expect(
      service.callGeminiFlash('FINAL_SYNTHESIS', params),
    ).resolves.toEqual({ text: 'generated' });
    expect(generateContent).toHaveBeenCalledWith('FINAL_SYNTHESIS', {
      model: 'gemini-2.5-flash',
      ...params,
    });
  });

  it('uses at most two attempts for a transient Gemini failure', async () => {
    generateContent
      .mockRejectedValueOnce(
        Object.assign(new Error('timeout'), { status: 503 }),
      )
      .mockResolvedValueOnce({ text: 'recovered' });

    await expect(
      service.callGeminiFlash('FINAL_SYNTHESIS', { contents: 'prompt' }),
    ).resolves.toEqual({ text: 'recovered' });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('shares cooldown for Flash Lite operations but isolates other Gemini models', async () => {
    jest.useFakeTimers();
    try {
      const sharedRetryExecutor = new RetryExecutor();
      const modelRetryOptions = {
        ...retryOptions,
        maxAttempts: 1,
        initialDelayMs: 100,
        maxDelayMs: 100,
      };
      service = new LLMService(
        client,
        sharedRetryExecutor,
        modelRetryOptions,
        circuitBreaker,
      );
      const embedding = new GeminiEmbeddingFunction(
        client,
        sharedRetryExecutor,
        modelRetryOptions,
        circuitBreaker,
      );
      generateContent
        .mockRejectedValueOnce(
          Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }),
        )
        .mockResolvedValue({ text: 'recovered' });
      client.embed.mockResolvedValue([[0.1]]);

      await expect(
        service.callGeminiFlashLiteWithPDF(
          'CV_EVALUATION',
          Buffer.from('pdf'),
          'Evaluate',
        ),
      ).rejects.toThrow('RESOURCE_EXHAUSTED');

      await expect(
        service.callGeminiFlash('FINAL_SYNTHESIS', { contents: 'prompt' }),
      ).resolves.toEqual({ text: 'recovered' });
      await expect(embedding.generate(['role'])).resolves.toEqual([[0.1]]);

      const projectCall = service.callGeminiFlashLiteWithPDF(
        'PROJECT_EVALUATION',
        Buffer.from('pdf'),
        'Evaluate',
      );
      await Promise.resolve();
      expect(generateContent).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(100);
      await expect(projectCall).resolves.toEqual({ text: 'recovered' });
      expect(generateContent).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('counts an exhausted two-attempt retry sequence as one breaker failure', async () => {
    generateContent.mockRejectedValue(
      Object.assign(new Error('Gemini unavailable'), { status: 503 }),
    );

    for (let call = 0; call < 3; call += 1) {
      await expect(
        service.callGeminiFlash('FINAL_SYNTHESIS', { contents: 'prompt' }),
      ).rejects.toThrow('Gemini unavailable');
    }
    await expect(
      service.callGeminiFlash('FINAL_SYNTHESIS', { contents: 'prompt' }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(generateContent).toHaveBeenCalledTimes(6);
  });

  it('shares the Gemini circuit between generation and embedding', async () => {
    const failure = Object.assign(new Error('Gemini unavailable'), {
      status: 503,
    });
    generateContent.mockRejectedValue(failure);
    const embed = jest.fn<GeminiClient['embed']>().mockResolvedValue([[0.1]]);
    const embedding = new GeminiEmbeddingFunction(
      { ...client, embed },
      new RetryExecutor(),
      { ...retryOptions, maxAttempts: 1 },
      circuitBreaker,
    );
    service = new LLMService(
      client,
      new RetryExecutor(),
      { ...retryOptions, maxAttempts: 1 },
      circuitBreaker,
    );

    for (let call = 0; call < 3; call += 1) {
      await expect(
        service.callGeminiFlash('FINAL_SYNTHESIS', { contents: 'prompt' }),
      ).rejects.toThrow('Gemini unavailable');
    }

    await expect(embedding.generate(['role'])).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(embed).not.toHaveBeenCalled();
  });

  it('recovers through one half-open Gemini probe after cooldown', async () => {
    jest.useFakeTimers();
    try {
      circuitBreaker = createCircuitBreaker(1);
      service = new LLMService(
        client,
        new RetryExecutor(),
        { ...retryOptions, maxAttempts: 1 },
        circuitBreaker,
      );
      generateContent.mockRejectedValueOnce(
        Object.assign(new Error('Gemini unavailable'), { status: 503 }),
      );

      await expect(
        service.callGeminiFlash('FINAL_SYNTHESIS', { contents: 'prompt' }),
      ).rejects.toThrow('Gemini unavailable');
      await expect(
        service.callGeminiFlash('FINAL_SYNTHESIS', { contents: 'prompt' }),
      ).rejects.toBeInstanceOf(CircuitOpenError);

      jest.advanceTimersByTime(30_000);
      generateContent.mockResolvedValue({ text: 'recovered' });
      await expect(
        service.callGeminiFlash('FINAL_SYNTHESIS', { contents: 'prompt' }),
      ).resolves.toEqual({ text: 'recovered' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats SDK successes as healthy even when later parsing rejects the text', async () => {
    generateContent.mockResolvedValue({ text: 'not valid evaluation json' });

    for (let call = 0; call < 4; call += 1) {
      await expect(
        service.callGeminiFlash('FINAL_SYNTHESIS', { contents: 'prompt' }),
      ).resolves.toEqual({ text: 'not valid evaluation json' });
    }
    expect(generateContent).toHaveBeenCalledTimes(4);
  });
});
