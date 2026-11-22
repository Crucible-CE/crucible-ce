import { db } from "@/lib/db";
import { liveIncidentWhere } from "@/lib/incident/live";

export type ExportMode = "legal" | "regulator" | "internal";

export interface GatheredEvidence {
  id: string; filename: string; mimeType: string; sizeBytes: number; sha256: string;
  category: string | null; description: string | null; uploadedByName: string | null; createdAt: Date;
}

// The full, point-in-time incident record for a case-file export. `mode`
// labels the package's audience (legal / regulator / internal); the content is
// the complete record in every mode (CE v0.1 has no legal-privilege marking).
export interface GatheredIncident {
  exportMode: ExportMode;
  generatedAt: string;
  incident: Record<string, unknown>;
  timeline: { action: string; notes: string | null; actor: string | null; at: Date }[];
  decisions: { id: string; title: string; rationale: string | null; status: string; decidedBy: string | null; at: Date }[];
  tasks: { id: string; title: string; status: string; priority: string; assignee: string | null; acknowledgedAt: Date | null; createdAt: Date }[];
  evidence: GatheredEvidence[];
  chat: { userName: string; message: string; at: Date }[];
  sitreps: { content: string; by: string | null; at: Date }[];
  comms: { stakeholder: string; channel: string | null; status: string; notes: string | null; notifiedAt: Date | null }[];
  pages: { target: string | null; message: string | null; priority: string; status: string; at: Date }[];
  roster: { role: string; name: string }[];
  participants: { name: string; role: string; email: string | null }[];
  ledger: { seq: number; eventType: string; actor: string | null; payload: unknown; prevHash: string; entryHash: string; at: Date }[];
  postmortem: Record<string, unknown> | null;
  /** Playbooks run as checklists on the incident, with every check-off. */
  playbooks: {
    title: string;
    documentSha256: string;
    attachedBy: string | null;
    attachedAt: Date;
    status: string;
    steps: { section: string; text: string; kind: string; source: string; doneBy: string | null; doneAt: Date | null; taskId: string | null }[];
  }[];
}

export async function gatherIncident(incidentId: string, organizationId: string, mode: ExportMode): Promise<GatheredIncident | null> {
  const incident = await db.incident.findFirst({ where: liveIncidentWhere({ id: incidentId, organizationId, isTraining: false }) });
  if (!incident) return null;

  // Name map for resolving the few id-only fields.
  const users = await db.user.findMany({ where: { organizationId }, select: { id: true, name: true, email: true } });
  const nameOf = (id: string | null | undefined) => (id ? users.find((u) => u.id === id)?.name ?? users.find((u) => u.id === id)?.email ?? null : null);

  const [activity, decisions, tasks, evidence, chat, sitreps, comms, pages, roles, participants, ledger, postmortem, playbooks] = await Promise.all([
    db.incidentActivity.findMany({ where: { incidentId }, orderBy: { timestamp: "asc" }, select: { action: true, notes: true, userName: true, userId: true, timestamp: true } }),
    db.incidentDecision.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, rationale: true, status: true, decidedById: true, createdAt: true } }),
    db.incidentTask.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, status: true, priority: true, assigneeId: true, acknowledgedAt: true, createdAt: true } }),
    db.incidentEvidence.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" }, select: { id: true, filename: true, mimeType: true, sizeBytes: true, sha256: true, category: true, description: true, uploadedByName: true, createdAt: true } }),
    db.incidentChatMessage.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" }, select: { userName: true, message: true, createdAt: true } }),
    db.incidentSitrep.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" }, select: { content: true, generatedByName: true, createdAt: true } }),
    db.incidentStakeholderNotification.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" }, select: { stakeholder: true, channel: true, status: true, notes: true, notifiedAt: true } }),
    db.incidentPage.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" }, select: { targetLabel: true, message: true, priority: true, status: true, createdAt: true } }),
    db.incidentRoleAssignment.findMany({ where: { incidentId }, select: { role: true, userId: true, escalationContactId: true } }),
    db.incidentParticipant.findMany({ where: { incidentId }, select: { userName: true, role: true, userEmail: true } }),
    db.incidentLedgerEntry.findMany({ where: { incidentId }, orderBy: { seq: "asc" }, select: { seq: true, eventType: true, actorLabel: true, payloadJson: true, prevHash: true, entryHash: true, createdAt: true } }),
    db.incidentPostmortem.findUnique({ where: { incidentId } }),
    db.incidentPlaybookRun.findMany({
      where: { incidentId },
      orderBy: { createdAt: "asc" },
      select: {
        documentTitle: true,
        documentSha256: true,
        createdByName: true,
        createdAt: true,
        status: true,
        steps: { orderBy: { position: "asc" }, select: { section: true, text: true, kind: true, source: true, doneByName: true, doneAt: true, taskId: true } },
      },
    }),
  ]);

  return {
    exportMode: mode,
    generatedAt: new Date().toISOString(),
    incident: incident as unknown as Record<string, unknown>,
    timeline: activity.map((a) => ({ action: a.action, notes: a.notes, actor: a.userName ?? nameOf(a.userId), at: a.timestamp })),
    decisions: decisions.map((d) => ({
      id: d.id,
      title: d.title,
      rationale: d.rationale,
      status: d.status,
      decidedBy: nameOf(d.decidedById),
      at: d.createdAt,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      assignee: nameOf(t.assigneeId),
      acknowledgedAt: t.acknowledgedAt,
      createdAt: t.createdAt,
    })),
    evidence: evidence.map((e) => ({ id: e.id, filename: e.filename, mimeType: e.mimeType, sizeBytes: e.sizeBytes, sha256: e.sha256, category: e.category, description: e.description, uploadedByName: e.uploadedByName, createdAt: e.createdAt })),
    chat: chat.map((c) => ({ userName: c.userName, message: c.message, at: c.createdAt })),
    sitreps: sitreps.map((s) => ({ content: s.content, by: s.generatedByName, at: s.createdAt })),
    comms: comms.map((c) => ({ stakeholder: c.stakeholder, channel: c.channel, status: c.status, notes: c.notes, notifiedAt: c.notifiedAt })),
    pages: pages.map((p) => ({ target: p.targetLabel, message: p.message, priority: p.priority, status: p.status, at: p.createdAt })),
    roster: roles.map((r) => ({ role: r.role, name: nameOf(r.userId) ?? "External contact" })),
    participants: participants.map((p) => ({ name: p.userName, role: p.role, email: p.userEmail })),
    ledger: ledger.map((l) => ({ seq: l.seq, eventType: l.eventType, actor: l.actorLabel, payload: l.payloadJson, prevHash: l.prevHash, entryHash: l.entryHash, at: l.createdAt })),
    postmortem: (postmortem as unknown as Record<string, unknown>) ?? null,
    playbooks: playbooks.map((r) => ({
      title: r.documentTitle,
      documentSha256: r.documentSha256,
      attachedBy: r.createdByName,
      attachedAt: r.createdAt,
      status: r.status,
      steps: r.steps.map((st) => ({ section: st.section, text: st.text, kind: st.kind, source: st.source, doneBy: st.doneByName, doneAt: st.doneAt, taskId: st.taskId })),
    })),
  };
}
