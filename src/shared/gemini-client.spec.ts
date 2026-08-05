import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { GoogleGenAI } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import { GoogleGeminiClient } from './gemini-client';

jest.mock('@google/genai');

describe('GoogleGeminiClient', () => {
  const generateContent = jest.fn<() => Promise<any>>();
  const embedContent = jest.fn<() => Promise<any>>();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(GoogleGenAI).mockImplementation(
      () =>
        ({
          models: { generateContent, embedContent },
        }) as unknown as GoogleGenAI,
    );
  });

  it('delegates generation and embedding to the production SDK', async () => {
    generateContent.mockResolvedValue({ text: 'generated' });
    embedContent.mockResolvedValue({ embeddings: [{ values: [0.1, 0.2] }] });
    const client = new GoogleGeminiClient({
      getOrThrow: jest.fn(() => 'gemini-key'),
    } as unknown as ConfigService);

    await expect(
      client.generateContent('FINAL_SYNTHESIS', {
        model: 'model',
        contents: 'prompt',
      }),
    ).resolves.toEqual({ text: 'generated' });
    await expect(client.embed(['text'])).resolves.toEqual([[0.1, 0.2]]);

    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'gemini-key' });
    expect(embedContent).toHaveBeenCalledWith({
      model: 'gemini-embedding-001',
      contents: ['text'],
    });
  });

  it('rejects incomplete embedding responses', async () => {
    embedContent.mockResolvedValue({ embeddings: [{}] });
    const client = new GoogleGeminiClient({
      getOrThrow: jest.fn(() => 'gemini-key'),
    } as unknown as ConfigService);

    await expect(client.embed(['text'])).rejects.toThrow(
      'Gemini returned an incomplete embedding response',
    );
  });
});
