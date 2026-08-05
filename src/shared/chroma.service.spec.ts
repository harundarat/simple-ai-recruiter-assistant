import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ChromaClient, Collection } from 'chromadb';
import { ChromaService } from './chroma.service';

jest.mock('chromadb');
jest.mock('@chroma-core/google-gemini');

describe('ChromaService', () => {
  const query = jest.fn<() => Promise<unknown>>();
  const collection = { query } as unknown as Collection;
  const getOrCreateCollection = jest.fn(() => Promise.resolve(collection));
  let service: ChromaService;

  beforeEach(() => {
    jest.clearAllMocks();
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
