-- AlterEnum
ALTER TYPE "EvaluationFailedStage" ADD VALUE 'SAVE_CHECKPOINT';

-- AlterTable
ALTER TABLE "Evaluation"
ADD COLUMN "cv_checkpoint" JSONB,
ADD COLUMN "project_checkpoint" JSONB;
