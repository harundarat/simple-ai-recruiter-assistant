import { Inject, Injectable } from '@nestjs/common';
import {
  ChromaClient,
  Collection,
  EmbeddingFunction,
  EmbeddingFunctionSpace,
} from 'chromadb';
import { ConfigService } from '@nestjs/config';
import { GEMINI_CLIENT, GEMINI_RETRY_OPTIONS } from './gemini-client';
import type { GeminiClient } from './gemini-client';
import { RetryExecutor } from './retry.executor';
import type { RetryOptions } from './retry.executor';
import { GroundTruthNotFoundError } from './pipeline-error';
import { KnowledgeBase } from './infrastructure.tokens';

export class GeminiEmbeddingFunction implements EmbeddingFunction {
  readonly name = 'google-gemini';

  constructor(
    private readonly client: GeminiClient,
    private readonly retryExecutor: RetryExecutor,
    private readonly retryOptions: RetryOptions,
  ) {}

  generate(texts: string[]): Promise<number[][]> {
    return this.retryExecutor.execute(
      'EMBEDDING',
      () => this.client.embed(texts),
      this.retryOptions,
    );
  }

  defaultSpace(): EmbeddingFunctionSpace {
    return 'cosine';
  }

  supportedSpaces(): EmbeddingFunctionSpace[] {
    return ['cosine', 'l2', 'ip'];
  }
}

@Injectable()
export class ChromaService implements KnowledgeBase {
  private readonly client: ChromaClient;
  private readonly collectionName: string;
  private collectionPromise?: Promise<Collection>;

  constructor(
    configService: ConfigService,
    @Inject(GEMINI_CLIENT) private readonly geminiClient: GeminiClient,
    private readonly retryExecutor: RetryExecutor,
    @Inject(GEMINI_RETRY_OPTIONS)
    private readonly geminiRetryOptions: RetryOptions,
  ) {
    this.client = new ChromaClient({
      host: configService.getOrThrow<string>('CHROMA_HOST'),
      port: configService.getOrThrow<number>('CHROMA_PORT'),
    });
    this.collectionName =
      configService.get<string>('CHROMA_COLLECTION_NAME') ?? 'ground_truth';
  }

  async getCollection(
    collectionName = this.collectionName,
  ): Promise<Collection> {
    this.collectionPromise ??= this.client.getOrCreateCollection({
      name: collectionName,
      embeddingFunction: new GeminiEmbeddingFunction(
        this.geminiClient,
        this.retryExecutor,
        this.geminiRetryOptions,
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
    const collection = await this.getCollection();
    const results = await collection.query({
      queryTexts: [jobTitle],
      nResults: 1,
      include: ['documents', 'metadatas'],
      where: { type: 'job_description' },
    });

    const document = results.documents[0]?.[0];
    const role = results.metadatas[0]?.[0]?.role;

    if (!document) {
      throw new GroundTruthNotFoundError('Job description not found');
    }
    if (typeof role !== 'string' || role.length === 0) {
      throw new GroundTruthNotFoundError(
        'Job description is missing role metadata',
      );
    }

    return { document, role };
  }

  async getCaseStudyBrief(role: string): Promise<string> {
    const collection = await this.getCollection();
    const results = await collection.query({
      queryTexts: ['case study brief project requirements'],
      nResults: 1,
      where: { $and: [{ type: 'case_study_brief' }, { role }] },
    });

    const document = results.documents[0]?.[0];
    if (!document) {
      throw new GroundTruthNotFoundError('Case study brief not found');
    }
    return document;
  }

  async getScoringRubric(
    rubricType: 'cv' | 'project',
    role: string,
  ): Promise<string> {
    const collection = await this.getCollection();
    const results = await collection.query({
      queryTexts: [
        rubricType === 'cv'
          ? 'cv evaluation scoring rubric parameters'
          : 'project evaluation scoring rubric parameters',
      ],
      nResults: 1,
      where: { $and: [{ type: 'rubric' }, { for: rubricType }, { role }] },
    });

    const document = results.documents[0]?.[0];
    if (!document) {
      throw new GroundTruthNotFoundError(
        `Scoring rubric for ${rubricType} not found`,
      );
    }
    return document;
  }
}
