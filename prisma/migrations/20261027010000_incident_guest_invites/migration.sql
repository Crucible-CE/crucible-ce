-- Incident guest links (CE v0.2). Additive: one new table.

-- CreateTable
CREATE TABLE "IncidentGuestInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "tokenHash" TEXT NOT NULL,
    "canUpload" BOOLEAN NOT NULL DEFAULT true,
    "invitedById" TEXT NOT NULL,
    "invitedByName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "lastAccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentGuestInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncidentGuestInvite_tokenHash_key" ON "IncidentGuestInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "IncidentGuestInvite_incidentId_idx" ON "IncidentGuestInvite"("incidentId");

-- AddForeignKey
ALTER TABLE "IncidentGuestInvite" ADD CONSTRAINT "IncidentGuestInvite_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
