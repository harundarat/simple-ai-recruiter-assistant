import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/shared/prisma.service';
import { EvaluateService } from './evaluate.service';

interface EvaluationJobData {
  evaluationId: number;
  jobTitle: string;
  cvId: number;
  projectReportId: number;
}

@Processor('evaluation', { concurrency: 1 })
@Injectable()
export class EvaluationProcessor extends WorkerHost {
  private readonly logger = new Logger(EvaluationProcessor.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly evaluateService: EvaluateService,
  ) {
    super();
  }

  async process(job: Job<EvaluationJobData>): Promise<void> {
    const { evaluationId, jobTitle, cvId, projectReportId } = job.data;

    this.logger.log(`Processing evaluation ${evaluationId} for job: ${jobTitle}`);

    try {
      // Update status to processing
      await this.prismaService.evaluation.update({
        where: { id: evaluationId },
        data: {
          status: 'processing',
          started_at: new Date(),
        },
      });

      // Execute the evaluation process
      const result = await this.evaluateService.performEvaluation(
        jobTitle,
        cvId,
        projectReportId,
      );

      // Update with results
      await this.prismaService.evaluation.update({
        where: { id: evaluationId },
        data: {
          status: 'completed',
          cv_match_rate: result.cv_match_rate,
          cv_feedback: result.cv_feedback,
          project_score: result.project_score,
          project_feedback: result.project_feedback,
          overall_summary: result.overall_summary,
          completed_at: new Date(),
        },
      });

      this.logger.log(`Evaluation ${evaluationId} completed successfully`);
    } catch (error) {
      this.logger.error(`Evaluation ${evaluationId} failed:`, error);

      // Get current retry count
      const currentEvaluation = await this.prismaService.evaluation.findUnique({
        where: { id: evaluationId },
        select: { retry_count: true },
      });

      // Update with error
      await this.prismaService.evaluation.update({
        where: { id: evaluationId },
        data: {
          status: 'failed',
          error_message: error instanceof Error ? error.message : String(error),
          retry_count: (currentEvaluation?.retry_count || 0) + 1,
          completed_at: new Date(),
        },
      });

      throw error;
    }
  }
}






