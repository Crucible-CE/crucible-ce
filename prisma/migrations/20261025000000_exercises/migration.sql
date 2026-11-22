-- Crucible CE v0.2: exercises. Additive only: new tables, no CE table changes.
--
-- Every exercise table carries organizationId. Its default is the install's
-- organization (the oldest Organization row), so one-org installs never pass
-- it by hand. A function is used because a column DEFAULT cannot hold a
-- subquery.
CREATE OR REPLACE FUNCTION ce_default_org_id() RETURNS TEXT
  LANGUAGE sql STABLE
  AS $$ SELECT "id" FROM "Organization" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1 $$;

-- CreateTable
CREATE TABLE "ExerciseSettings" (
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "capabilityFramework" TEXT NOT NULL DEFAULT 'nist-csf',
    "enabledFrameworks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hseepMode" BOOLEAN NOT NULL DEFAULT true,
    "requireSponsorSignoff" BOOLEAN NOT NULL DEFAULT true,
    "policy" JSONB NOT NULL DEFAULT '{}',
    "retentionYears" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "GuestSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "tokenHash" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capability" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "framework" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Capability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileId" TEXT,
    "text" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "mode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'local',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL DEFAULT '{}',
    "objectives" JSONB NOT NULL DEFAULT '[]',
    "branching" TEXT NOT NULL DEFAULT 'linear',
    "sourceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateInject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "templateId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "scenarioOffsetMin" INTEGER NOT NULL DEFAULT 0,
    "plannedDelayMin" INTEGER,
    "targetTeams" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectedActions" JSONB NOT NULL DEFAULT '[]',
    "objectiveKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" JSONB NOT NULL DEFAULT '{}',
    "secret" JSONB NOT NULL DEFAULT '{}',
    "position" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "TemplateInject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateBranch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "templateId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "condition" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TemplateBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rubric" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "templateId" TEXT,
    "exerciseId" TEXT,
    "questionKey" TEXT NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '[]',
    "modelAnswer" TEXT,
    "maxScore" INTEGER NOT NULL DEFAULT 4,
    "capabilityKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rubric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "mode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret" JSONB NOT NULL DEFAULT '{}',
    "plan" JSONB NOT NULL DEFAULT '{}',
    "templateId" TEXT,
    "sourceDocumentId" TEXT,
    "currentInjectId" TEXT,
    "scenarioStartAt" TIMESTAMP(3),
    "timeboxMin" INTEGER,
    "injectBudget" INTEGER,
    "advancePolicy" TEXT NOT NULL DEFAULT 'facilitator',
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pausedMsTotal" INTEGER NOT NULL DEFAULT 0,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "isPractice" BOOLEAN NOT NULL DEFAULT false,
    "joinCode" TEXT,
    "joinCodeFailures" INTEGER NOT NULL DEFAULT 0,
    "guestJoin" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Objective" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "capabilityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "injectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Objective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "userId" TEXT,
    "guestName" TEXT,
    "displayName" TEXT NOT NULL,
    "title" TEXT,
    "organization" TEXT,
    "teamId" TEXT,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "attendance" TEXT,
    "noDevice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'template',
    "title" TEXT NOT NULL,
    "scenarioTime" TIMESTAMP(3),
    "targetTeamIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" JSONB NOT NULL DEFAULT '{}',
    "secret" JSONB NOT NULL DEFAULT '{}',
    "templateInjectId" TEXT,
    "budgetMs" INTEGER,
    "openedAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeTrigger" TEXT,
    "releasedById" TEXT,
    "controllerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Response" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "injectId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "teamId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "responseId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'human',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "score" DOUBLE PRECISION,
    "rating" TEXT,
    "rationale" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreState" (
    "exerciseId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "path" TEXT,
    "cumulative" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "teamScores" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoreState_pkey" PRIMARY KEY ("exerciseId")
);

-- CreateTable
CREATE TABLE "ExerciseEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorParticipantId" TEXT,
    "actorUserId" TEXT,
    "injectId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ExerciseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "injectId" TEXT,
    "objectiveId" TEXT,
    "capabilityId" TEXT,
    "authorParticipantId" TEXT,
    "text" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'observation',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityRating" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "capabilityId" TEXT,
    "rating" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'evaluator',
    "rationale" TEXT,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HotwashItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "objectiveId" TEXT,
    "text" TEXT NOT NULL,
    "byParticipantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HotwashItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "ratings" JSONB NOT NULL DEFAULT '{}',
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "teamId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'all',
    "participantId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryClock" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "durationHours" INTEGER,
    "businessDays" INTEGER,
    "triggeredAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "metAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "RegulatoryClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AfterActionReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sections" JSONB NOT NULL DEFAULT '{}',
    "editLog" JSONB NOT NULL DEFAULT '[]',
    "sourceDocSha" TEXT,
    "contentHash" TEXT,
    "canonical" TEXT,
    "generating" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "aamAt" TIMESTAMP(3),
    "aamAttendees" TEXT,
    "ipAgreedAt" TIMESTAMP(3),
    "amendReason" TEXT,
    "finalPdfFileId" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AfterActionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AarSignature" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "aarId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "userId" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "keyId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,

    CONSTRAINT "AarSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "exerciseId" TEXT,
    "aarId" TEXT,
    "capabilityId" TEXT,
    "objectiveId" TEXT,
    "afi" TEXT NOT NULL,
    "correctiveAction" TEXT NOT NULL,
    "poete" TEXT,
    "responsibleOrg" TEXT,
    "poc" TEXT,
    "pocEmail" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "closureEvidence" TEXT,
    "rejectedReason" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "lastRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "templateId" TEXT,
    "rrule" TEXT,
    "nextAt" TIMESTAMP(3),
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "teams" JSONB NOT NULL DEFAULT '[]',
    "documents" JSONB NOT NULL DEFAULT '[]',
    "frameworkKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "briefMd" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningKey" (
    "keyId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "publicKeyPem" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("keyId")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT ce_default_org_id(),
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_tokenHash_key" ON "GuestSession"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestSession_exerciseId_idx" ON "GuestSession"("exerciseId");

-- CreateIndex
CREATE INDEX "GuestSession_expiresAt_idx" ON "GuestSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Capability_organizationId_idx" ON "Capability"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Capability_framework_key_key" ON "Capability"("framework", "key");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_path_key" ON "StoredFile"("path");

-- CreateIndex
CREATE INDEX "StoredFile_organizationId_idx" ON "StoredFile"("organizationId");

-- CreateIndex
CREATE INDEX "SourceDocument_organizationId_idx" ON "SourceDocument"("organizationId");

-- CreateIndex
CREATE INDEX "ExerciseTemplate_mode_status_idx" ON "ExerciseTemplate"("mode", "status");

-- CreateIndex
CREATE INDEX "ExerciseTemplate_organizationId_idx" ON "ExerciseTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "TemplateInject_templateId_seq_idx" ON "TemplateInject"("templateId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateInject_templateId_nodeId_key" ON "TemplateInject"("templateId", "nodeId");

-- CreateIndex
CREATE INDEX "TemplateBranch_templateId_fromNodeId_idx" ON "TemplateBranch"("templateId", "fromNodeId");

-- CreateIndex
CREATE INDEX "Rubric_exerciseId_questionKey_idx" ON "Rubric"("exerciseId", "questionKey");

-- CreateIndex
CREATE INDEX "Rubric_templateId_questionKey_idx" ON "Rubric"("templateId", "questionKey");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_joinCode_key" ON "Exercise"("joinCode");

-- CreateIndex
CREATE INDEX "Exercise_status_idx" ON "Exercise"("status");

-- CreateIndex
CREATE INDEX "Exercise_mode_createdAt_idx" ON "Exercise"("mode", "createdAt");

-- CreateIndex
CREATE INDEX "Exercise_organizationId_createdAt_idx" ON "Exercise"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Objective_exerciseId_seq_idx" ON "Objective"("exerciseId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Team_exerciseId_name_key" ON "Team"("exerciseId", "name");

-- CreateIndex
CREATE INDEX "Participant_exerciseId_teamId_idx" ON "Participant"("exerciseId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_exerciseId_userId_key" ON "Participant"("exerciseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_exerciseId_displayName_key" ON "Participant"("exerciseId", "displayName");

-- CreateIndex
CREATE INDEX "Inject_status_closesAt_idx" ON "Inject"("status", "closesAt");

-- CreateIndex
CREATE UNIQUE INDEX "Inject_exerciseId_seq_key" ON "Inject"("exerciseId", "seq");

-- CreateIndex
CREATE INDEX "Response_injectId_kind_idx" ON "Response"("injectId", "kind");

-- CreateIndex
CREATE INDEX "Response_exerciseId_kind_idx" ON "Response"("exerciseId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Grade_responseId_source_attempt_key" ON "Grade"("responseId", "source", "attempt");

-- CreateIndex
CREATE INDEX "ExerciseEvent_exerciseId_at_idx" ON "ExerciseEvent"("exerciseId", "at");

-- CreateIndex
CREATE INDEX "ExerciseEvent_exerciseId_type_idx" ON "ExerciseEvent"("exerciseId", "type");

-- CreateIndex
CREATE INDEX "Observation_exerciseId_at_idx" ON "Observation"("exerciseId", "at");

-- CreateIndex
CREATE INDEX "CapabilityRating_exerciseId_objectiveId_idx" ON "CapabilityRating"("exerciseId", "objectiveId");

-- CreateIndex
CREATE INDEX "HotwashItem_exerciseId_idx" ON "HotwashItem"("exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_exerciseId_participantId_key" ON "Feedback"("exerciseId", "participantId");

-- CreateIndex
CREATE INDEX "ChatMessage_exerciseId_at_idx" ON "ChatMessage"("exerciseId", "at");

-- CreateIndex
CREATE INDEX "RegulatoryClock_exerciseId_idx" ON "RegulatoryClock"("exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "AfterActionReport_previousId_key" ON "AfterActionReport"("previousId");

-- CreateIndex
CREATE UNIQUE INDEX "AfterActionReport_exerciseId_version_key" ON "AfterActionReport"("exerciseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AarSignature_aarId_role_key" ON "AarSignature"("aarId", "role");

-- CreateIndex
CREATE INDEX "ActionItem_status_dueDate_idx" ON "ActionItem"("status", "dueDate");

-- CreateIndex
CREATE INDEX "ActionItem_organizationId_idx" ON "ActionItem"("organizationId");

-- CreateIndex
CREATE INDEX "ExerciseSchedule_organizationId_idx" ON "ExerciseSchedule"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_key_key" ON "Job"("key");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseTemplate" ADD CONSTRAINT "ExerciseTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateInject" ADD CONSTRAINT "TemplateInject_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExerciseTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateBranch" ADD CONSTRAINT "TemplateBranch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExerciseTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExerciseTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExerciseTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objective" ADD CONSTRAINT "Objective_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inject" ADD CONSTRAINT "Inject_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_injectId_fkey" FOREIGN KEY ("injectId") REFERENCES "Inject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreState" ADD CONSTRAINT "ScoreState_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseEvent" ADD CONSTRAINT "ExerciseEvent_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_authorParticipantId_fkey" FOREIGN KEY ("authorParticipantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityRating" ADD CONSTRAINT "CapabilityRating_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityRating" ADD CONSTRAINT "CapabilityRating_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityRating" ADD CONSTRAINT "CapabilityRating_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotwashItem" ADD CONSTRAINT "HotwashItem_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotwashItem" ADD CONSTRAINT "HotwashItem_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotwashItem" ADD CONSTRAINT "HotwashItem_byParticipantId_fkey" FOREIGN KEY ("byParticipantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryClock" ADD CONSTRAINT "RegulatoryClock_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AfterActionReport" ADD CONSTRAINT "AfterActionReport_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AfterActionReport" ADD CONSTRAINT "AfterActionReport_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "AfterActionReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AfterActionReport" ADD CONSTRAINT "AfterActionReport_finalPdfFileId_fkey" FOREIGN KEY ("finalPdfFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AarSignature" ADD CONSTRAINT "AarSignature_aarId_fkey" FOREIGN KEY ("aarId") REFERENCES "AfterActionReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AarSignature" ADD CONSTRAINT "AarSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_aarId_fkey" FOREIGN KEY ("aarId") REFERENCES "AfterActionReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSchedule" ADD CONSTRAINT "ExerciseSchedule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExerciseTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One vote per participant per inject.
CREATE UNIQUE INDEX "Response_vote_once_per_participant"
  ON "Response" ("injectId", "participantId")
  WHERE "kind" = 'vote';

-- One answer per team per inject.
CREATE UNIQUE INDEX "Response_answer_once_per_team"
  ON "Response" ("injectId", "teamId")
  WHERE "kind" = 'answer';

-- One written deliverable per team per inject. Later submissions replace it.
CREATE UNIQUE INDEX "Response_deliverable_once_per_team"
  ON "Response" ("injectId", "teamId")
  WHERE "kind" = 'deliverable';
