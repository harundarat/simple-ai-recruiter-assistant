import { Injectable } from '@nestjs/common';
import { ChromaClient } from 'chromadb';
import { GoogleGeminiEmbeddingFunction } from '@chroma-core/google-gemini';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ChromaService {
  constructor(private readonly configService: ConfigService) {}

  async getCollection(collectionName: string) {
    const client = new ChromaClient();

    const collection = await client.getOrCreateCollection({
      name: collectionName,
      embeddingFunction: new GoogleGeminiEmbeddingFunction({
        apiKey: this.configService.get<string>('GOOGLE_GEMINI_API_KEY'),
      }),
    });

    return collection;
  }
}
