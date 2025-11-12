/*
  Warnings:

  - You are about to drop the column `hostedName` on the `CV` table. All the data in the column will be lost.
  - You are about to drop the column `originalName` on the `CV` table. All the data in the column will be lost.
  - Added the required column `hosted_name` to the `CV` table without a default value. This is not possible if the table is not empty.
  - Added the required column `original_name` to the `CV` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."CV" DROP COLUMN "hostedName",
DROP COLUMN "originalName",
ADD COLUMN     "hosted_name" TEXT NOT NULL,
ADD COLUMN     "original_name" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "public"."ProjectReport" (
    "id" SERIAL NOT NULL,
    "cv_id" INTEGER NOT NULL,
    "original_name" TEXT NOT NULL,
    "hosted_name" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "ProjectReport_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."ProjectReport" ADD CONSTRAINT "ProjectReport_cv_id_fkey" FOREIGN KEY ("cv_id") REFERENCES "public"."CV"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
