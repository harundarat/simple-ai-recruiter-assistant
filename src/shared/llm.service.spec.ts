import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { LLMService } from './llm.service';
import type { GeminiClient } from './gemini-client';
import { RetryExecutor } from './retry.executor';

describe('LLMService', () => {
  const generateContent = jest.fn<GeminiClient['generateContent']>();
  const client = {
    generateContent,
    embed: jest.fn<GeminiClient['embed']>(),
  } satisfies GeminiClient;
  const service = new LLMService(client, new RetryExecutor(), {
    maxAttempts: 2,
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 2,
    timeoutMs: 1_000,
    jitterRatio: 0,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    generateContent.mockResolvedValue({ text: 'generated' });
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
});
