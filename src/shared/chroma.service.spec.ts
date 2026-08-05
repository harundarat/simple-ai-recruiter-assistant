import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { ChromaClient, Collection } from 'chromadb';
import { ChromaService, GeminiEmbeddingFunction } from './chroma.service';

jest.mock('chromadb');
jest.mock('@google/genai');

describe('ChromaService', () => {
  const query = jest.fn<() => Promise<unknown>>();
  const embedContent = jest.fn<() => Promise<unknown>>();
  const collection = { query } as unknown as Collection;
  const getOrCreateCollection = jest.fn(() => Promise.resolve(collection));
  let service: ChromaService;

  beforeEach(() => {
    jest.clearAllMocks();
    embedContent.mockResolvedValue({ embeddings: [{ values: [0.1, 0.2] }] });
    jest
      .mocked(GoogleGenAI)
      .mockImplementation(
        () => ({ models: { embedContent } }) as unknown as GoogleGenAI,
      );
    jest.mocked(ChromaClient).mockImplementation(
      () =>
        ({
          getOrCreateCollection,
        }) as unknown as ChromaClient,
    );
    const getOrThrow = jest.fn((name: string) => {
      const values: Record<string, string | number> = {
        CHROMA_HOST: 'chroma.local',
        CHROMA_PORT: 8100,
        GOOGLE_GEMINI_API_KEY: 'gemini-key',
      };
      return values[name];
    });
    service = new ChromaService({ getOrThrow } as unknown as ConfigService);
  });

  it('generates embeddings with the current Gemini SDK', async () => {
    const embeddingFunction = new GeminiEmbeddingFunction('gemini-key');

    await expect(embeddingFunction.generate(['Backend role'])).resolves.toEqual(
      [[0.1, 0.2]],
    );
    expect(GoogleGenAI).toHaveBeenLastCalledWith({ apiKey: 'gemini-key' });
    expect(embedContent).toHaveBeenCalledWith({
      model: 'gemini-embedding-001',
      contents: ['Backend role'],
    });
    expect(embeddingFunction.defaultSpace()).toBe('cosine');
  });

  it('rejects incomplete Gemini embedding responses', async () => {
    embedContent.mockResolvedValueOnce({ embeddings: [{}] });
    const embeddingFunction = new GeminiEmbeddingFunction('gemini-key');

    await expect(embeddingFunction.generate(['Backend role'])).rejects.toThrow(
      'Gemini returned an incomplete embedding response',
    );
  });

  it('configures and reuses one Chroma collection', async () => {
    query
      .mockResolvedValueOnce({
        documents: [['Backend job description']],
        metadatas: [[{ role: 'backend' }]],
      })
      .mockResolvedValueOnce({
        documents: [['Backend case study']],
        metadatas: [[]],
      });

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
    expect(getOrCreateCollection).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenNthCalledWith(2, {
      queryTexts: ['case study brief project requirements'],
      nResults: 1,
      where: {
        $and: [{ type: 'case_study_brief' }, { role: 'backend' }],
      },
    });
  });

  it('scopes scoring rubrics by type and role', async () => {
    query.mockResolvedValue({ documents: [['CV rubric']] });

    await expect(service.getScoringRubric('cv', 'backend')).resolves.toBe(
      'CV rubric',
    );
    expect(query).toHaveBeenCalledWith({
      queryTexts: ['cv evaluation scoring rubric parameters'],
      nResults: 1,
      where: {
        $and: [{ type: 'rubric' }, { for: 'cv' }, { role: 'backend' }],
      },
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
