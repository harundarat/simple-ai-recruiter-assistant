import { z } from 'zod';

const score = z.number().min(1).max(5);
const explanation = z.string().trim().min(1);

export const ProjectEvaluationResultSchema = z
  .object({
    correctness_score: score,
    correctness_reasoning: explanation,
    code_quality_score: score,
    code_quality_reasoning: explanation,
    resilience_score: score,
    resilience_reasoning: explanation,
    documentation_score: score,
    documentation_reasoning: explanation,
    creativity_score: score,
    creativity_reasoning: explanation,
    project_score: score,
    project_feedback: explanation,
  })
  .strict();

export type ProjectEvaluationResult = z.infer<
  typeof ProjectEvaluationResultSchema
>;
