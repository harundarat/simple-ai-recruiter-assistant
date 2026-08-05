import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/shared/prisma.service';

@Injectable()
export class ResultService {
  constructor(private readonly prismaService: PrismaService) {}

  async getEvaluationResult(evaluationId: number) {
    const evaluation = await this.prismaService.evaluation.findUnique({
      where: { id: evaluationId },
    });

    if (!evaluation) {
      throw new NotFoundException('Evaluation not found');
    }

    // If status is queued or processing, return minimal info
    if (evaluation.status === 'queued' || evaluation.status === 'processing') {
      return {
        id: evaluation.id,
        status: evaluation.status,
      };
    }

    // If status is failed, include error message
    if (evaluation.status === 'failed') {
      return {
        id: evaluation.id,
        status: evaluation.status,
        error_message: evaluation.error_message,
      };
    }

    // If status is completed, return full results
    return {
      id: evaluation.id,
      status: evaluation.status,
      result: {
        cv_match_rate: evaluation.cv_match_rate,
        cv_feedback: evaluation.cv_feedback,
        project_score: evaluation.project_score,
        project_feedback: evaluation.project_feedback,
        overall_summary: evaluation.overall_summary,
      },
    };
  }
}
