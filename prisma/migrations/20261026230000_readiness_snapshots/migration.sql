-- Readiness scorecard snapshots (CE v0.2). Additive: one new table.

-- CreateTable
CREATE TABLE "ReadinessSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "day" DATE NOT NULL,
    "score" INTEGER NOT NULL,
    "rubricVersion" INTEGER NOT NULL,
    "components" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadinessSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReadinessSnapshot_organizationId_day_key" ON "ReadinessSnapshot"("organizationId", "day");
