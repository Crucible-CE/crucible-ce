// Admin audit trail. Writes to AdminAuditLog, now org-scoped so org admins can
// see their own org's privileged-action history. Best-effort: auditing must
// never block or fail the action it records.
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export interface AuditInput {
  actorUserId: string;
  actorEmail?: string | null;
  actorName?: string | null;
  organizationId?: string | null; // org the action affects
  action: string; // e.g. "security_policy.updated", "api_key.created"
  targetType: string; // e.g. "OrgSecurityPolicy", "ApiKey", "User"
  targetId?: string | null;
  targetLabel?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function logAudit(i: AuditInput): Promise<void> {
  try {
    await db.adminAuditLog.create({
      data: {
        actorUserId: i.actorUserId,
        actorEmail: i.actorEmail ?? null,
        actorName: i.actorName ?? null,
        organizationId: i.organizationId ?? null,
        action: i.action,
        targetType: i.targetType,
        targetId: i.targetId ?? null,
        targetLabel: i.targetLabel ?? null,
        metadataJson: i.metadata ?? undefined,
      },
    });
  } catch {
    // never block the underlying action on an audit-write failure
  }
}
