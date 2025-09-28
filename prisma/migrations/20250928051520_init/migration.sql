-- CreateTable
CREATE TABLE "public"."CV" (
    "id" SERIAL NOT NULL,
    "originalName" TEXT NOT NULL,
    "hostedName" TEXT NOT NULL,

    CONSTRAINT "CV_pkey" PRIMARY KEY ("id")
);
