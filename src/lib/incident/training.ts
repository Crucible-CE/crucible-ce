// Training incident: the per-member onboarding sandbox for the war room
// (ported from Crucible Cloud). Each member gets their own (reportedById = the
// learner, isTraining = true) so nobody collides and everyone starts clean.
//
// Fail-closed inert: lists, counts, metrics, SLAs, reports, readiness and the
// executive dashboard leave it out (accessibleIncidentsWhere excludeTraining,
// isTraining: false), and every egress asks lib/incident/training-guard first
// (notify, createNotification, paging and delivery, escalation, status pages,
// guest links, case-file and calendar exports).
//
// Provision is idempotent (one per member, serialized by an advisory lock).
// Reset deletes it and everything under it so the member can start again.

import { db } from "@/lib/db";
import { deleteEvidence } from "@/lib/evidence/storage";
import { liveIncidentWhere } from "./live";

export const TRAINING_TITLE = "Ransomware on FIN-DB-02 (Training)";

const TRAINING_DESCRIPTION =
  "Training incident. Not real. The SIEM flagged mass file encryption on the finance database host FIN-DB-02 at 02:14, " +
  "and a ransom note appeared on the finance share. Payments are slowing down. Work it like a real incident: " +
  "take the tasks, approve the containment action, post a status update and write the postmortem. " +
  "Nothing here pages, notifies or reaches anyone outside this room.";

/** The member's training incident, if any. */
export async function findTrainingIncident(userId: string): Promise<{ id: string; createdAt: Date } | null> {
  return db.incident.findFirst({
    where: liveIncidentWhere({ reportedById: userId, isTraining: true }),
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Provision the member's training incident and its seeded rows in one
 * transaction. Idempotent: a second call (or a concurrent one) returns the
 * same incident.
 */
export async function provisionTrainingIncident(userId: string): Promise<{ id: string; created: boolean }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { organizationId: true, name: true, email: true } });
  if (!user?.organizationId) throw new Error("provisionTrainingIncident: user not found");
  const orgId = user.organizationId;
  const userName = user.name ?? user.email ?? "You";

  return db.$transaction(async (tx) => {
    // One provision per member at a time: the re-check below sees a row a
    // concurrent call just committed.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`training-incident:${userId}`}))`;
    const existing = await tx.incident.findFirst({
      where: liveIncidentWhere({ reportedById: userId, isTraining: true }),
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const now = new Date();
    const at = (min: number) => new Date(now.getTime() + min * 60_000);

    const incident = await tx.incident.create({
      data: {
        organizationId: orgId,
        reportedById: userId,
        title: TRAINING_TITLE,
        description: TRAINING_DESCRIPTION,
        severity: "high",
        category: "malware",
        status: "investigating",
        source: "siem",
        isTraining: true,
        declaredAt: now,
        affectedSystems: ["FIN-DB-02", "svc-payments"],
        timelineJson: [{ timestamp: now.toISOString(), event: "Training incident opened", userId }],
      },
      select: { id: true },
    });
    const id = incident.id;

    const finDb = await tx.incidentAsset.create({
      data: {
        organizationId: orgId,
        incidentId: id,
        createdById: userId,
        name: "FIN-DB-02",
        assetType: "host",
        identifier: "10.20.4.12",
        criticality: "critical",
        status: "affected",
        dataClassification: "financial",
        owner: "Database team",
        notes: "Primary finance database host. Mass file encryption seen at 02:14.",
      },
      select: { id: true },
    });
    await tx.incidentAsset.createMany({
      data: [
        { organizationId: orgId, incidentId: id, createdById: userId, name: "svc-payments", assetType: "service", identifier: "svc-payments.prod", criticality: "high", status: "investigating", owner: "Payments", notes: "Depends on FIN-DB-02. Degraded." },
        { organizationId: orgId, incidentId: id, createdById: userId, name: "svc-finance-batch", assetType: "account", identifier: "svc-finance-batch", criticality: "medium", status: "investigating", owner: "IT", notes: "Service account seen signing in from the C2 address." },
      ],
    });

    // One high-risk containment action waiting for approval (the approval
    // gate), plus recovery work.
    await tx.incidentAction.createMany({
      data: [
        {
          organizationId: orgId,
          incidentId: id,
          requestedById: userId,
          phase: "containment",
          title: "Isolate FIN-DB-02 from the network",
          description: "Stops the spread. Takes the finance database offline, so the incident commander approves it first.",
          highRisk: true,
          approvalStatus: "pending",
          dueAt: at(60),
          assetIdsJson: [finDb.id],
        },
        {
          organizationId: orgId,
          incidentId: id,
          requestedById: userId,
          phase: "recovery",
          title: "Restore the payments database from the 02:00 backup",
          description: "Check the restore point is clean before cutover.",
          dueAt: at(12 * 60),
        },
      ],
    });

    await tx.incidentIndicator.createMany({
      data: [
        { organizationId: orgId, incidentId: id, createdById: userId, indicatorType: "ip", value: "203.0.113.47", source: "SIEM", note: "C2 beacon destination." },
        { organizationId: orgId, incidentId: id, createdById: userId, indicatorType: "domain", value: "pay-decrypt-now.example", source: "Analyst", note: "Payment site named in the ransom note." },
      ],
    });

    await tx.incidentTask.createMany({
      data: [
        { organizationId: orgId, incidentId: id, title: "Confirm which finance data is encrypted", description: "List the affected tables and whether any hold personal or card data.", assigneeId: userId, assignedById: userId, assignedAt: now, priority: "high", dueAt: at(3 * 60) },
        { organizationId: orgId, incidentId: id, title: "Disable the svc-finance-batch account", description: "It signed in from the C2 address just before encryption started.", assigneeId: userId, assignedById: userId, assignedAt: now, priority: "high", dueAt: at(60) },
        { organizationId: orgId, incidentId: id, title: "Check the 02:00 backup is clean", description: "Restore it to an isolated host and scan it.", priority: "medium", dueAt: at(6 * 60) },
      ],
    });

    await tx.incidentDecision.create({
      data: {
        organizationId: orgId,
        incidentId: id,
        title: "Do we contact the attacker?",
        context: "The 02:00 backup looks clean. Counsel should weigh in before any contact.",
        options: ["Restore from backup and do not engage", "Engage to buy time", "Wait for counsel"],
        dueAt: at(2 * 60),
      },
    });

    await tx.incidentActivity.createMany({
      data: [
        { incidentId: id, userId, userName, action: "declared", notes: "Training incident opened.", timestamp: now },
        { incidentId: id, userId, userName, action: "note_added", notes: "SIEM flagged mass file encryption on FIN-DB-02 at 02:14.", timestamp: at(1) },
      ],
    });

    await tx.incidentChatMessage.createMany({
      data: [
        { incidentId: id, organizationId: orgId, userId, userName, message: "FIN-DB-02 is encrypting the finance share. Opening the war room." },
        { incidentId: id, organizationId: orgId, userId, userName, message: "EDR shows svc-finance-batch signing in from 203.0.113.47 just before it started." },
      ],
    });

    // The learner holds the incident commander seat (approves the action).
    await tx.incidentRoleAssignment.create({ data: { organizationId: orgId, incidentId: id, role: "incident_commander", userId } });

    return { id, created: true };
  });
}

/**
 * Delete the member's training incident and everything under it. Relation
 * children cascade; the scalar-FK children (seeded and learner-made) are
 * removed explicitly so nothing orphans. Evidence files are removed from
 * storage after the rows. Returns false when there was nothing to reset.
 */
export async function resetTrainingIncident(userId: string): Promise<boolean> {
  const existing = await findTrainingIncident(userId);
  if (!existing) return false;
  const id = existing.id;
  const row = await db.incident.findFirst({ where: liveIncidentWhere({ id, isTraining: true }), select: { organizationId: true } });
  if (!row) return false;

  const [evidence, attachments] = await Promise.all([
    db.incidentEvidence.findMany({ where: { incidentId: id }, select: { id: true } }),
    db.incidentTaskAttachment.findMany({ where: { incidentId: id }, select: { id: true } }),
  ]);

  await db.$transaction([
    db.incidentAsset.deleteMany({ where: { incidentId: id } }),
    db.incidentAction.deleteMany({ where: { incidentId: id } }),
    db.incidentIndicator.deleteMany({ where: { incidentId: id } }),
    db.incidentLink.deleteMany({ where: { OR: [{ incidentId: id }, { relatedIncidentId: id }] } }),
    db.incidentStatusUpdate.deleteMany({ where: { incidentId: id } }),
    db.incidentCorrectiveAction.deleteMany({ where: { incidentId: id } }),
    db.incidentPresence.deleteMany({ where: { incidentId: id } }),
    db.incidentSubscription.deleteMany({ where: { incidentId: id } }),
    db.incidentExport.deleteMany({ where: { incidentId: id } }),
    db.notificationDigestItem.deleteMany({ where: { incidentId: id } }),
    db.incident.delete({ where: { id, isTraining: true } }),
  ]);

  for (const f of [...evidence, ...attachments]) {
    await deleteEvidence(row.organizationId, id, f.id).catch(() => {});
  }
  return true;
}
