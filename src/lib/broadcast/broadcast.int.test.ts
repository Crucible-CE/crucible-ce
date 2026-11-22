// Broadcast messaging against Postgres (TEST_DATABASE_URL): who may send, who
// it reaches (one organization, merged people), delivery rows per channel, and
// acknowledgement through the signed paging link.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { hasTestDb, truncate } from "@/test/exercise-db";
import { createMember, jsonRequest, memberSession, type TestMember } from "@/test/incident-db";
import { GET as listBroadcasts, POST as sendBroadcast } from "@/app/api/broadcasts/route";
import { GET as getBroadcast } from "@/app/api/broadcasts/[id]/route";
import { GET as ackGet, POST as ackPost } from "@/app/api/public/page-ack/[token]/route";
import { ackUrlFor } from "@/lib/delivery/engine";
import { resolveAudience } from "./audience";
import { deliverBroadcast, type CreatedBroadcast } from "./send";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

function as(m: TestMember) {
  vi.mocked(auth).mockResolvedValue(memberSession(m) as never);
}

const post = (body: unknown) => sendBroadcast(jsonRequest("/api/broadcasts", "POST", body));

async function waitForDeliveries(broadcastId: string, count: number) {
  for (let i = 0; i < 50; i++) {
    const n = await db.broadcastDelivery.count({ where: { broadcastId, status: { not: "pending" } } });
    if (n >= count) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("deliveries did not finish");
}

describe.skipIf(!hasTestDb)("broadcast messaging (integration)", () => {
  beforeEach(async () => {
    await truncate("Broadcast", "BroadcastRecipient", "BroadcastDelivery", "EscalationContact", "Notification", "User", "AuditEvent", "RateLimitBucket", "MeteredSend");
    await db.organization.deleteMany({ where: { id: "org-other-broadcast" } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("readers cannot send or list; contributors and administrators can", async () => {
    const reader = await createMember("reader");
    const contributor = await createMember("contributor");
    as(reader);
    expect((await post({ title: "T", message: "M", channels: ["app"], audience: { allMembers: true } })).status).toBe(403);
    expect((await listBroadcasts()).status).toBe(403);
    as(contributor);
    expect((await post({ title: "T", message: "M", channels: ["app"], audience: { allMembers: true } })).status).toBe(201);
    expect((await listBroadcasts()).status).toBe(200);
  });

  it("resolves an audience inside one organization and merges a linked contact into its member", async () => {
    const admin = await createMember("administrator", "Ada Admin");
    const reader = await createMember("reader", "Rey Reader");
    await db.organization.create({ data: { id: "org-other-broadcast", name: "Other", slug: "org-other-broadcast" } });
    await db.user.create({ data: { email: "stranger@other.test", name: "Stranger", role: "administrator", organizationId: "org-other-broadcast" } });
    await db.escalationContact.create({ data: { organizationId: admin.organizationId, name: "Ada as contact", role: "technical", userId: admin.id, email: "ada.alt@example.test" } });
    const external = await db.escalationContact.create({ data: { organizationId: admin.organizationId, name: "Outside counsel", role: "legal", tier: 2, email: "counsel@law.example", phone: "+15555550100" } });
    await db.escalationContact.create({ data: { organizationId: "org-other-broadcast", name: "Other contact", role: "legal" } });

    const everyone = await resolveAudience(admin.organizationId, { allMembers: true, allContacts: true });
    expect(everyone.map((t) => t.name).sort()).toEqual(["Ada Admin", "Outside counsel", "Rey Reader"]);
    const counsel = everyone.find((t) => t.contactId === external.id)!;
    expect(counsel.phone).toBeNull(); // unverified phone is never dialed
    expect(counsel.phoneBlocked).toBe("phone not verified");

    const admins = await resolveAudience(admin.organizationId, { roles: ["administrator"] });
    expect(admins.map((t) => t.userId)).toEqual([admin.id]);
    const legal = await resolveAudience(admin.organizationId, { contactRoles: ["legal"] });
    expect(legal.map((t) => t.name)).toEqual(["Outside counsel"]);
    expect((await resolveAudience(admin.organizationId, { userIds: [reader.id] })).map((t) => t.name)).toEqual(["Rey Reader"]);
  });

  it("records a delivery row per channel, sends in app, skips honestly, and acknowledges by link once", async () => {
    const sender = await createMember("contributor", "Sam Sender");
    const reader = await createMember("reader", "Rey Reader");
    as(sender);
    const res = await post({ title: "Bridge open", message: "Join the bridge now.", channels: ["app", "email", "sms"], audience: { userIds: [reader.id] } });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    await waitForDeliveries(id, 3);

    const rows = await db.broadcastDelivery.findMany({ where: { broadcastId: id }, orderBy: { channel: "asc" } });
    expect(rows.map((r) => [r.channel, r.status])).toEqual([
      ["app", "sent"],
      ["email", "skipped"],
      ["sms", "skipped"],
    ]);
    const note = await db.notification.findFirstOrThrow({ where: { userId: reader.id, type: "broadcast" } });
    expect(note.link).toMatch(/^\/api\/public\/page-ack\//);

    // A repeat delivery run sends nothing twice.
    const recipient = await db.broadcastRecipient.findFirstOrThrow({ where: { broadcastId: id } });
    const again: CreatedBroadcast = { id, recipients: [{ id: recipient.id, target: { userId: reader.id, contactId: null, name: "Rey Reader", email: reader.email, phone: null, phoneBlocked: null } }] };
    await deliverBroadcast(again);
    expect(await db.broadcastDelivery.count({ where: { broadcastId: id } })).toBe(3);
    expect(await db.notification.count({ where: { userId: reader.id, type: "broadcast" } })).toBe(1);

    const token = new URL(ackUrlFor(recipient.id, 0)).pathname.split("/").pop()!;
    const p = { params: Promise.resolve({ token }) };
    expect((await ackGet(new Request("http://localhost/x"), p)).status).toBe(200);
    expect((await db.broadcastRecipient.findUniqueOrThrow({ where: { id: recipient.id } })).acknowledgedAt).toBeNull();
    expect((await ackPost(new Request("http://localhost/x", { method: "POST" }), p)).status).toBe(200);
    expect((await ackPost(new Request("http://localhost/x", { method: "POST" }), p)).status).toBe(409);
    const acked = await db.broadcastRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
    expect(acked.acknowledgedVia).toBe("link");

    as(sender);
    const detail = await (await getBroadcast(new Request("http://localhost/x"), { params: Promise.resolve({ id }) })).json();
    expect(detail.broadcast.ackedCount).toBe(1);
    expect(detail.broadcast.channelSummary.app.sent).toBe(1);
  });
});
