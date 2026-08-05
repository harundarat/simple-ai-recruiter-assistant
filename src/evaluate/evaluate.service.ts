import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodType } from 'zod';
import { PrismaService } from '../shared/prisma.service';
import { LLMService } from '../shared/llm.service';
import { CV_EVALUATION_SYSTEM_PROMPT } from './prompt/cv-evaluation.prompt';
import { PROJECT_EVALUATION_SYSTEM_PROMPT } from './prompt/project-report-evaluation.prompt';
import { FINAL_SYNTHESIS_SYSTEM_PROMPT } from './prompt/final-synthesis.prompt';
import {
  CVEvaluationResult,
  CVEvaluationResultSchema,
} from './dto/cv-evaluation-result.dto';
import {
  ProjectEvaluationResult,
  ProjectEvaluationResultSchema,
} from './dto/project-evaluation-result.dto';
import {
  FinalSynthesisResult,
  FinalSynthesisResultSchema,
} from './dto/final-synthesis-result.dto';
import { EvaluationStatus } from '../generated/prisma/enums';
import { getErrorMessage } from '../shared/retry.utils';
import {
  EVALUATION_QUEUE,
  FILE_STORE,
  KNOWLEDGE_BASE,
} from '../shared/infrastructure.tokens';
import type {
  EvaluationQueue,
  FileStore,
  KnowledgeBase,
} from '../shared/infrastructure.tokens';
import { RetryExecutor } from '../shared/retry.executor';
import {
  invalidLlmResponse,
  PipelineError,
  PipelineStage,
  toPipelineError,
} from '../shared/pipeline-error';

@Injectable()
export class EvaluateService {
  private readonly logger = new Logger(EvaluateService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @Inject(FILE_STORE) private readonly fileStore: FileStore,
    private readonly llmService: LLMService,
    @Inject(KNOWLEDGE_BASE) private readonly knowledgeBase: KnowledgeBase,
    private readonly configService: ConfigService,
    @Inject(EVALUATION_QUEUE)
    private readonly evaluationQueue: EvaluationQueue,
    private readonly retryExecutor: RetryExecutor,
  ) {}

  async startEvaluation(
    jobTitle: string,
    cvId: number,
    projectReportId: number,
  ): Promise<{ id: number; status: EvaluationStatus }> {
    const [cv, projectReport] = await Promise.all([
      this.prismaService.cV.findUnique({ where: { id: cvId } }),
      this.prismaService.projectReport.findUnique({
        where: { id: projectReportId },
      }),
    ]);

    if (!cv) {
      throw new BadRequestException('CV not found');
    }
    if (!projectReport) {
      throw new BadRequestException('Project Report not found');
    }
    if (projectReport.cv_id !== cvId) {
      throw new BadRequestException(
        'Project Report does not belong to the specified CV',
      );
    }

    const evaluation = await this.prismaService.evaluation.create({
      data: {
        cv_id: cvId,
        project_report_id: projectReportId,
        job_title: jobTitle,
        status: 'queued',
      },
    });
    const jobId = `evaluation-${evaluation.id}`;

    try {
      await this.retryExecutor.execute(
        'ENQUEUE',
        () =>
          this.evaluationQueue.enqueue(
            { evaluationId: evaluation.id, jobTitle, cvId, projectReportId },
            jobId,
          ),
        {
          maxAttempts: 2,
          initialDelayMs:
            this.configService.get<number>('ENQUEUE_RETRY_DELAY_MS') ?? 250,
          maxDelayMs: 1_000,
          backoffMultiplier: 2,
          timeoutMs:
            this.configService.get<number>('ENQUEUE_TIMEOUT_MS') ?? 5_000,
          jitterRatio:
            this.configService.get<number>('RETRY_JITTER_RATIO') ?? 0.2,
          shouldRetry: () => true,
        },
      );
    } catch (cause: unknown) {
      const error = toPipelineError(cause, 'ENQUEUE');
      this.logger.error('Failed to enqueue evaluation', {
        evaluationId: evaluation.id,
        cause: getErrorMessage(cause),
      });
      await this.prismaService.evaluation.update({
        where: { id: evaluation.id },
        data: {
          status: 'failed',
          error_code: error.errorCode,
          failed_stage: error.failedStage,
          error_message: error.publicMessage,
          completed_at: new Date(),
        },
      });

      throw new ServiceUnavailableException(
        {
          error_code: error.errorCode,
          failed_stage: error.failedStage,
          message: error.publicMessage,
        },
        { cause },
      );
    }

    return { id: evaluation.id, status: 'queued' };
  }

  async performEvaluation(
    jobTitle: string,
    cvId: number,
    projectReportId: number,
  ) {
    const [cv, projectReport] = await Promise.all([
      this.prismaService.cV.findUnique({ where: { id: cvId } }),
      this.prismaService.projectReport.findUnique({
        where: { id: projectReportId },
      }),
    ]);

    if (!cv?.hosted_name || !projectReport?.hosted_name) {
      throw new PipelineError({
        errorCode: 'STORAGE_OBJECT_NOT_FOUND',
        failedStage: 'LOAD_FILES',
        retryable: false,
      });
    }

    const bucketName = this.configService.getOrThrow<string>('S3_BUCKET_NAME');
    let cvBuffer: Buffer;
    let projectReportBuffer: Buffer;
    try {
      [cvBuffer, projectReportBuffer] = await Promise.all([
        this.fileStore.getFile(bucketName, cv.hosted_name),
        this.fileStore.getFile(bucketName, projectReport.hosted_name),
      ]);
    } catch (error: unknown) {
      throw toPipelineError(error, 'LOAD_FILES');
    }

    let jobDescription: { document: string; role: string };
    let caseStudyBrief: string;
    let cvRubric: string;
    let projectRubric: string;
    try {
      jobDescription = await this.knowledgeBase.getJobDescription(jobTitle);
      [caseStudyBrief, cvRubric, projectRubric] = await Promise.all([
        this.knowledgeBase.getCaseStudyBrief(jobDescription.role),
        this.knowledgeBase.getScoringRubric('cv', jobDescription.role),
        this.knowledgeBase.getScoringRubric('project', jobDescription.role),
      ]);
    } catch (error: unknown) {
      throw toPipelineError(error, 'LOAD_GROUND_TRUTH');
    }

    const [cvEvaluation, projectEvaluation] = await Promise.all([
      this.evaluateCV(cvBuffer, jobDescription.document, cvRubric),
      this.evaluateProjectReport(
        projectReportBuffer,
        caseStudyBrief,
        projectRubric,
      ),
    ]);
    const finalSynthesis = await this.synthesizeFinalResult(
      cvEvaluation,
      projectEvaluation,
    );

    return {
      cv_match_rate: cvEvaluation.cv_match_rate,
      cv_feedback: cvEvaluation.cv_feedback,
      project_score: projectEvaluation.project_score,
      project_feedback: projectEvaluation.project_feedback,
      overall_summary: finalSynthesis.overall_summary,
    };
  }

  async evaluateCV(
    cvBuffer: Buffer,
    jobDescription: string,
    cvRubric: string,
  ): Promise<CVEvaluationResult> {
    const prompt = `
${CV_EVALUATION_SYSTEM_PROMPT}

JOB DESCRIPTION:
${jobDescription}

SCORING RUBRIC:
${cvRubric}

Please analyze the attached CV PDF and evaluate the candidate based on the job description and scoring rubric above. Provide a structured JSON response.
`;

    return this.runLlmStage('CV_EVALUATION', async () => {
      const response = await this.llmService.callGeminiFlashLiteWithPDF(
        'CV_EVALUATION',
        cvBuffer,
        prompt,
        { temperature: 0.3, responseMimeType: 'application/json' },
      );
      return this.parseLlmResponse(response.text, CVEvaluationResultSchema);
    });
  }

  async evaluateProjectReport(
    projectReportBuffer: Buffer,
    caseStudyBrief: string,
    projectRubric: string,
  ): Promise<ProjectEvaluationResult> {
    const prompt = `
${PROJECT_EVALUATION_SYSTEM_PROMPT}

CASE STUDY BRIEF (Requirements):
${caseStudyBrief}

SCORING RUBRIC:
${projectRubric}

Please analyze the attached Project Report PDF and evaluate the candidate's implementation based on the case study requirements and scoring rubric above. Provide a structured JSON response.
`;

    return this.runLlmStage('PROJECT_EVALUATION', async () => {
      const response = await this.llmService.callGeminiFlashLiteWithPDF(
        'PROJECT_EVALUATION',
        projectReportBuffer,
        prompt,
        { temperature: 0.3, responseMimeType: 'application/json' },
      );
      return this.parseLlmResponse(
        response.text,
        ProjectEvaluationResultSchema,
      );
    });
  }

  async synthesizeFinalResult(
    cvEvaluation: CVEvaluationResult,
    projectEvaluation: ProjectEvaluationResult,
  ): Promise<FinalSynthesisResult> {
    const prompt = `
${FINAL_SYNTHESIS_SYSTEM_PROMPT}

CV EVALUATION RESULTS:
- Match Rate: ${cvEvaluation.cv_match_rate}
- Technical Skills Score: ${cvEvaluation.technical_skills_score}/5 - ${cvEvaluation.technical_skills_reasoning}
- Experience Score: ${cvEvaluation.experience_score}/5 - ${cvEvaluation.experience_reasoning}
- Achievements Score: ${cvEvaluation.achievements_score}/5 - ${cvEvaluation.achievements_reasoning}
- Cultural Fit Score: ${cvEvaluation.cultural_fit_score}/5 - ${cvEvaluation.cultural_fit_reasoning}
- CV Feedback: ${cvEvaluation.cv_feedback}

PROJECT EVALUATION RESULTS:
- Project Score: ${projectEvaluation.project_score}/5
- Correctness Score: ${projectEvaluation.correctness_score}/5 - ${projectEvaluation.correctness_reasoning}
- Code Quality Score: ${projectEvaluation.code_quality_score}/5 - ${projectEvaluation.code_quality_reasoning}
- Resilience Score: ${projectEvaluation.resilience_score}/5 - ${projectEvaluation.resilience_reasoning}
- Documentation Score: ${projectEvaluation.documentation_score}/5 - ${projectEvaluation.documentation_reasoning}
- Creativity Score: ${projectEvaluation.creativity_score}/5 - ${projectEvaluation.creativity_reasoning}
- Project Feedback: ${projectEvaluation.project_feedback}

Based on the above evaluations, provide a comprehensive final synthesis that integrates both CV and project assessment.
`;

    return this.runLlmStage('FINAL_SYNTHESIS', async () => {
      const response = await this.llmService.callGeminiFlash(
        'FINAL_SYNTHESIS',
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { temperature: 0.3, responseMimeType: 'application/json' },
        },
      );
      return this.parseLlmResponse(response.text, FinalSynthesisResultSchema);
    });
  }

  private async runLlmStage<T>(
    stage: Extract<
      PipelineStage,
      'CV_EVALUATION' | 'PROJECT_EVALUATION' | 'FINAL_SYNTHESIS'
    >,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      this.logger.error(`${stage} failed`, {
        cause: getErrorMessage(error),
      });
      throw toPipelineError(error, stage);
    }
  }

  private parseLlmResponse<T>(text: string | undefined, schema: ZodType<T>): T {
    if (!text) {
      throw invalidLlmResponse('LLM response did not contain text output');
    }

    try {
      const payload: unknown = JSON.parse(text);
      return schema.parse(payload);
    } catch (error: unknown) {
      throw invalidLlmResponse(
        'LLM response was not valid JSON or schema',
        error,
      );
    }
  }
}
