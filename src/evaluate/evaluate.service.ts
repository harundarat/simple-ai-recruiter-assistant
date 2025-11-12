import { Injectable } from '@nestjs/common';
import { EvaluateRequestDto } from './evaluate.controller';

export interface EvaluationJob {
  id: string;
  fileId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  evaluationType: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class EvaluateService {
  private evaluationJobs: Map<string, EvaluationJob> = new Map();

  constructor() {}

  async startEvaluation(request: EvaluateRequestDto) {
    const evaluationId = this.generateEvaluationId();

    const job: EvaluationJob = {
      id: evaluationId,
      fileId: request.fileId,
      status: 'queued',
      evaluationType: request.evaluationType,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.evaluationJobs.set(evaluationId, job);

    // Simulate async processing
    this.processEvaluationAsync(evaluationId);

    return {
      evaluationId,
      status: 'queued',
      message: 'Evaluation started successfully',
      estimatedTime: '2-5 minutes',
    };
  }

  getEvaluationJob(id: string): EvaluationJob | undefined {
    return this.evaluationJobs.get(id);
  }

  private async processEvaluationAsync(evaluationId: string) {
    const job = this.evaluationJobs.get(evaluationId);
    if (!job) return;

    // Update status to processing
    job.status = 'processing';
    job.updatedAt = new Date();
    this.evaluationJobs.set(evaluationId, job);

    // Simulate processing time (2-5 seconds for demo)
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * 3000 + 2000),
    );

    // Update status to completed
    job.status = 'completed';
    job.updatedAt = new Date();
    this.evaluationJobs.set(evaluationId, job);
  }

  private generateEvaluationId(): string {
    return `eval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
