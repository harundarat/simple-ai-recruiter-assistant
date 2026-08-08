import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { EvaluateService } from './evaluate.service';
import { EvaluationJobData } from '../shared/infrastructure.tokens';
import { PipelineError } from '../shared/pipeline-error';
import { runWithLogContext } from '../shared/log-context';

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
    const evaluationId = job.data.evaluationId;
    const jobId = String(job.id ?? `evaluation-${evaluationId}`);
    return runWithLogContext(
      {
        requestId: job.data.requestId ?? jobId,
        evaluationId,
        jobId,
        jobAttempt: job.attemptsMade + 1,
      },
      () => this.processWithContext(job),
    );
  }

  private async processWithContext(job: Job<EvaluationJobData>): Promise<void> {
    const { evaluationId, jobTitle, cvId, projectReportId } = job.data;

    await this.prismaService.evaluation.update({
      where: { id: evaluationId },
      data: {
        status: 'processing',
        started_at: new Date(),
        completed_at: null,
      },
    });

    try {
      const result = await this.evaluateService.performEvaluation(
        evaluationId,
        jobTitle,
        cvId,
        projectReportId,
      );

      await this.prismaService.evaluation.update({
        where: { id: evaluationId },
        data: {
          status: 'completed',
          cv_match_rate: result.cv_match_rate,
          cv_feedback: result.cv_feedback,
          project_score: result.project_score,
          project_feedback: result.project_feedback,
          overall_summary: result.overall_summary,
          error_code: null,
          failed_stage: null,
          error_message: null,
          completed_at: new Date(),
        },
      });
      this.logger.log(
        { event: 'evaluation.completed', evaluationId },
        'Evaluation completed successfully',
      );
    } catch (cause: unknown) {
      const error =
        cause instanceof PipelineError
          ? cause
          : new PipelineError({
              errorCode: 'INTERNAL_ERROR',
              failedStage: 'LOAD_FILES',
              retryable: false,
              cause,
            });
      const currentEvaluation = await this.prismaService.evaluation.findUnique({
        where: { id: evaluationId },
        select: { retry_count: true },
      });
      const retryCount = (currentEvaluation?.retry_count ?? 0) + 1;
      const maxAttempts =
        typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
      const finalAttempt = job.attemptsMade + 1 >= maxAttempts;
      const willRetry = error.retryable && !finalAttempt;

      this.logger.error(
        {
          event: 'evaluation.processing_failed',
          evaluationId,
          processingAttempt: retryCount,
          errorCode: error.errorCode,
          failedStage: error.failedStage,
          retryable: error.retryable,
          willRetry,
          err: error.cause ?? cause,
        },
        'Evaluation processing attempt failed',
      );

      await this.prismaService.evaluation.update({
        where: { id: evaluationId },
        data: {
          status: willRetry ? 'queued' : 'failed',
          error_code: error.errorCode,
          failed_stage: error.failedStage,
          error_message: error.publicMessage,
          retry_count: retryCount,
          completed_at: willRetry ? null : new Date(),
        },
      });

      if (!error.retryable) {
        throw new UnrecoverableError(error.publicMessage);
      }
      throw error;
    }
  }
}
