import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ChromaClient, Collection } from 'chromadb';
import { ChromaService, GeminiEmbeddingFunction } from './chroma.service';
import type { GeminiClient } from './gemini-client';
import { RetryExecutor } from './retry.executor';
import {
  CircuitBreakerExecutor,
  CircuitOpenError,
} from './circuit-breaker.executor';

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

  function createCircuitBreaker(failureThreshold = 3) {
    const values: Record<string, unknown> = {
      CIRCUIT_BREAKER_ENABLED: true,
      CIRCUIT_BREAKER_FAILURE_THRESHOLD: failureThreshold,
      CIRCUIT_BREAKER_RESET_TIMEOUT_MS: 30_000,
    };
    return new CircuitBreakerExecutor({
      get: jest.fn((name: string) => values[name]),
    } as unknown as ConfigService);
  }

  function createService(
    circuitBreaker = createCircuitBreaker(),
    options = retryOptions,
  ) {
    const values: Record<string, string | number> = {
      CHROMA_HOST: 'chroma.local',
      CHROMA_PORT: 8100,
      CHROMA_COLLECTION_NAME: 'ground_truth_test',
    };
    const config = {
      getOrThrow: jest.fn((name: string) => values[name]),
      get: jest.fn((name: string) => values[name]),
    } as unknown as ConfigService;
    return new ChromaService(
      config,
      geminiClient,
      new RetryExecutor(),
      options,
      circuitBreaker,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    embed.mockResolvedValue([[0.1, 0.2]]);
    jest
      .mocked(ChromaClient)
      .mockImplementation(
        () => ({ getOrCreateCollection }) as unknown as ChromaClient,
      );
    service = createService();
  });

  afterEach(() => jest.useRealTimers());

  it('generates embeddings through the shared Gemini client', async () => {
    const embeddingFunction = new GeminiEmbeddingFunction(
      geminiClient,
      new RetryExecutor(),
      retryOptions,
      createCircuitBreaker(),
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
      queryEmbeddings: [[0.1, 0.2]],
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

  it('does not count a Gemini embedding outage against Chroma', async () => {
    jest.useFakeTimers();
    service = createService(createCircuitBreaker(1), {
      ...retryOptions,
      maxAttempts: 1,
    });
    embed.mockRejectedValueOnce(
      Object.assign(new Error('Gemini unavailable'), { status: 503 }),
    );

    await expect(service.getJobDescription('Backend')).rejects.toThrow(
      'Gemini unavailable',
    );
    expect(getOrCreateCollection).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();

    jest.advanceTimersByTime(30_000);
    embed.mockResolvedValue([[0.1, 0.2]]);
    query.mockResolvedValue({
      documents: [['Job description']],
      metadatas: [[{ role: 'backend' }]],
    });
    await expect(service.getJobDescription('Backend')).resolves.toEqual({
      document: 'Job description',
      role: 'backend',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('opens the Chroma circuit after transient query failures', async () => {
    query.mockRejectedValue(
      Object.assign(new Error('Chroma unavailable'), { status: 503 }),
    );

    for (let call = 0; call < 3; call += 1) {
      await expect(service.getCaseStudyBrief('backend')).rejects.toThrow(
        'Chroma unavailable',
      );
    }
    await expect(service.getCaseStudyBrief('backend')).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('keeps missing ground truth validation outside the Chroma circuit', async () => {
    service = createService(createCircuitBreaker(1));
    query
      .mockResolvedValueOnce({ documents: [[]] })
      .mockResolvedValueOnce({ documents: [['Case study']] });

    await expect(service.getCaseStudyBrief('backend')).rejects.toThrow(
      'Case study brief not found',
    );
    await expect(service.getCaseStudyBrief('backend')).resolves.toBe(
      'Case study',
    );
    expect(query).toHaveBeenCalledTimes(2);
  });
});
