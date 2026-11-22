-- Training incidents (CE v0.2 onboarding). Additive: one column and one index.

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN "isTraining" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Incident_reportedById_isTraining_idx" ON "Incident"("reportedById", "isTraining");
