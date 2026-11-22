-- Incident playbook runs (CE v0.2). Additive: two new tables.

-- CreateTable
CREATE TABLE "IncidentPlaybookRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "documentId" TEXT,
    "documentTitle" TEXT NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "libraryKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentPlaybookRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentPlaybookStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "detail" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'step',
    "source" TEXT NOT NULL DEFAULT 'document',
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "doneByName" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentPlaybookStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentPlaybookRun_incidentId_idx" ON "IncidentPlaybookRun"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentPlaybookStep_runId_position_idx" ON "IncidentPlaybookStep"("runId", "position");

-- AddForeignKey
ALTER TABLE "IncidentPlaybookRun" ADD CONSTRAINT "IncidentPlaybookRun_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentPlaybookStep" ADD CONSTRAINT "IncidentPlaybookStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IncidentPlaybookRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
