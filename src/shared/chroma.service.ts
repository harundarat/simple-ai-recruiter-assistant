import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import {
  ChromaClient,
  Collection,
  EmbeddingFunction,
  EmbeddingFunctionSpace,
} from 'chromadb';
import { ConfigService } from '@nestjs/config';

export class GeminiEmbeddingFunction implements EmbeddingFunction {
  readonly name = 'google-gemini';
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generate(texts: string[]): Promise<number[][]> {
    const response = await this.client.models.embedContent({
      model: 'gemini-embedding-001',
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

  defaultSpace(): EmbeddingFunctionSpace {
    return 'cosine';
  }

  supportedSpaces(): EmbeddingFunctionSpace[] {
    return ['cosine', 'l2', 'ip'];
  }
}

@Injectable()
export class ChromaService {
  private readonly client: ChromaClient;
  private collectionPromise?: Promise<Collection>;

  constructor(private readonly configService: ConfigService) {
    this.client = new ChromaClient({
      host: configService.getOrThrow<string>('CHROMA_HOST'),
      port: configService.getOrThrow<number>('CHROMA_PORT'),
    });
  }

  async getCollection(collectionName: string): Promise<Collection> {
    this.collectionPromise ??= this.client.getOrCreateCollection({
      name: collectionName,
      embeddingFunction: new GeminiEmbeddingFunction(
        this.configService.getOrThrow<string>('GOOGLE_GEMINI_API_KEY'),
      ),
    });

    try {
      return await this.collectionPromise;
    } catch (error) {
      this.collectionPromise = undefined;
      throw error;
    }
  }

  async getJobDescription(
    jobTitle: string,
  ): Promise<{ document: string; role: string }> {
    const collection = await this.getCollection('ground_truth');
    const results = await collection.query({
      queryTexts: [jobTitle],
      nResults: 1,
      include: ['documents', 'metadatas'],
      where: {
        type: 'job_description',
      },
    });

    const document = results.documents[0]?.[0];
    const role = results.metadatas[0]?.[0]?.role;

    if (!document) {
      throw new Error('Job description not found');
    }

    if (typeof role !== 'string' || role.length === 0) {
      throw new Error('Job description is missing role metadata');
    }

    return { document, role };
  }

  async getCaseStudyBrief(role: string): Promise<string> {
    const collection = await this.getCollection('ground_truth');
    const results = await collection.query({
      queryTexts: ['case study brief project requirements'],
      nResults: 1,
      where: {
        $and: [{ type: 'case_study_brief' }, { role }],
      },
    });

    if (!results.documents[0] || !results.documents[0][0]) {
      throw new Error('Case study brief not found');
    }

    return results.documents[0][0];
  }

  async getScoringRubric(
    rubricType: 'cv' | 'project',
    role: string,
  ): Promise<string> {
    const collection = await this.getCollection('ground_truth');
    const results = await collection.query({
      queryTexts: [
        rubricType === 'cv'
          ? 'cv evaluation scoring rubric parameters'
          : 'project evaluation scoring rubric parameters',
      ],
      nResults: 1,
      where: {
        $and: [{ type: 'rubric' }, { for: rubricType }, { role }],
      },
    });

    if (!results.documents[0] || !results.documents[0][0]) {
      throw new Error(`Scoring rubric for ${rubricType} not found`);
    }

    return results.documents[0][0];
  }
}
