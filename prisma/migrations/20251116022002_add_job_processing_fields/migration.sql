/*
  Warnings:

  - Added the required column `job_title` to the `Evaluation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "EvaluationStatus" ADD VALUE 'failed';

-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "job_title" TEXT NOT NULL,
ADD COLUMN     "retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "started_at" TIMESTAMP(3);
