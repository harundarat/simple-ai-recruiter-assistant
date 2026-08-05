import { z } from 'zod';

export const FinalSynthesisResultSchema = z
  .object({
    overall_summary: z.string().trim().min(1),
    key_strengths: z.array(z.string().trim().min(1)).min(1),
    areas_for_improvement: z.array(z.string().trim().min(1)),
    hiring_recommendation: z.enum(['strong_hire', 'hire', 'maybe', 'no_hire']),
    confidence_level: z.number().min(1).max(5),
    confidence_reasoning: z.string().trim().min(1),
    interview_focus_areas: z.array(z.string().trim().min(1)),
    role_fit_percentage: z.number().min(0).max(100),
    next_steps: z.string().trim().min(1),
  })
  .strict();

export type FinalSynthesisResult = z.infer<typeof FinalSynthesisResultSchema>;
