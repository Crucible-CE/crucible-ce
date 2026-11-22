// Incident guest links against Postgres (TEST_DATABASE_URL): who may invite,
// what a guest link reaches (one incident only), and when it stops working.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { hasTestDb, truncate } from "@/test/exercise-db";
import { createIncident, createMember, jsonRequest, memberSession, params, type TestMember } from "@/test/incident-db";
import { GET as listInvites, POST as invite } from "@/app/api/incidents/[id]/guest-invites/route";
import { DELETE as revoke } from "@/app/api/incidents/[id]/guest-invites/[inviteId]/route";
import { GET as guestView } from "@/app/api/public/incident-guest/[token]/route";
import { POST as guestChat } from "@/app/api/public/incident-guest/[token]/chat/route";
import { GET as guestEvidence } from "@/app/api/public/incident-guest/[token]/evidence/route";
import { hashPublicToken } from "./guest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/email/transport", async (orig) => ({ ...(await orig<typeof import("@/lib/email/transport")>()), sendMail: vi.fn(async () => ({ ok: true, transport: "smtp" })) }));

function as(m: TestMember | null) {
  vi.mocked(auth).mockResolvedValue((m ? memberSession(m) : null) as never);
}

async function makeInvite(by: TestMember, incidentId: string, body: Record<string, unknown> = {}) {
  as(by);
  const res = await invite(jsonRequest(`/api/incidents/${incidentId}/guest-invites`, "POST", { email: "counsel@law.example", name: "Outside Counsel", sendEmail: false, ...body }), params({ id: incidentId }));
  return { res, body: (await res.json()) as { invite?: { id: string }; inviteUrl?: string; error?: string } };
}

const tokenOf = (url: string) => url.split("/incident-guest/")[1];
const guestGet = (token: string, qs = "") => guestView(new Request(`http://localhost/api/public/incident-guest/${token}${qs}`), params({ token }));

describe.skipIf(!hasTestDb)("incident guest links (integration)", () => {
  beforeEach(async () => {
    await truncate("Incident", "IncidentGuestInvite", "IncidentChatMessage", "IncidentLedgerEntry", "User", "AuditEvent", "RateLimitBucket");
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("the reporter invites; the token is stored hashed; the guest sees only that incident", async () => {
    const reporter = await createMember("contributor");
    const a = await createIncident(reporter, { title: "Incident A" });
    const b = await createIncident(reporter, { title: "Incident B" });
    await db.incidentChatMessage.create({ data: { incidentId: b.id, organizationId: reporter.organizationId, userId: reporter.id, userName: "R", message: "secret in B" } });
    const bMsg = await db.incidentChatMessage.findFirstOrThrow({ where: { incidentId: b.id } });
    await db.incidentChatMessage.create({ data: { incidentId: a.id, organizationId: reporter.organizationId, userId: reporter.id, userName: "R", message: "hello from A" } });

    const { res, body } = await makeInvite(reporter, a.id);
    expect(res.status).toBe(201);
    const token = tokenOf(body.inviteUrl!);
    const row = await db.incidentGuestInvite.findUniqueOrThrow({ where: { id: body.invite!.id } });
    expect(row.tokenHash).toBe(hashPublicToken(token));
    expect(row.tokenHash).not.toContain(token);

    const view = await guestGet(token);
    expect(view.status).toBe(200);
    const v = await view.json();
    expect(v.incident.id).toBe(a.id);
    expect(v.incident.title).toBe("Incident A");
    expect(Object.keys(v.incident).sort()).toEqual(["category", "createdAt", "declaredAt", "description", "id", "severity", "status", "title"]);
    expect(v.messages.map((m: { message: string }) => m.message)).toEqual(["hello from A"]);

    // A cursor from another incident never returns that incident's rows.
    const cross = await (await guestGet(token, `?after=${bMsg.id}`)).json();
    expect(cross.messages.some((m: { message: string }) => m.message === "secret in B")).toBe(false);

    // Guest chat lands on incident A only, authored as the guest.
    const posted = await guestChat(new Request(`http://localhost/api/public/incident-guest/${token}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "From counsel" }) }), params({ token }));
    expect(posted.status).toBe(201);
    const msg = await db.incidentChatMessage.findFirstOrThrow({ where: { message: "From counsel" } });
    expect(msg.incidentId).toBe(a.id);
    expect(msg.userName).toBe("Outside Counsel (guest)");

    const ev = await guestEvidence(new Request(`http://localhost/api/public/incident-guest/${token}/evidence`), params({ token }));
    expect(ev.status).toBe(200);

    const ledger = await db.incidentLedgerEntry.findMany({ where: { incidentId: a.id }, select: { eventType: true } });
    expect(ledger.map((l) => l.eventType)).toContain("guest_invited");
  });

  it("a reader cannot invite; a contributor who is not reporter or IC cannot invite", async () => {
    const reporter = await createMember("contributor");
    const other = await createMember("contributor");
    const reader = await createMember("reader");
    const inc = await createIncident(reporter);
    expect((await makeInvite(reader, inc.id)).res.status).toBe(403);
    expect((await makeInvite(other, inc.id)).res.status).toBe(403);
  });

  it("revoke, expiry, an unknown token and a lock made after the invite all end access", async () => {
    const admin = await createMember("administrator");
    const inc = await createIncident(admin);
    const one = await makeInvite(admin, inc.id);
    const two = await makeInvite(admin, inc.id, { email: "ir@firm.example" });
    const t1 = tokenOf(one.body.inviteUrl!);
    const t2 = tokenOf(two.body.inviteUrl!);

    as(admin);
    expect((await revoke(jsonRequest(`/api/incidents/${inc.id}/guest-invites/${one.body.invite!.id}`, "DELETE"), params({ id: inc.id, inviteId: one.body.invite!.id }))).status).toBe(200);
    expect((await guestGet(t1)).status).toBe(401);

    expect((await guestGet("f".repeat(64))).status).toBe(401);
    expect((await guestGet("not-a-token")).status).toBe(401);

    expect((await guestGet(t2)).status).toBe(200);
    await db.incident.update({ where: { id: inc.id }, data: { restricted: true, lockedAt: new Date() } });
    expect((await guestGet(t2)).status).toBe(401);
    as(admin);
    const list = await (await listInvites(jsonRequest(`/api/incidents/${inc.id}/guest-invites`, "GET"), params({ id: inc.id }))).json();
    const states = Object.fromEntries(list.invites.map((i: { email: string; state: string }) => [i.email, i.state]));
    expect(states).toEqual({ "counsel@law.example": "revoked", "ir@firm.example": "suspended" });

    // An administrator may invite on the locked incident; that link works.
    const three = await makeInvite(admin, inc.id, { email: "insurer@ins.example" });
    expect(three.res.status).toBe(201);
    expect((await guestGet(tokenOf(three.body.inviteUrl!))).status).toBe(200);

    await db.incidentGuestInvite.update({ where: { id: three.body.invite!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await guestGet(tokenOf(three.body.inviteUrl!))).status).toBe(401);
  });

  it("a locked incident: a participant contributor (not IC) cannot invite; a member outside it gets 404", async () => {
    const admin = await createMember("administrator");
    const participant = await createMember("contributor");
    const outsider = await createMember("contributor");
    const inc = await createIncident(admin, { restricted: true });
    await db.incidentParticipant.create({ data: { organizationId: admin.organizationId, incidentId: inc.id, userId: participant.id, userName: participant.name } });
    expect((await makeInvite(participant, inc.id)).res.status).toBe(403);
    expect((await makeInvite(outsider, inc.id)).res.status).toBe(404);
  });
});
