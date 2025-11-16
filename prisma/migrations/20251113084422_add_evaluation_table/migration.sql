-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('queued', 'processing', 'completed');

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" SERIAL NOT NULL,
    "cv_id" INTEGER NOT NULL,
    "project_report_id" INTEGER NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'queued',
    "cv_match_rate" DOUBLE PRECISION,
    "cv_feedback" TEXT,
    "project_score" DOUBLE PRECISION,
    "project_feedback" TEXT,
    "overall_summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_cv_id_fkey" FOREIGN KEY ("cv_id") REFERENCES "CV"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_project_report_id_fkey" FOREIGN KEY ("project_report_id") REFERENCES "ProjectReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
