import { Injectable } from '@nestjs/common';
import { EvaluateService, EvaluationJob } from '../evaluate/evaluate.service';

export interface EvaluationResult {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  fileId: string;
  evaluationType: string;
  createdAt: Date;
  updatedAt: Date;
  result?: {
    score: number;
    feedback: string;
    strengths: string[];
    improvements: string[];
    details: {
      skills: { found: string[]; missing: string[] };
      experience: { years: number; relevant: boolean };
      education: { level: string; relevant: boolean };
    };
  };
}

@Injectable()
export class ResultService {
  constructor(private readonly evaluateService: EvaluateService) {}

  async getEvaluationResult(id: string): Promise<EvaluationResult | null> {
    const job = this.evaluateService.getEvaluationJob(id);

    if (!job) {
      return null;
    }

    const result: EvaluationResult = {
      id: job.id,
      status: job.status,
      fileId: job.fileId,
      evaluationType: job.evaluationType,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };

    // If evaluation is completed, add mock results
    if (job.status === 'completed') {
      result.result = this.generateMockResult(job);
    }

    return result;
  }

  private generateMockResult(job: EvaluationJob) {
    // Mock evaluation results
    return {
      score: Math.floor(Math.random() * 40) + 60, // Score between 60-100
      feedback: 'Overall good candidate with relevant experience and skills.',
      strengths: [
        'Strong technical background',
        'Relevant work experience',
        'Good communication skills',
      ],
      improvements: [
        'Could benefit from additional certifications',
        'More leadership experience would be valuable',
      ],
      details: {
        skills: {
          found: ['JavaScript', 'Node.js', 'React', 'TypeScript'],
          missing: ['Python', 'Docker', 'Kubernetes'],
        },
        experience: {
          years: Math.floor(Math.random() * 8) + 2,
          relevant: true,
        },
        education: {
          level: "Bachelor's Degree",
          relevant: true,
        },
      },
    };
  }
}
