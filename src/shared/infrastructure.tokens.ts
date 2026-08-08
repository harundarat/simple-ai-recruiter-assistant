import type { S3Client } from '@aws-sdk/client-s3';

export const FILE_STORE = Symbol('FILE_STORE');
export const KNOWLEDGE_BASE = Symbol('KNOWLEDGE_BASE');
export const EVALUATION_QUEUE = Symbol('EVALUATION_QUEUE');

export interface StoredFileReference {
  bucket: string;
  key: string;
}

export interface FileStore {
  getS3Client(): S3Client;
  getFile(bucket: string, key: string): Promise<Buffer>;
  deleteFiles(files: StoredFileReference[]): Promise<void>;
}

export interface KnowledgeBase {
  getJobDescription(jobTitle: string): Promise<{
    document: string;
    role: string;
  }>;
  getCaseStudyBrief(role: string): Promise<string>;
  getScoringRubric(rubricType: 'cv' | 'project', role: string): Promise<string>;
}

export interface EvaluationJobData {
  evaluationId: number;
  jobTitle: string;
  cvId: number;
  projectReportId: number;
  requestId?: string;
}

export interface EvaluationQueue {
  enqueue(data: EvaluationJobData, jobId: string): Promise<void>;
}
