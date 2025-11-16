import { Injectable } from '@nestjs/common';
import { ChromaClient } from 'chromadb';
import { GoogleGeminiEmbeddingFunction } from '@chroma-core/google-gemini';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ChromaService {
  constructor(private readonly configService: ConfigService) { }

  async getCollection(collectionName: string) {
    const client = new ChromaClient();

    const collection = await client.getOrCreateCollection({
      name: collectionName,
      embeddingFunction: new GoogleGeminiEmbeddingFunction({
        apiKey: this.configService.getOrThrow<string>('GOOGLE_GEMINI_API_KEY'),
      }),
    });

    return collection;
  }

  async getJobDescription(jobTitle: string) {
    const collection = await this.getCollection('ground_truth');
    const results = await collection.query({
      queryTexts: [jobTitle],
      nResults: 1,
      where: {
        type: 'job_description',
      },
    });

    if (!results.documents[0] || !results.documents[0][0]) {
      throw new Error('Job description not found');
    }

    return results.documents[0][0];
  }

  async getCaseStudyBrief() {
    const collection = await this.getCollection('ground_truth');
    const results = await collection.query({
      queryTexts: ['case study brief project requirements'],
      nResults: 1,
      where: {
        type: 'case_study_brief',
      },
    });

    if (!results.documents[0] || !results.documents[0][0]) {
      throw new Error('Case study brief not found');
    }

    return results.documents[0][0];
  }

  async getScoringRubric(rubricType: 'cv' | 'project') {
    const collection = await this.getCollection('ground_truth');
    const results = await collection.query({
      queryTexts: [
        rubricType === 'cv'
          ? 'cv evaluation scoring rubric parameters'
          : 'project evaluation scoring rubric parameters',
      ],
      nResults: 1,
      where: {
        $and: [
          { type: 'rubric' },
          { for: rubricType },
        ],
      },
    });

    if (!results.documents[0] || !results.documents[0][0]) {
      throw new Error(`Scoring rubric for ${rubricType} not found`);
    }

    return results.documents[0][0];
  }
}
