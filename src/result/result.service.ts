import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { CVEvaluationResultSchema } from '../evaluate/dto/cv-evaluation-result.dto';
import { ProjectEvaluationResultSchema } from '../evaluate/dto/project-evaluation-result.dto';

export interface PartialEvaluationResult {
  cv_match_rate?: number;
  cv_feedback?: string;
  project_score?: number;
  project_feedback?: string;
}

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

    const partialResult = this.getPartialResult(
      evaluation.cv_checkpoint,
      evaluation.project_checkpoint,
    );
    const partialResponse = partialResult
      ? { partial_result: partialResult }
      : {};

    if (evaluation.status === 'queued' || evaluation.status === 'processing') {
      return {
        id: evaluation.id,
        status: evaluation.status,
        ...partialResponse,
      };
    }

    if (evaluation.status === 'failed') {
      return {
        id: evaluation.id,
        status: evaluation.status,
        error_code: evaluation.error_code,
        failed_stage: evaluation.failed_stage,
        error_message: evaluation.error_message,
        retry_count: evaluation.retry_count,
        ...partialResponse,
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

  private getPartialResult(
    cvCheckpoint: unknown,
    projectCheckpoint: unknown,
  ): PartialEvaluationResult | undefined {
    const cvResult = CVEvaluationResultSchema.safeParse(cvCheckpoint);
    const projectResult =
      ProjectEvaluationResultSchema.safeParse(projectCheckpoint);

    if (!cvResult.success && !projectResult.success) {
      return undefined;
    }

    return {
      ...(cvResult.success
        ? {
            cv_match_rate: cvResult.data.cv_match_rate,
            cv_feedback: cvResult.data.cv_feedback,
          }
        : {}),
      ...(projectResult.success
        ? {
            project_score: projectResult.data.project_score,
            project_feedback: projectResult.data.project_feedback,
          }
        : {}),
    };
  }
}
