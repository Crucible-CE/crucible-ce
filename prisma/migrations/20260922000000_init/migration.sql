-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "industry" TEXT,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "profileJson" JSONB,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "jobTitle" TEXT,
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),
    "passwordHash" TEXT,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'contributor',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailChangeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oldEmail" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "cancellationTokenHash" TEXT NOT NULL,
    "cancellationExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgInvite" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'contributor',
    "createdById" TEXT NOT NULL,
    "inviteeName" TEXT,
    "inviteeEmail" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "skipEmailVerification" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActivityLog" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,
    "action" TEXT NOT NULL,
    "emailHash" TEXT,
    "path" TEXT,
    "method" TEXT,
    "statusCode" INTEGER,
    "ipHash" TEXT,
    "ipLastOctet" TEXT,
    "userAgent" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingState" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "metadata" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'dark',

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationPref" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "UserNotificationPref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "dndUntil" TIMESTAMP(3),
    "digestCadence" TEXT NOT NULL DEFAULT 'off',
    "digestLastSentAt" TIMESTAMP(3),
    "notificationPhone" TEXT,
    "notificationPhoneVerifiedAt" TIMESTAMP(3),
    "allowUnverifiedPhone" BOOLEAN NOT NULL DEFAULT false,
    "phoneOtpHash" TEXT,
    "phoneOtpPhone" TEXT,
    "phoneOtpExpiresAt" TIMESTAMP(3),
    "phoneOtpAttempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeteredSend" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeteredSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgNotificationPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "lock" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgNotificationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgNotificationDefault" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "criticalBreaksDnd" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgNotificationDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDigestItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "incidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDigestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" TEXT NOT NULL DEFAULT 'host',
    "identifier" TEXT,
    "criticality" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'affected',
    "dataClassification" TEXT,
    "owner" TEXT,
    "containedAt" TIMESTAMP(3),
    "sourceIndicatorId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "highRisk" BOOLEAN NOT NULL DEFAULT false,
    "approvalStatus" TEXT NOT NULL DEFAULT 'not_required',
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "requestedById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "dueAt" TIMESTAMP(3),
    "assetIdsJson" JSONB NOT NULL DEFAULT '[]',
    "verificationNote" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentIndicator" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "indicatorType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT,
    "note" TEXT,
    "sharedExternally" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "relatedIncidentId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentStatusUpdate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'customer',
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "publishedById" TEXT NOT NULL,
    "publishedByName" TEXT,
    "unpublishedAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentStatusUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentCorrectiveAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentCorrectiveAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgIncidentSla" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "milestone" TEXT NOT NULL,
    "targetMinutes" INTEGER NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgIncidentSla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentPresence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentPresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorEmail" TEXT,
    "actorName" TEXT,
    "organizationId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "category" TEXT,
    "affectedSystems" JSONB,
    "timelineJson" JSONB,
    "mitreJson" JSONB,
    "businessImpactJson" JSONB,
    "declaredAt" TIMESTAMP(3),
    "containedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closureDisposition" TEXT,
    "closureReason" TEXT,
    "closureNote" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "bridgeUrl" TEXT,
    "recordsAffected" INTEGER,
    "customersAffected" INTEGER,
    "downtimeMinutes" INTEGER,
    "estimatedCostUsd" INTEGER,
    "impactDataTypesJson" JSONB,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedIcUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "ledgerSeq" INTEGER,
    "ledgerHead" TEXT,
    "ledgerHeadSig" TEXT,
    "ledgerHeadKeyId" TEXT,
    "ledgerHeadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetContactId" TEXT,
    "targetLabel" TEXT,
    "message" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'high',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "ackDeadlineAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "acknowledgedVia" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'page',
    "provider" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipientName" TEXT,
    "destination" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "providerRef" TEXT,
    "error" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentPostmortem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT,
    "incidentStartAt" TIMESTAMP(3),
    "metricsJson" JSONB,
    "impactJson" JSONB,
    "timelineJson" JSONB,
    "contributingFactorsJson" JSONB,
    "wentWellJson" JSONB,
    "wentPoorlyJson" JSONB,
    "actionItemsJson" JSONB,
    "lessonsLearned" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentPostmortem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IcsFeedToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "IcsFeedToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentCalendarEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "eventType" TEXT NOT NULL DEFAULT 'meeting',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentParticipant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "userEmail" TEXT,
    "role" TEXT NOT NULL DEFAULT 'responder',
    "addedById" TEXT,
    "addedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentIntelPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT,
    "tag" TEXT NOT NULL DEFAULT 'reference',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentIntelPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentActivity" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentChatMessage" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvidence" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedByName" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvidenceAccess" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvidenceAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentSitrep" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "generatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentSitrep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentStakeholderNotification" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "stakeholder" TEXT NOT NULL,
    "channel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentStakeholderNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentHandover" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "fromUserName" TEXT,
    "toUserId" TEXT,
    "toLabel" TEXT,
    "summary" TEXT NOT NULL,
    "openItems" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "acceptedById" TEXT,
    "acceptedByName" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentHandover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentLedgerEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "actorUserId" TEXT,
    "actorLabel" TEXT,
    "eventType" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "prevHash" TEXT NOT NULL,
    "entryHash" TEXT NOT NULL,
    "keyId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "context" TEXT,
    "options" JSONB,
    "decision" TEXT,
    "rationale" TEXT,
    "decidedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentTaskComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentTaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentTaskAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentTaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentRoleAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "userId" TEXT,
    "escalationContactId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "alternatePhone" TEXT,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "severityLevel" TEXT NOT NULL DEFAULT 'any',
    "role" TEXT NOT NULL,
    "userId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "allowUnverifiedPhone" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "verificationTokenHash" TEXT,
    "verificationSentAt" TIMESTAMP(3),
    "phoneVerificationTokenHash" TEXT,
    "phoneVerificationSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentExport" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "packageHash" TEXT,
    "ledgerHead" TEXT,
    "storagePath" TEXT,
    "sizeBytes" INTEGER,
    "passphraseEnc" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IncidentExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailChangeRequest_userId_key" ON "EmailChangeRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailChangeRequest_cancellationTokenHash_key" ON "EmailChangeRequest"("cancellationTokenHash");

-- CreateIndex
CREATE INDEX "EmailChangeRequest_cancellationExpiresAt_idx" ON "EmailChangeRequest"("cancellationExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrgInvite_tokenHash_key" ON "OrgInvite"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "OrgInvite_usedByUserId_key" ON "OrgInvite"("usedByUserId");

-- CreateIndex
CREATE INDEX "OrgInvite_organizationId_createdAt_idx" ON "OrgInvite"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OrgInvite_createdById_createdAt_idx" ON "OrgInvite"("createdById", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OrgInvite_expiresAt_idx" ON "OrgInvite"("expiresAt");

-- CreateIndex
CREATE INDEX "UserActivityLog_userId_createdAt_idx" ON "UserActivityLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "UserActivityLog_organizationId_createdAt_idx" ON "UserActivityLog"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "UserActivityLog_action_createdAt_idx" ON "UserActivityLog"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OnboardingState_key_idx" ON "OnboardingState"("key");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingState_scope_subjectId_key_key" ON "OnboardingState"("scope", "subjectId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_dismissedAt_idx" ON "Notification"("userId", "dismissedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_userId_key" ON "UserPreferences"("userId");

-- CreateIndex
CREATE INDEX "UserNotificationPref_userId_idx" ON "UserNotificationPref"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationPref_userId_categoryCode_channel_key" ON "UserNotificationPref"("userId", "categoryCode", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationSetting_userId_key" ON "UserNotificationSetting"("userId");

-- CreateIndex
CREATE INDEX "MeteredSend_organizationId_channel_createdAt_idx" ON "MeteredSend"("organizationId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "MeteredSend_destination_channel_createdAt_idx" ON "MeteredSend"("destination", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "OrgNotificationPolicy_organizationId_idx" ON "OrgNotificationPolicy"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgNotificationPolicy_organizationId_categoryCode_channel_key" ON "OrgNotificationPolicy"("organizationId", "categoryCode", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "OrgNotificationDefault_organizationId_key" ON "OrgNotificationDefault"("organizationId");

-- CreateIndex
CREATE INDEX "IncidentSubscription_incidentId_idx" ON "IncidentSubscription"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentSubscription_userId_incidentId_key" ON "IncidentSubscription"("userId", "incidentId");

-- CreateIndex
CREATE INDEX "NotificationDigestItem_userId_createdAt_idx" ON "NotificationDigestItem"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentAsset_incidentId_deletedAt_idx" ON "IncidentAsset"("incidentId", "deletedAt");

-- CreateIndex
CREATE INDEX "IncidentAsset_organizationId_idx" ON "IncidentAsset"("organizationId");

-- CreateIndex
CREATE INDEX "IncidentAction_incidentId_deletedAt_idx" ON "IncidentAction"("incidentId", "deletedAt");

-- CreateIndex
CREATE INDEX "IncidentAction_organizationId_idx" ON "IncidentAction"("organizationId");

-- CreateIndex
CREATE INDEX "IncidentIndicator_incidentId_deletedAt_idx" ON "IncidentIndicator"("incidentId", "deletedAt");

-- CreateIndex
CREATE INDEX "IncidentIndicator_organizationId_idx" ON "IncidentIndicator"("organizationId");

-- CreateIndex
CREATE INDEX "IncidentLink_incidentId_idx" ON "IncidentLink"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentLink_relatedIncidentId_idx" ON "IncidentLink"("relatedIncidentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentLink_incidentId_relatedIncidentId_relationType_key" ON "IncidentLink"("incidentId", "relatedIncidentId", "relationType");

-- CreateIndex
CREATE INDEX "IncidentStatusUpdate_incidentId_createdAt_idx" ON "IncidentStatusUpdate"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentCorrectiveAction_incidentId_idx" ON "IncidentCorrectiveAction"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentCorrectiveAction_organizationId_status_idx" ON "IncidentCorrectiveAction"("organizationId", "status");

-- CreateIndex
CREATE INDEX "OrgIncidentSla_organizationId_idx" ON "OrgIncidentSla"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgIncidentSla_organizationId_severity_milestone_key" ON "OrgIncidentSla"("organizationId", "severity", "milestone");

-- CreateIndex
CREATE INDEX "IncidentPresence_incidentId_lastSeenAt_idx" ON "IncidentPresence"("incidentId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentPresence_incidentId_userId_key" ON "IncidentPresence"("incidentId", "userId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_idx" ON "AdminAuditLog"("action");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_organizationId_createdAt_idx" ON "AdminAuditLog"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Incident_organizationId_status_idx" ON "Incident"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Incident_organizationId_severity_idx" ON "Incident"("organizationId", "severity");

-- CreateIndex
CREATE INDEX "Incident_organizationId_deletedAt_idx" ON "Incident"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "Incident_assignedToId_idx" ON "Incident"("assignedToId");

-- CreateIndex
CREATE INDEX "Incident_organizationId_createdAt_id_idx" ON "Incident"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "IncidentPage_incidentId_idx" ON "IncidentPage"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentPage_status_ackDeadlineAt_idx" ON "IncidentPage"("status", "ackDeadlineAt");

-- CreateIndex
CREATE INDEX "PageDelivery_pageId_idx" ON "PageDelivery"("pageId");

-- CreateIndex
CREATE INDEX "PageDelivery_nextRetryAt_idx" ON "PageDelivery"("nextRetryAt");

-- CreateIndex
CREATE INDEX "PageDelivery_organizationId_channel_createdAt_idx" ON "PageDelivery"("organizationId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "PageDelivery_destination_channel_createdAt_idx" ON "PageDelivery"("destination", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "PageDelivery_providerRef_idx" ON "PageDelivery"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "PageDelivery_pageId_level_provider_attempt_key" ON "PageDelivery"("pageId", "level", "provider", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentPostmortem_incidentId_key" ON "IncidentPostmortem"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentPostmortem_organizationId_status_idx" ON "IncidentPostmortem"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IcsFeedToken_tokenHash_key" ON "IcsFeedToken"("tokenHash");

-- CreateIndex
CREATE INDEX "IcsFeedToken_incidentId_userId_idx" ON "IcsFeedToken"("incidentId", "userId");

-- CreateIndex
CREATE INDEX "IcsFeedToken_userId_idx" ON "IcsFeedToken"("userId");

-- CreateIndex
CREATE INDEX "IncidentCalendarEvent_incidentId_startAt_idx" ON "IncidentCalendarEvent"("incidentId", "startAt");

-- CreateIndex
CREATE INDEX "IncidentCalendarEvent_assigneeId_idx" ON "IncidentCalendarEvent"("assigneeId");

-- CreateIndex
CREATE INDEX "IncidentParticipant_incidentId_idx" ON "IncidentParticipant"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentParticipant_userId_idx" ON "IncidentParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentParticipant_incidentId_userId_key" ON "IncidentParticipant"("incidentId", "userId");

-- CreateIndex
CREATE INDEX "IncidentIntelPost_incidentId_createdAt_idx" ON "IncidentIntelPost"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentIntelPost_incidentId_pinned_idx" ON "IncidentIntelPost"("incidentId", "pinned");

-- CreateIndex
CREATE INDEX "IncidentActivity_incidentId_timestamp_idx" ON "IncidentActivity"("incidentId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "IncidentChatMessage_incidentId_createdAt_idx" ON "IncidentChatMessage"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentEvidence_incidentId_createdAt_idx" ON "IncidentEvidence"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentEvidenceAccess_evidenceId_createdAt_idx" ON "IncidentEvidenceAccess"("evidenceId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentSitrep_incidentId_createdAt_idx" ON "IncidentSitrep"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentStakeholderNotification_incidentId_status_idx" ON "IncidentStakeholderNotification"("incidentId", "status");

-- CreateIndex
CREATE INDEX "IncidentHandover_incidentId_createdAt_idx" ON "IncidentHandover"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentLedgerEntry_organizationId_incidentId_idx" ON "IncidentLedgerEntry"("organizationId", "incidentId");

-- CreateIndex
CREATE INDEX "IncidentLedgerEntry_incidentId_seq_idx" ON "IncidentLedgerEntry"("incidentId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentLedgerEntry_incidentId_seq_key" ON "IncidentLedgerEntry"("incidentId", "seq");

-- CreateIndex
CREATE INDEX "IncidentDecision_incidentId_status_idx" ON "IncidentDecision"("incidentId", "status");

-- CreateIndex
CREATE INDEX "IncidentTask_incidentId_status_idx" ON "IncidentTask"("incidentId", "status");

-- CreateIndex
CREATE INDEX "IncidentTask_assigneeId_idx" ON "IncidentTask"("assigneeId");

-- CreateIndex
CREATE INDEX "IncidentTaskComment_taskId_createdAt_idx" ON "IncidentTaskComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentTaskAttachment_taskId_createdAt_idx" ON "IncidentTaskAttachment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentRoleAssignment_incidentId_idx" ON "IncidentRoleAssignment"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentRoleAssignment_incidentId_role_key" ON "IncidentRoleAssignment"("incidentId", "role");

-- CreateIndex
CREATE INDEX "EscalationContact_organizationId_isActive_idx" ON "EscalationContact"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "EscalationContact_organizationId_tier_idx" ON "EscalationContact"("organizationId", "tier");

-- CreateIndex
CREATE INDEX "EscalationContact_userId_idx" ON "EscalationContact"("userId");

-- CreateIndex
CREATE INDEX "IncidentExport_incidentId_createdAt_idx" ON "IncidentExport"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentExport_organizationId_idx" ON "IncidentExport"("organizationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailChangeRequest" ADD CONSTRAINT "EmailChangeRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivityLog" ADD CONSTRAINT "UserActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentPage" ADD CONSTRAINT "IncidentPage_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageDelivery" ADD CONSTRAINT "PageDelivery_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "IncidentPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentPostmortem" ADD CONSTRAINT "IncidentPostmortem_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcsFeedToken" ADD CONSTRAINT "IcsFeedToken_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcsFeedToken" ADD CONSTRAINT "IcsFeedToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentCalendarEvent" ADD CONSTRAINT "IncidentCalendarEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentParticipant" ADD CONSTRAINT "IncidentParticipant_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentIntelPost" ADD CONSTRAINT "IncidentIntelPost_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentActivity" ADD CONSTRAINT "IncidentActivity_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentChatMessage" ADD CONSTRAINT "IncidentChatMessage_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvidence" ADD CONSTRAINT "IncidentEvidence_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvidenceAccess" ADD CONSTRAINT "IncidentEvidenceAccess_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "IncidentEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentSitrep" ADD CONSTRAINT "IncidentSitrep_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentStakeholderNotification" ADD CONSTRAINT "IncidentStakeholderNotification_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentHandover" ADD CONSTRAINT "IncidentHandover_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentLedgerEntry" ADD CONSTRAINT "IncidentLedgerEntry_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentDecision" ADD CONSTRAINT "IncidentDecision_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTask" ADD CONSTRAINT "IncidentTask_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTaskComment" ADD CONSTRAINT "IncidentTaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "IncidentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTaskAttachment" ADD CONSTRAINT "IncidentTaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "IncidentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentRoleAssignment" ADD CONSTRAINT "IncidentRoleAssignment_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationContact" ADD CONSTRAINT "EscalationContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

