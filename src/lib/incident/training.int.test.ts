// Training incidents against Postgres (TEST_DATABASE_URL): provision and reset
// are idempotent and leave nothing behind, and a training incident reaches no
// one (no notification, digest, page or delivery row; no email, push or SMS)
// and never shows in lists, metrics, the executive dashboard, readiness or
// case-file and calendar exports. A real incident is the control.
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { sendMail } from "@/lib/email/transport";
import { sendPushToUser } from "@/lib/push";
import { sendMeteredSms } from "@/lib/delivery/metered";
import { hasTestDb, truncate } from "@/test/exercise-db";
import { createIncident, createMember, jsonRequest, memberSession, params, type TestMember } from "@/test/incident-db";
import { provisionTrainingIncident, findTrainingIncident } from "./training";
import { notify } from "@/lib/notifications/dispatch";
import { createNotification } from "@/lib/notifications";
import { deliverPage } from "@/lib/delivery/engine";
import { escalateOverduePages } from "@/lib/escalation/engine";
import { gatherIncident } from "@/lib/export/gather";
import { buildIncidentIcs } from "@/lib/ics/incident-feed";
import { computeIncidentMetrics } from "@/lib/metrics/incident-metrics";
import { buildExecutiveDashboard } from "@/lib/exercise/program/executive";
import { readinessInputs } from "@/lib/exercise/readiness/inputs";
import { buildProgramReport } from "@/lib/exercise/program/report";
import { loadActiveIncidents } from "@/lib/ops-room/incidents";
import { loadPracticeFacts } from "@/lib/onboarding/practice-facts";
import { GET as listIncidents } from "@/app/api/incidents/route";
import { PATCH as patchIncident } from "@/app/api/incidents/[id]/route";
import { POST as postTask } from "@/app/api/incidents/[id]/tasks/route";
import { POST as postAction } from "@/app/api/incidents/[id]/actions/route";
import { POST as postChat } from "@/app/api/incidents/[id]/chat/route";
import { POST as postPage } from "@/app/api/incidents/[id]/page/route";
import { POST as postStatusUpdate } from "@/app/api/incidents/[id]/status-updates/route";
import { POST as postStatusPage } from "@/app/api/incidents/[id]/status-page/route";
import { POST as postGuestInvite } from "@/app/api/incidents/[id]/guest-invites/route";
import { POST as postExport } from "@/app/api/incidents/[id]/export/route";
import { POST as provisionRoute } from "@/app/api/onboarding/training/provision/route";
import { POST as resetRoute } from "@/app/api/onboarding/training/reset/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/email/transport", async (orig) => ({ ...(await orig<typeof import("@/lib/email/transport")>()), sendMail: vi.fn(async () => ({ ok: true, transport: "smtp" })) }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn(async () => ({ sent: 1 })) }));
vi.mock("@/lib/delivery/metered", async (orig) => ({ ...(await orig<typeof import("@/lib/delivery/metered")>()), sendMeteredSms: vi.fn(async () => ({ ok: true })) }));

const TABLES = [
  "Incident", "IncidentAsset", "IncidentAction", "IncidentIndicator", "IncidentLink", "IncidentStatusUpdate", "IncidentCorrectiveAction",
  "IncidentPresence", "IncidentSubscription", "IncidentExport", "NotificationDigestItem", "Notification", "PageDelivery",
  "IncidentPlaybookRun", "SourceDocument", "User", "AuditEvent", "RateLimitBucket",
];

function as(m: TestMember) {
  vi.mocked(auth).mockResolvedValue(memberSession(m) as never);
}

async function egressRows() {
  const [notifications, digests, pages, deliveries] = await Promise.all([
    db.notification.count(),
    db.notificationDigestItem.count(),
    db.incidentPage.count(),
    db.pageDelivery.count(),
  ]);
  return { notifications, digests, pages, deliveries };
}

/** The same war-room work on an incident: assign a task, propose an action, chat, change status, post an update. */
async function work(m: TestMember, other: TestMember, incidentId: string) {
  as(m);
  const p = params({ id: incidentId });
  await db.incidentSubscription.create({ data: { incidentId, userId: other.id, mode: "watch" } });
  const task = await postTask(jsonRequest("/x", "POST", { title: "Check the backup", assigneeId: other.id }), p);
  expect(task.status).toBeLessThan(300);
  const action = await postAction(jsonRequest("/x", "POST", { phase: "containment", title: "Block the C2 address" }), p);
  expect(action.status).toBeLessThan(300);
  const chat = await postChat(jsonRequest("/x", "POST", { message: `@${other.name} please join` }), p);
  expect(chat.status).toBeLessThan(300);
  const patched = await patchIncident(jsonRequest("/x", "PATCH", { status: "contained" }), p);
  expect(patched.status).toBeLessThan(300);
  const update = await postStatusUpdate(jsonRequest("/x", "POST", { audience: "public", headline: "Contained", body: "Contained.", postToStatusPage: true }), p);
  expect(update.status).toBeLessThan(300);
}

describe.skipIf(!hasTestDb)("training incidents (integration)", () => {
  beforeEach(async () => {
    await truncate(...TABLES);
    vi.mocked(sendMail).mockClear();
    vi.mocked(sendPushToUser).mockClear();
    vi.mocked(sendMeteredSms).mockClear();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("provisions one per member, idempotently, even when called at the same time", async () => {
    const c = await createMember("contributor");
    const other = await createMember("contributor");
    const results = await Promise.all([provisionTrainingIncident(c.id), provisionTrainingIncident(c.id), provisionTrainingIncident(c.id)]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await provisionTrainingIncident(c.id)).toEqual({ id: results[0].id, created: false });
    expect(await db.incident.count({ where: { isTraining: true } })).toBe(1);

    // Another member gets their own.
    const theirs = await provisionTrainingIncident(other.id);
    expect(theirs.id).not.toBe(results[0].id);

    // Seeded so there is something to work.
    const id = results[0].id;
    const inc = await db.incident.findUniqueOrThrow({ where: { id }, select: { isTraining: true, reportedById: true, restricted: true } });
    expect(inc).toEqual({ isTraining: true, reportedById: c.id, restricted: false });
    expect(await db.incidentTask.count({ where: { incidentId: id } })).toBe(3);
    expect(await db.incidentAction.count({ where: { incidentId: id } })).toBe(2);
    expect(await db.incidentRoleAssignment.findFirst({ where: { incidentId: id, role: "incident_commander" }, select: { userId: true } })).toEqual({ userId: c.id });
  });

  it("resets cleanly and idempotently, then provisions a fresh one", async () => {
    const c = await createMember("contributor");
    as(c);
    const first = await (await provisionRoute()).json();
    expect(first.created).toBe(true);
    const id = first.incidentId as string;
    // Learner work in scalar-FK tables that must not orphan.
    await db.incidentPresence.create({ data: { organizationId: c.organizationId, incidentId: id, userId: c.id } });
    await postStatusUpdate(jsonRequest("/x", "POST", { headline: "Update", body: "Text." }), params({ id }));

    expect(await (await resetRoute()).json()).toEqual({ deleted: true });
    expect(await (await resetRoute()).json()).toEqual({ deleted: false });
    expect(await findTrainingIncident(c.id)).toBeNull();
    for (const model of ["incidentAsset", "incidentAction", "incidentIndicator", "incidentStatusUpdate", "incidentPresence", "incidentTask", "incidentLedgerEntry"] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(await (db[model] as any).count({ where: { incidentId: id } }), model).toBe(0);
    }

    const again = await (await provisionRoute()).json();
    expect(again.created).toBe(true);
    expect(again.incidentId).not.toBe(id);
  });

  it("readers cannot provision or reset", async () => {
    const r = await createMember("reader");
    as(r);
    expect((await provisionRoute()).status).toBe(403);
    expect((await resetRoute()).status).toBe(403);
  });

  it("reaches no one: no delivery rows, email, push or SMS (a real incident does notify)", async () => {
    const c = await createMember("contributor", "Casey Contributor");
    const other = await createMember("contributor", "Robin");
    const { id } = await provisionTrainingIncident(c.id);

    await work(c, other, id);
    as(c);
    const page = await postPage(jsonRequest("/x", "POST", { userId: other.id }), params({ id }));
    expect(page.status).toBe(409);
    expect((await postStatusPage(jsonRequest("/x", "POST", { isPublished: true }), params({ id }))).status).toBe(409);
    expect((await postGuestInvite(jsonRequest("/x", "POST", { email: "guest@example.test" }), params({ id }))).status).toBe(409);
    expect(await notify({ event: "task_assigned", organizationId: c.organizationId, title: "t", body: "b", incidentId: id, recipientIds: [other.id] })).toMatchObject({ recipients: 0 });
    expect(await createNotification(other.id, "incident_page", "t", "b", { incidentId: id }, `/incidents/${id}`)).toBeNull();
    expect(await createNotification(other.id, "incident_page", "t", "b", undefined, `/incidents/${id}/sitrep`)).toBeNull();

    // Backstops: a page row that somehow exists is never delivered or escalated.
    const stray = await db.incidentPage.create({
      data: { organizationId: c.organizationId, incidentId: id, targetUserId: other.id, ackDeadlineAt: new Date(Date.now() - 60_000) },
    });
    expect(await deliverPage(stray.id)).toMatchObject({ outcomes: [], skippedReason: "training_incident" });
    await escalateOverduePages();
    expect(await db.incidentPage.findUniqueOrThrow({ where: { id: stray.id }, select: { escalationLevel: true, status: true } })).toEqual({ escalationLevel: 0, status: "sent" });
    await db.incidentPage.delete({ where: { id: stray.id } });

    expect(await egressRows()).toEqual({ notifications: 0, digests: 0, pages: 0, deliveries: 0 });
    expect(sendMail).not.toHaveBeenCalled();
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(sendMeteredSms).not.toHaveBeenCalled();

    // Control: the same work on a real incident notifies the other member.
    const real = await createIncident(c, { title: "Real incident" });
    await work(c, other, real.id);
    expect(await db.notification.count({ where: { userId: other.id } })).toBeGreaterThan(0);
  });

  it("stays out of lists, metrics, the executive dashboard, readiness and exports", async () => {
    const admin = await createMember("administrator");
    const c = await createMember("contributor");
    const { id } = await provisionTrainingIncident(c.id);
    const real = await createIncident(c, { title: "Real incident" });
    const playbook = await db.sourceDocument.create({ data: { organizationId: admin.organizationId, kind: "playbook", title: "IR playbook", text: "# IR", sha256: "a".repeat(64), scope: "local" } });
    await db.incidentPlaybookRun.create({
      data: { organizationId: admin.organizationId, incidentId: id, documentId: playbook.id, documentTitle: playbook.title, documentSha256: playbook.sha256, createdById: c.id },
    });

    for (const m of [admin, c]) {
      const user = { id: m.id, organizationId: m.organizationId, role: m.role };
      as(m);
      const list = (await (await listIncidents(new Request("http://localhost/api/incidents"))).json()) as { id: string }[];
      expect(list.map((i) => i.id)).toEqual([real.id]);
      const metrics = await computeIncidentMetrics(user, { windowDays: 30 });
      expect(JSON.stringify(metrics)).not.toContain(id);
      expect(metrics.total).toBe(1);
      expect((await loadActiveIncidents(user)).total).toBe(1);
    }

    const dash = await buildExecutiveDashboard({ id: admin.id, organizationId: admin.organizationId, role: "administrator" });
    expect(dash.incidents.open).toBe(1);

    const now = new Date();
    const inputs = await readinessInputs(await buildProgramReport({ from: new Date(now.getTime() - 365 * 86_400_000), to: now }, now), now);
    expect(inputs.playbooks).toMatchObject({ own: 1, run: 0, used: 0 });

    // Case-file and calendar exports.
    expect(await gatherIncident(id, c.organizationId, "internal")).toBeNull();
    expect(await gatherIncident(real.id, c.organizationId, "internal")).not.toBeNull();
    expect(await buildIncidentIcs(id)).toBeNull();
    const { privateKey } = generateKeyPairSync("ed25519");
    const prev = process.env.EXPORT_SIGNING_PRIVATE_KEY;
    process.env.EXPORT_SIGNING_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    try {
      as(admin);
      const res = await postExport(jsonRequest("/x", "POST"), params({ id }));
      expect(res.status).toBe(409);
      expect(await db.incidentExport.count()).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.EXPORT_SIGNING_PRIVATE_KEY;
      else process.env.EXPORT_SIGNING_PRIVATE_KEY = prev;
    }
  });

  it("counts toward the onboarding step only once opened, worked and updated", async () => {
    const c = await createMember("contributor");
    expect((await loadPracticeFacts(c)).training).toBeNull();
    const { id } = await provisionTrainingIncident(c.id);
    expect((await loadPracticeFacts(c)).training).toEqual({ incidentId: id, opened: false, worked: false, statusUpdate: false });

    as(c);
    await db.incidentPresence.create({ data: { organizationId: c.organizationId, incidentId: id, userId: c.id } });
    await postTask(jsonRequest("/x", "POST", { title: "My task" }), params({ id }));
    expect((await loadPracticeFacts(c)).training).toMatchObject({ opened: true, worked: true, statusUpdate: false });
    await postStatusUpdate(jsonRequest("/x", "POST", { audience: "internal", headline: "Update", body: "Text." }), params({ id }));
    expect((await loadPracticeFacts(c)).training).toMatchObject({ opened: true, worked: true, statusUpdate: true });

    const reader = await createMember("reader");
    expect(await loadPracticeFacts(reader)).toMatchObject({ canIncidents: false, canExercises: false, canDocuments: false, training: null });
  });
});
