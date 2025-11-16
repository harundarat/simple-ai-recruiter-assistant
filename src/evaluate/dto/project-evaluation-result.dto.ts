export interface ProjectEvaluationResult {
  correctness_score: number;
  correctness_reasoning: string;
  code_quality_score: number;
  code_quality_reasoning: string;
  resilience_score: number;
  resilience_reasoning: string;
  documentation_score: number;
  documentation_reasoning: string;
  creativity_score: number;
  creativity_reasoning: string;
  project_score: number;
  project_feedback: string;
}
