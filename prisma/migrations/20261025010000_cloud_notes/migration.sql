-- Cloud notes (CE v0.2). Additive: one column on the v0.2 ExerciseSettings
-- table and one new table. No CE table changes shape.

-- AlterTable
ALTER TABLE "ExerciseSettings" ADD COLUMN "showCloudNotes" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CloudNoteDismissal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "userId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloudNoteDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CloudNoteDismissal_userId_note_key" ON "CloudNoteDismissal"("userId", "note");
