import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ChromaClient, Collection } from 'chromadb';
import { ChromaService, GeminiEmbeddingFunction } from './chroma.service';
import type { GeminiClient } from './gemini-client';
import { RetryExecutor } from './retry.executor';
import { CircuitBreakerExecutor } from './circuit-breaker.executor';

jest.mock('chromadb');

const retryOptions = {
  maxAttempts: 2,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 2,
  timeoutMs: 1_000,
  jitterRatio: 0,
};

describe('ChromaService', () => {
  const query = jest.fn<() => Promise<any>>();
  const embed = jest.fn<GeminiClient['embed']>();
  const geminiClient = {
    generateContent: jest.fn<GeminiClient['generateContent']>(),
    embed,
  } satisfies GeminiClient;
  const collection = { query } as unknown as Collection;
  const getOrCreateCollection = jest.fn(() => Promise.resolve(collection));
  let service: ChromaService;

  beforeEach(() => {
    jest.clearAllMocks();
    embed.mockResolvedValue([[0.1, 0.2]]);
    jest
      .mocked(ChromaClient)
      .mockImplementation(
        () => ({ getOrCreateCollection }) as unknown as ChromaClient,
      );
    const values: Record<string, string | number> = {
      CHROMA_HOST: 'chroma.local',
      CHROMA_PORT: 8100,
      CHROMA_COLLECTION_NAME: 'ground_truth_test',
    };
    const config = {
      getOrThrow: jest.fn((name: string) => values[name]),
      get: jest.fn((name: string) => values[name]),
    } as unknown as ConfigService;
    service = new ChromaService(
      config,
      geminiClient,
      new RetryExecutor(),
      retryOptions,
      new CircuitBreakerExecutor({
        get: jest.fn((name: string) =>
          name === 'CIRCUIT_BREAKER_ENABLED' ? true : undefined,
        ),
      } as unknown as ConfigService),
    );
  });

  it('generates embeddings through the shared Gemini client', async () => {
    const embeddingFunction = new GeminiEmbeddingFunction(
      geminiClient,
      new RetryExecutor(),
      retryOptions,
      new CircuitBreakerExecutor({
        get: jest.fn((name: string) =>
          name === 'CIRCUIT_BREAKER_ENABLED' ? true : undefined,
        ),
      } as unknown as ConfigService),
    );

    await expect(embeddingFunction.generate(['Backend role'])).resolves.toEqual(
      [[0.1, 0.2]],
    );
    expect(embed).toHaveBeenCalledWith(['Backend role']);
    expect(embeddingFunction.defaultSpace()).toBe('cosine');
  });

  it('configures and reuses the configured collection', async () => {
    query
      .mockResolvedValueOnce({
        documents: [['Backend job description']],
        metadatas: [[{ role: 'backend' }]],
      })
      .mockResolvedValueOnce({ documents: [['Backend case study']] });

    await expect(
      service.getJobDescription('Backend Developer'),
    ).resolves.toEqual({
      document: 'Backend job description',
      role: 'backend',
    });
    await expect(service.getCaseStudyBrief('backend')).resolves.toBe(
      'Backend case study',
    );

    expect(ChromaClient).toHaveBeenCalledWith({
      host: 'chroma.local',
      port: 8100,
    });
    expect(getOrCreateCollection).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ground_truth_test' }),
    );
    expect(getOrCreateCollection).toHaveBeenCalledTimes(1);
  });

  it('scopes scoring rubrics by type and role', async () => {
    query.mockResolvedValue({ documents: [['CV rubric']] });

    await expect(service.getScoringRubric('cv', 'backend')).resolves.toBe(
      'CV rubric',
    );
    expect(query).toHaveBeenCalledWith({
      queryTexts: ['cv evaluation scoring rubric parameters'],
      nResults: 1,
      where: { $and: [{ type: 'rubric' }, { for: 'cv' }, { role: 'backend' }] },
    });
  });

  it('rejects job descriptions without role metadata', async () => {
    query.mockResolvedValue({
      documents: [['Job description']],
      metadatas: [[{}]],
    });

    await expect(service.getJobDescription('Backend')).rejects.toThrow(
      'Job description is missing role metadata',
    );
  });

  it('allows a failed collection lookup to be retried', async () => {
    getOrCreateCollection
      .mockRejectedValueOnce(new Error('Chroma unavailable'))
      .mockResolvedValueOnce(collection);
    query.mockResolvedValue({
      documents: [['Job description']],
      metadatas: [[{ role: 'backend' }]],
    });

    await expect(service.getJobDescription('Backend')).rejects.toThrow(
      'Chroma unavailable',
    );
    await expect(service.getJobDescription('Backend')).resolves.toEqual({
      document: 'Job description',
      role: 'backend',
    });
    expect(getOrCreateCollection).toHaveBeenCalledTimes(2);
  });
});
