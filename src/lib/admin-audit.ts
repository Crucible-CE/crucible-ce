// Admin audit trail — a thin wrapper over the single Prisma writer
// (src/lib/audit/log.ts logAudit).
import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit/log";

interface RecordAdminAuditInput {
  actorUserId: string;
  actorEmail?: string | null;
  actorName?: string | null;
  /**
   * Org the action affects. REQUIRED (top-level, not in metadata): the
   * org-scoped audit view filters on this column, so a row without it is
   * invisible to the org admins it concerns.
   */
  organizationId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAdminAuditLog(input: RecordAdminAuditInput): Promise<void> {
  await logAudit({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    actorName: input.actorName ?? null,
    organizationId: input.organizationId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    targetLabel: input.targetLabel ?? null,
    metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
  });
}
