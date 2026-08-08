import {
  GenerateContentParameters,
  GenerateContentResponse,
  GoogleGenAI,
} from '@google/genai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const GEMINI_CLIENT = Symbol('GEMINI_CLIENT');
export const GEMINI_RETRY_OPTIONS = Symbol('GEMINI_RETRY_OPTIONS');

export const GEMINI_MODELS = {
  FLASH_LITE: 'gemini-2.5-flash-lite',
  FLASH: 'gemini-2.5-flash',
  EMBEDDING: 'gemini-embedding-001',
} as const;

export function geminiRateLimitKey(model: string): string {
  return `gemini:${model}`;
}

export type GeminiOperation =
  'CV_EVALUATION' | 'PROJECT_EVALUATION' | 'FINAL_SYNTHESIS' | 'EMBEDDING';

export type GeminiGenerationOperation = Exclude<GeminiOperation, 'EMBEDDING'>;

export interface GeminiClient {
  generateContent(
    operation: GeminiGenerationOperation,
    params: GenerateContentParameters,
  ): Promise<Pick<GenerateContentResponse, 'text'>>;
  embed(texts: string[]): Promise<number[][]>;
}

@Injectable()
export class GoogleGeminiClient implements GeminiClient {
  private readonly client: GoogleGenAI;

  constructor(configService: ConfigService) {
    this.client = new GoogleGenAI({
      apiKey: configService.getOrThrow<string>('GOOGLE_GEMINI_API_KEY'),
    });
  }

  async generateContent(
    _operation: GeminiGenerationOperation,
    params: GenerateContentParameters,
  ): Promise<Pick<GenerateContentResponse, 'text'>> {
    return this.client.models.generateContent(params);
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.client.models.embedContent({
      model: GEMINI_MODELS.EMBEDDING,
      contents: texts,
    });
    const embeddings = response.embeddings?.map(({ values }) => values);

    if (
      !embeddings?.every((values): values is number[] => values !== undefined)
    ) {
      throw new Error('Gemini returned an incomplete embedding response');
    }

    return embeddings;
  }
}
