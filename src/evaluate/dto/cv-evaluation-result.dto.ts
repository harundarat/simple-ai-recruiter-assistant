import { z } from 'zod';

const score = z.number().min(1).max(5);
const explanation = z.string().trim().min(1);

export const CVEvaluationResultSchema = z
  .object({
    technical_skills_score: score,
    technical_skills_reasoning: explanation,
    experience_score: score,
    experience_reasoning: explanation,
    achievements_score: score,
    achievements_reasoning: explanation,
    cultural_fit_score: score,
    cultural_fit_reasoning: explanation,
    cv_match_rate: z.number().min(0.2).max(1),
    cv_feedback: explanation,
  })
  .strict();

export type CVEvaluationResult = z.infer<typeof CVEvaluationResultSchema>;
