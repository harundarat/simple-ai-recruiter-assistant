import { GoogleGenAI, Type } from '@google/genai';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Service } from './s3.service';
import { PrismaService } from './prisma.service';

@Injectable()
export class LLMService {
  constructor(
    private configService: ConfigService,
    private readonly s3Service: S3Service,
    private readonly prismaService: PrismaService,
  ) {}

  async extractCV(id: number): Promise<string> {
    const gemini = new GoogleGenAI({
      apiKey: this.configService.getOrThrow<string>('GOOGLE_GEMINI_API_KEY'),
    });

    const cvDetail = await this.prismaService.cV.findFirstOrThrow({
      where: { id: id },
      select: { id: true, hosted_name: true },
    });

    // const projectReportDetail =
    //   await this.prismaService.projectReport.findFirstOrThrow({
    //     where: { cv_id: cvDetail.id },
    //     select: { hosted_name: true },
    //   });

    const cvBuffer = await this.s3Service.getFile(
      this.configService.getOrThrow<string>('S3_BUCKET_NAME'),
      cvDetail.hosted_name,
    );

    // const projectReportBuffer = await this.s3Service.getFile(
    //   this.configService.getOrThrow<string>('S3_BUCKET_NAME'),
    //   `project_report/${projectReportDetail.hosted_name}`,
    // );

    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          text: `You are an expert HR data extraction system. Your task is to parse the following CV text and convert it into a structured JSON object.
          The JSON object must follow the exact config schema. If a field is not found in the CV, use a \`null\` value.`,
        },
        {
          text: 'Here is the CV document:',
          inlineData: {
            mimeType: 'application/pdf',
            data: cvBuffer.toString('base64'),
          },
        },
      ],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            personal_details: {
              type: Type.OBJECT,
              full_name: { type: Type.STRING },
              email: { type: Type.STRING },
              phone: { type: Type.STRING },
              linkedin_url: { type: Type.STRING },
            },
            summary: { type: Type.STRING },
            work_experience: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  job_title: { type: Type.STRING },
                  company_name: { type: Type.STRING },
                  start_date: { type: Type.STRING },
                  end_date: { type: Type.STRING },
                  responsibilities: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
              },
            },
            education: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  degree: { type: Type.STRING },
                  institution: { type: Type.STRING },
                  start_date: { type: Type.STRING },
                  end_date: { type: Type.STRING },
                },
              },
            },
            skills: {
              type: Type.OBJECT,
              properties: {
                backend: { type: Type.ARRAY, items: { type: Type.STRING } },
                databases: { type: Type.ARRAY, items: { type: Type.STRING } },
                cloud: { type: Type.ARRAY, items: { type: Type.STRING } },
                ai_ml: { type: Type.ARRAY, items: { type: Type.STRING } },
                others: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
            },
            certifications: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            projects: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  project_name: { type: Type.STRING },
                  description: { type: Type.STRING },
                  technologies_used: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!response.text) {
      throw new InternalServerErrorException('Failed to extract CV data');
    }

    return response.text;
  }

  async evaluateCV(extractedCV: string, jobDescription: string) {
    const gemini = new GoogleGenAI({
      apiKey: this.configService.getOrThrow<string>('GOOGLE_GEMINI_API_KEY'),
    });

    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          text: `
          You are a senior technical recruiter. Your task is to perform a detailed analysis comparing the candidate's structured CV data with the provided job description. 

          Analyze the alignment based on the following criteria:
          1. **Technical Skills Match**: How well do the candidate's skills in backend, databases, APIs, cloud, and AI/LLM align with the job requirements? 
          2. **Experience Level**: Does the candidate's years of experience and project complexity match what the job requires? 
          3. **Relevant Achievements**: Does the candidate mention any impactful achievements that are relevant to the role?
          
          Provide your analysis in a structured JSON format. For each criterion, provide a brief, evidence-based summary. 
          
          Job Description: 
          """
          ${jobDescription}
          """
          
          Candidate's Structured CV Data:
          """
          ${extractedCV}
          """

          Return only the JSON analysis object. 
          Schema:
          {
          "technical_skills_analysis": "string (Your summary here)",
          "experience_level_analysis": "string (Your summary here)",
          "relevant_achievements_analysis": "string (Your summary here)"
          }
          `,
        },
      ],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            technical_skills_analysis: { type: Type.STRING },
            experience_level_analysis: { type: Type.STRING },
            relevant_achievements_analysis: { type: Type.STRING },
          },
        },
      },
    });
  }
}
