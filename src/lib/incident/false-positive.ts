// Shared false-positive workflow: close the incident, classify it, write a
// tamper-evident record, and notify. Used by both the desktop and mobile
// endpoints (each does its own auth first).
import { db } from "@/lib/db";
import { appendLedger } from "@/lib/ledger/append";
import { notify } from "@/lib/notifications/dispatch";
import { fpReasonLabel } from "./disposition";
import { cancelOpenPagesForIncident } from "@/lib/escalation/engine";
import { liveIncidentWhere } from "@/lib/incident/live";

export type FpResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export async function markIncidentFalsePositive(args: {
  incidentId: string;
  organizationId: string;
  userId: string;
  actorLabel: string | null;
  reason: string;
  note?: string | null;
}): Promise<FpResult> {
  const { incidentId, organizationId, userId, actorLabel, reason } = args;
  const note = args.note?.trim() || null;

  const incident = await db.incident.findFirst({
    where: liveIncidentWhere({ id: incidentId, organizationId }),
    select: { id: true, title: true, status: true, closureDisposition: true, resolvedAt: true },
  });
  // The lock (read-only except IC/admins) is enforced by the caller via
  // assertIncidentWritable, after its own access check.
  if (!incident) return { ok: false, status: 404, error: "Not found" };
  if (incident.closureDisposition === "false_positive") return { ok: false, status: 409, error: "Already marked as a false positive" };

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.incident.update({
      where: { id: incidentId },
      data: {
        status: "closed",
        closureDisposition: "false_positive",
        closureReason: reason,
        closureNote: note,
        closedById: userId,
        closedAt: now,
        resolvedAt: incident.resolvedAt ?? now,
      },
    });

    // Closing stops paging: no escalation or delivery retry after close.
    await cancelOpenPagesForIncident(incidentId, tx);

    await appendLedger(tx, {
      incidentId, organizationId, eventType: "false_positive_marked", actorUserId: userId, actorLabel,
      payload: { reason, note },
    });

    await tx.incidentActivity.create({
      data: { incidentId, userId, userName: actorLabel, action: "false_positive", notes: `Closed as false positive: ${fpReasonLabel(reason)}.${note ? ` ${note}` : ""}`, metadata: { reason, note } },
    });
  });

  await notify({
    event: "status_changed", organizationId, incidentId, actorUserId: userId,
    title: "Incident closed: false positive",
    body: `"${incident.title}" was classified a false positive (${fpReasonLabel(reason)}).`,
    link: `/incidents/${incidentId}`, metadata: { incidentId, disposition: "false_positive", reason },
  }).catch(() => {});

  return { ok: true };
}
