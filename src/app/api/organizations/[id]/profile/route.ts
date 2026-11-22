import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { parseJsonBody } from "@/lib/http/parse-body";
import { logAudit } from "@/lib/audit/log";
import type { OrgProfile } from "@/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Bounded text / list fields mirroring the OrgProfile interface in
// src/types/index.ts. The merge semantics of the handler mean any subset
// of fields may appear; none are required.
const shortText = z.string().min(1).max(200);
const longText = z.string().min(1).max(4_000);
const shortTextArray = z.array(z.string().min(1).max(200)).max(100);

const profilePatchSchema = z
  .object({
    employeeCount: shortText.optional(),
    securityMaturity: shortText.optional(),
    cloudProviders: shortTextArray.optional(),
    identityPlatform: shortTextArray.optional(),
    endpointStack: shortTextArray.optional(),
    siemPlatform: shortTextArray.optional(),
    criticalAssets: longText.optional(),
    sensitiveDataClasses: shortTextArray.optional(),
    externalAttackSurface: longText.optional(),
    backupStrategy: longText.optional(),
    thirdPartyDependencies: longText.optional(),
    complianceFrameworks: shortTextArray.optional(),
    incidentResponseModel: shortText.optional(),
    irFramework: shortText.optional(),
    networkArchitecture: longText.optional(),
    workforceConnectivity: shortText.optional(),
    privilegedAccessModel: longText.optional(),
    threatIntelInputs: shortTextArray.optional(),
    regulatoryNotificationSla: shortText.optional(),
    businessCriticalFunctions: longText.optional(),
    recoveryTimeObjective: shortText.optional(),
    knownSecurityConstraints: longText.optional(),
    riskAppetite: shortText.optional(),
  })
  .strict();

// GET /api/organizations/[id]/profile — return the org's profileJson.
// Contributor+ only: the profile is security-posture data (tech stack,
// critical assets, attack surface, known constraints). No UI reads this
// endpoint (the org-profile page is server-rendered and applies the same
// rule); readers get 403.
export async function GET(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: orgId } = await context.params;

  // Verify user belongs to this org
  if (session.user.organizationId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const org = await db.organization.findFirst({
    where: { id: orgId },
    select: { id: true, profileJson: true },
  });

  if (!org) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json((org.profileJson ?? {}) as OrgProfile);
}

// PATCH /api/organizations/[id]/profile — merge-update the org's profileJson
export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orgId } = await context.params;

  // Verify user belongs to this org
  if (session.user.organizationId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!hasPermission(session.user, "admin.access")) {
    return NextResponse.json(
      { error: "Only an administrator can change this." },
      { status: 403 }
    );
  }

  const org = await db.organization.findFirst({
    where: { id: orgId },
    select: { id: true, profileJson: true },
  });

  if (!org) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = await parseJsonBody(req, profilePatchSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const updatedProfileJson = await db.$transaction(async (tx) => {
      // Lock the row for the duration of the read-merge-write so concurrent
      // PATCHes to different fields don't clobber each other.
      const rows = await tx.$queryRaw<{ profileJson: unknown }[]>`
        SELECT "profileJson" FROM "Organization" WHERE "id" = ${orgId} FOR UPDATE
      `;

      // Merge: existing profile overridden by incoming partial. `.strict()` on
      // the schema already rejects unknown keys, so only whitelisted fields
      // land here.
      const existing = (rows[0]?.profileJson ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...existing, ...parsed.data };

      const updated = await tx.organization.update({
        where: { id: orgId },
        data: { profileJson: merged as object },
        select: { profileJson: true },
      });

      return updated.profileJson;
    });

    await logAudit({
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? null,
      actorName: session.user.name ?? null,
      organizationId: orgId,
      action: "org_profile.updated",
      targetType: "Organization",
      targetId: orgId,
      // Field names only: profile values can be sensitive (assets, constraints).
      metadata: { fields: Object.keys(parsed.data) },
    });

    return NextResponse.json((updatedProfileJson ?? {}) as OrgProfile);
  } catch (error) {
    console.error("[org/profile PATCH] Error updating org profile:", error);
    return NextResponse.json(
      { error: "Couldn't save. Try again." },
      { status: 500 }
    );
  }
}
