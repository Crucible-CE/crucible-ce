-- Public status pages (CE v0.2). Additive: two nullable columns on
-- IncidentStatusUpdate and two new tables.

-- AlterTable
ALTER TABLE "IncidentStatusUpdate" ADD COLUMN     "publishedToPageAt" TIMESTAMP(3),
ADD COLUMN     "publishedToPageById" TEXT;

-- CreateTable
CREATE TABLE "IncidentStatusPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "audienceScope" TEXT NOT NULL DEFAULT 'public',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentStatusPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPageSubscriber" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "confirmTokenHash" TEXT,
    "confirmSentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusPageSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncidentStatusPage_incidentId_key" ON "IncidentStatusPage"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentStatusPage_tokenHash_key" ON "IncidentStatusPage"("tokenHash");

-- CreateIndex
CREATE INDEX "IncidentStatusPage_organizationId_idx" ON "IncidentStatusPage"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPageSubscriber_confirmTokenHash_key" ON "StatusPageSubscriber"("confirmTokenHash");

-- CreateIndex
CREATE INDEX "StatusPageSubscriber_statusPageId_confirmedAt_idx" ON "StatusPageSubscriber"("statusPageId", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPageSubscriber_statusPageId_email_key" ON "StatusPageSubscriber"("statusPageId", "email");

-- AddForeignKey
ALTER TABLE "IncidentStatusPage" ADD CONSTRAINT "IncidentStatusPage_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageSubscriber" ADD CONSTRAINT "StatusPageSubscriber_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "IncidentStatusPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
