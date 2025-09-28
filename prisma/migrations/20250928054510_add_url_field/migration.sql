/*
  Warnings:

  - Added the required column `url` to the `CV` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."CV" ADD COLUMN     "url" TEXT NOT NULL;
