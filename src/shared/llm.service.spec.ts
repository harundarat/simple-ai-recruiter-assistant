import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { LLMService } from './llm.service';

jest.mock('@google/genai');

describe('LLMService', () => {
  const generateContent = jest.fn<() => Promise<unknown>>();
  let service: LLMService;

  beforeEach(() => {
    jest.clearAllMocks();
    generateContent.mockResolvedValue({ text: 'generated' });
    jest.mocked(GoogleGenAI).mockImplementation(
      () =>
        ({
          models: { generateContent },
        }) as unknown as GoogleGenAI,
    );
    service = new LLMService({
      getOrThrow: jest.fn(() => 'gemini-key'),
    } as unknown as ConfigService);
  });

  it('sends PDFs to the configured Flash Lite model', async () => {
    await expect(
      service.callGeminiFlashLiteWithPDF(Buffer.from('pdf'), 'Evaluate', {
        temperature: 0.2,
      }),
    ).resolves.toEqual({ text: 'generated' });

    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'gemini-key' });
    expect(generateContent).toHaveBeenCalledWith({
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

  it('sends text synthesis to the Flash model', async () => {
    const params = {
      contents: [{ role: 'user' as const, parts: [{ text: 'Synthesize' }] }],
      config: { responseMimeType: 'application/json' },
    };

    await expect(service.callGeminiFlash(params)).resolves.toEqual({
      text: 'generated',
    });
    expect(generateContent).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
      ...params,
    });
  });
});
