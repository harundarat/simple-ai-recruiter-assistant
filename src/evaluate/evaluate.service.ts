import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from 'src/shared/prisma.service';
import { S3Service } from 'src/shared/s3.service';
import { LLMService } from 'src/shared/llm.service';
import { ChromaService } from 'src/shared/chroma.service';
import { CV_EVALUATION_SYSTEM_PROMPT } from './prompt/cv-evaluation.prompt';
import { PROJECT_EVALUATION_SYSTEM_PROMPT } from './prompt/project-report-evaluation.prompt';
import { FINAL_SYNTHESIS_SYSTEM_PROMPT } from './prompt/final-synthesis.prompt';
import { CVEvaluationResult } from './dto/cv-evaluation-result.dto';
import { ProjectEvaluationResult } from './dto/project-evaluation-result.dto';

@Injectable()
export class EvaluateService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly s3Service: S3Service,
    private readonly llmService: LLMService,
    private readonly chromaService: ChromaService,
    private readonly configService: ConfigService,
    @InjectQueue('evaluation') private readonly evaluationQueue: Queue,
  ) {}

  async startEvaluation(
    jobTitle: string,
    cvId: number,
    projectReportId: number,
  ): Promise<{ id: number }> {
    // Validate CV and Project Report exist
    const [cv, projectReport] = await Promise.all([
      this.prismaService.cV.findUnique({
        where: { id: cvId },
      }),
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

    // Create evaluation record with status 'queued'
    const evaluation = await this.prismaService.evaluation.create({
      data: {
        cv_id: cvId,
        project_report_id: projectReportId,
        job_title: jobTitle,
        status: 'queued',
      },
    });

    // Add job to queue
    await this.evaluationQueue.add('process-evaluation', {
      evaluationId: evaluation.id,
      jobTitle,
      cvId,
      projectReportId,
    });

    return { id: evaluation.id };
  }

  async getEvaluationResult(evaluationId: number) {
    const evaluation = await this.prismaService.evaluation.findUnique({
      where: { id: evaluationId },
    });

    if (!evaluation) {
      throw new BadRequestException('Evaluation not found');
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

  async performEvaluation(
    jobTitle: string,
    cvId: number,
    projectReportId: number,
  ) {
    // get cv and project report
    const [cv, projectReport] = await Promise.all([
      this.prismaService.cV.findUnique({
        where: { id: cvId },
      }),
      this.prismaService.projectReport.findUnique({
        where: { id: projectReportId },
      }),
    ]);

    if (!cv?.hosted_name || !projectReport?.hosted_name) {
      throw new BadRequestException('CV or Project Report not found');
    }

    // get cv and project report buffers
    const bucketName = this.configService.getOrThrow<string>('S3_BUCKET_NAME');
    const [cvBuffer, projectReportBuffer] = await Promise.all([
      this.s3Service.getFile(bucketName, cv.hosted_name),
      this.s3Service.getFile(bucketName, projectReport.hosted_name),
    ]);

    // get ground truth documents from vector DB
    const [jobDescription, caseStudyBrief, cvRubric, projectRubric] =
      await Promise.all([
        this.chromaService.getJobDescription(jobTitle),
        this.chromaService.getCaseStudyBrief(),
        this.chromaService.getScoringRubric('cv'),
        this.chromaService.getScoringRubric('project'),
      ]);

    // Evaluate CV
    const cvEvaluation = await this.evaluateCV(
      cvBuffer,
      jobDescription,
      cvRubric,
    );

    // Evaluate Project Report
    const projectEvaluation = await this.evaluateProjectReport(
      projectReportBuffer,
      caseStudyBrief,
      projectRubric,
    );

    // Synthesize final result
    const finalSynthesis = await this.synthesizeFinalResult(
      cvEvaluation,
      projectEvaluation,
    );

    // Return complete evaluation result
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
    // Build prompt with context
    const prompt = `
${CV_EVALUATION_SYSTEM_PROMPT}

JOB DESCRIPTION:
${jobDescription}

SCORING RUBRIC:
${cvRubric}

Please analyze the attached CV PDF and evaluate the candidate based on the job description and scoring rubric above. Provide a structured JSON response.
`;

    const response = await this.llmService.callGeminiFlashLiteWithPDF(
      cvBuffer,
      prompt,
      {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    );

    const resultText = response.text;
    if (!resultText) {
      throw new BadRequestException('LLM response did not contain text output');
    }

    const result = JSON.parse(resultText);

    return result;
  }

  async evaluateProjectReport(
    projectReportBuffer: Buffer,
    caseStudyBrief: string,
    projectRubric: string,
  ): Promise<ProjectEvaluationResult> {
    // Build prompt with context from RAG
    const prompt = `
${PROJECT_EVALUATION_SYSTEM_PROMPT}

CASE STUDY BRIEF (Requirements):
${caseStudyBrief}

SCORING RUBRIC:
${projectRubric}

Please analyze the attached Project Report PDF and evaluate the candidate's implementation based on the case study requirements and scoring rubric above. Provide a structured JSON response.
`;

    const response = await this.llmService.callGeminiFlashLiteWithPDF(
      projectReportBuffer,
      prompt,
      {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    );

    const resultText = response.text;
    if (!resultText) {
      throw new BadRequestException('LLM response did not contain text output');
    }

    const result = JSON.parse(resultText);

    return result;
  }

  async synthesizeFinalResult(
    cvEvaluation: CVEvaluationResult,
    projectEvaluation: ProjectEvaluationResult,
  ): Promise<{ overall_summary: string }> {
    // Build synthesis prompt with both evaluation results
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

    const response = await this.llmService.callGeminiFlash({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      config: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    });

    const resultText = response.text;
    if (!resultText) {
      throw new BadRequestException('LLM response did not contain text output');
    }

    const result = JSON.parse(resultText);

    return result;
  }
}
