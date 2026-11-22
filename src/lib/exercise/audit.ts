// Exercise audit trail. Writes go to CE's AdminAuditLog through logAudit, so
// exercise actions show in the org admin audit view next to everything else.
// Fire-and-forget: auditing never blocks or fails the action it records.
//
//   audit({ actorUserId: user.id, action: "exercise.ended", targetType: "Exercise", targetId: id, data: { reason }, req });
//
// A guest has no user id. Its actor is recorded as "participant:<id>".

import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit/log";
import { db } from "@/lib/db";
import { installOrgId } from "@/lib/exercise/settings";
import { deriveActivityIp } from "@/lib/security/activity-log";

export interface AuditInput {
  actorUserId?: string | null;
  actorParticipantId?: string | null;
  /** Dotted verb, e.g. "exercise.created", "inject.released". */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  data?: Prisma.InputJsonValue;
  /** The request, to record a salted hash of the client IP. */
  req?: Request | { headers: Headers } | null;
}

function actorId(input: AuditInput): string {
  if (input.actorUserId) return input.actorUserId;
  if (input.actorParticipantId) return `participant:${input.actorParticipantId}`;
  return "system";
}

/** Awaitable form, for tests and callers that must know the write finished. */
export async function writeAudit(input: AuditInput): Promise<boolean> {
  try {
    const [organizationId, actor] = await Promise.all([
      installOrgId(),
      input.actorUserId ? db.user.findUnique({ where: { id: input.actorUserId }, select: { email: true, name: true } }) : null,
    ]);
    const ip = input.req ? deriveActivityIp(input.req) : null;
    const data = (input.data ?? {}) as Record<string, unknown>;
    await logAudit({
      actorUserId: actorId(input),
      actorEmail: actor?.email ?? null,
      actorName: actor?.name ?? null,
      organizationId,
      action: input.action.slice(0, 100),
      targetType: input.targetType ?? "Exercise",
      targetId: input.targetId ?? null,
      metadata: {
        ...data,
        ...(input.actorParticipantId ? { actorParticipantId: input.actorParticipantId } : {}),
        ...(ip?.ipHash ? { ipHash: ip.ipHash } : {}),
      } as Prisma.InputJsonValue,
    });
    return true;
  } catch (err) {
    console.error(`[audit] could not record ${input.action}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Record an audit event. Returns immediately; errors are logged, never thrown. */
export function audit(input: AuditInput): void {
  void writeAudit(input);
}
