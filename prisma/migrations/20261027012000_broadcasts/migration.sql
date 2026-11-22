-- Broadcast messaging (CE v0.2). Additive: three new tables.

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "channels" JSONB NOT NULL,
    "audience" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "userId" TEXT,
    "contactId" TEXT,
    "name" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedVia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Broadcast_organizationId_createdAt_idx" ON "Broadcast"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_broadcastId_idx" ON "BroadcastRecipient"("broadcastId");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_userId_idx" ON "BroadcastRecipient"("userId");

-- CreateIndex
CREATE INDEX "BroadcastDelivery_broadcastId_idx" ON "BroadcastDelivery"("broadcastId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastDelivery_recipientId_provider_key" ON "BroadcastDelivery"("recipientId", "provider");

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastDelivery" ADD CONSTRAINT "BroadcastDelivery_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "BroadcastRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
