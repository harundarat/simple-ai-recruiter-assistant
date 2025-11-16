import { GoogleGenAI, GenerateContentParameters } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type LLMCallParameters = Omit<GenerateContentParameters, 'model'>;

@Injectable()
export class LLMService {
  private gemini: GoogleGenAI;

  constructor(private readonly configService: ConfigService) {
    this.gemini = new GoogleGenAI({
      apiKey: this.configService.getOrThrow<string>('GOOGLE_GEMINI_API_KEY'),
    });
  }

  async callGeminiFlashLiteWithPDF(
    pdfBuffer: Buffer,
    prompt: string,
    config?: LLMCallParameters['config'],
  ) {
    const response = await this.gemini.models.generateContent({
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
            {
              text: prompt,
            },
          ],
        },
      ],
      config,
    });

    return response;
  }

  async callGeminiFlash(params: LLMCallParameters) {
    const response = await this.gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      ...params,
    });

    return response;
  }
}
