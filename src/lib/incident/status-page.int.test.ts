// Public status pages against Postgres (TEST_DATABASE_URL): the page shows
// only updates posted to it (eligible audience, not retracted), never internal
// data; posting notifies confirmed subscribers only; subscribe is double
// opt-in; unsubscribe links are signed.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { sendMail } from "@/lib/email/transport";
import { hasTestDb, truncate } from "@/test/exercise-db";
import { createIncident, createMember, jsonRequest, memberSession, params, type TestMember } from "@/test/incident-db";
import { POST as pageSettings } from "@/app/api/incidents/[id]/status-page/route";
import { POST as publishUpdate } from "@/app/api/incidents/[id]/status-updates/route";
import { POST as unpublishUpdate } from "@/app/api/incidents/[id]/status-updates/[updateId]/unpublish/route";
import { GET as publicJson } from "@/app/api/public/status/[token]/route";
import { POST as subscribe } from "@/app/api/public/status/[token]/subscribe/route";
import { GET as confirmGet, POST as confirmPost } from "@/app/api/public/status-confirm/[token]/route";
import { POST as unsubscribePost } from "@/app/api/public/status-unsubscribe/[token]/route";
import { createUnsubscribeToken, notifyStatusPageSubscribers } from "./status-page";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/email/transport", async (orig) => ({ ...(await orig<typeof import("@/lib/email/transport")>()), sendMail: vi.fn(async () => ({ ok: true, transport: "smtp" })) }));

function as(m: TestMember) {
  vi.mocked(auth).mockResolvedValue(memberSession(m) as never);
}

const tokenOf = (url: string) => url.split("/status/")[1];
const readPage = async (token: string) => publicJson(new Request(`http://localhost/api/public/status/${token}`), params({ token }));

async function publish(m: TestMember, incidentId: string, body: Record<string, unknown>) {
  as(m);
  const res = await publishUpdate(jsonRequest(`/api/incidents/${incidentId}/status-updates`, "POST", body), params({ id: incidentId }));
  return (await res.json()) as { update: { id: string }; statusPage?: { posted: boolean; error?: string } };
}

const mailsTo = (addr: string) => vi.mocked(sendMail).mock.calls.filter(([m]) => m.to === addr);

describe.skipIf(!hasTestDb)("public status page (integration)", () => {
  beforeEach(async () => {
    await truncate("Incident", "IncidentStatusPage", "StatusPageSubscriber", "IncidentStatusUpdate", "IncidentLedgerEntry", "User", "AuditEvent", "RateLimitBucket");
    vi.mocked(sendMail).mockClear();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("shows only posted, eligible, unretracted updates and no internal data", async () => {
    const c = await createMember("contributor");
    const inc = await createIncident(c, { title: "Ransomware on FS01 (internal)", description: "Internal notes: attacker on DC02." });
    as(c);
    const created = await pageSettings(jsonRequest(`/api/incidents/${inc.id}/status-page`, "POST", { title: "Email service disruption", isPublished: true }), params({ id: inc.id }));
    expect(created.status).toBe(201);
    const token = tokenOf((await created.json()).publicUrl);

    const posted = await publish(c, inc.id, { audience: "public", headline: "Investigating", body: "We are looking into it.", postToStatusPage: true });
    expect(posted.statusPage?.posted).toBe(true);
    await publish(c, inc.id, { audience: "public", headline: "Not posted", body: "Published but not on the page." });
    await publish(c, inc.id, { audience: "internal", headline: "Internal only", body: "Attacker on DC02.", postToStatusPage: true });
    const customer = await publish(c, inc.id, { audience: "customer", headline: "Customer note", body: "For customers.", postToStatusPage: true });
    expect(customer.statusPage?.posted).toBe(false); // page shows public updates only
    const retracted = await publish(c, inc.id, { audience: "public", headline: "Retracted", body: "Wrong.", postToStatusPage: true });
    as(c);
    await unpublishUpdate(jsonRequest("/x", "POST"), params({ id: inc.id, updateId: retracted.update.id }));

    const res = await readPage(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=30");
    const page = await res.json();
    expect(page.title).toBe("Email service disruption");
    expect(page.status).toBe("Investigating");
    expect(page.updates.map((u: { headline: string }) => u.headline)).toEqual(["Investigating"]);
    const raw = JSON.stringify(page);
    expect(raw).not.toContain("FS01");
    expect(raw).not.toContain("DC02");
    expect(raw).not.toContain(inc.id);

    // Taking the page offline, or locking the incident, makes it a 404.
    as(c);
    await pageSettings(jsonRequest(`/api/incidents/${inc.id}/status-page`, "POST", { isPublished: false }), params({ id: inc.id }));
    expect((await readPage(token)).status).toBe(404);
    as(c);
    await pageSettings(jsonRequest(`/api/incidents/${inc.id}/status-page`, "POST", { isPublished: true }), params({ id: inc.id }));
    expect((await readPage(token)).status).toBe(200);
    await db.incident.update({ where: { id: inc.id }, data: { restricted: true } });
    expect((await readPage(token)).status).toBe(404);
  });

  it("a locked incident cannot get a status page; a reader cannot create one", async () => {
    const admin = await createMember("administrator");
    const reader = await createMember("reader");
    const locked = await createIncident(admin, { restricted: true });
    as(admin);
    expect((await pageSettings(jsonRequest("/x", "POST", { title: "T" }), params({ id: locked.id }))).status).toBe(403);
    const open = await createIncident(admin);
    as(reader);
    expect((await pageSettings(jsonRequest("/x", "POST", { title: "T" }), params({ id: open.id }))).status).toBe(403);
  });

  it("double opt-in: only confirmed subscribers get updates; unsubscribe stops them", async () => {
    const c = await createMember("contributor");
    const inc = await createIncident(c);
    as(c);
    const created = await pageSettings(jsonRequest(`/api/incidents/${inc.id}/status-page`, "POST", { title: "Portal outage", isPublished: true }), params({ id: inc.id }));
    const token = tokenOf((await created.json()).publicUrl);
    const sub = (email: string) => subscribe(new Request(`http://localhost/api/public/status/${token}/subscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }), params({ token }));

    expect((await sub("Alice@Example.test")).status).toBe(200);
    expect((await sub("bob@example.test")).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const confirmMail = mailsTo("alice@example.test")[0]?.[0];
    expect(confirmMail?.text).toContain("/api/public/status-confirm/");
    const confirmToken = /status-confirm\/([a-f0-9]{64})/.exec(confirmMail!.text!)![1];

    // GET changes nothing (mail scanners); POST confirms.
    await confirmGet(new Request("http://localhost/x"), params({ token: confirmToken }));
    expect((await db.statusPageSubscriber.findFirstOrThrow({ where: { email: "alice@example.test" } })).confirmedAt).toBeNull();
    await confirmPost(new Request("http://localhost/x", { method: "POST" }), params({ token: confirmToken }));
    const alice = await db.statusPageSubscriber.findFirstOrThrow({ where: { email: "alice@example.test" } });
    expect(alice.confirmedAt).not.toBeNull();

    const page = await db.incidentStatusPage.findUniqueOrThrow({ where: { incidentId: inc.id } });
    vi.mocked(sendMail).mockClear();
    expect(await notifyStatusPageSubscribers(page.id, { headline: "Fixed", body: "All good." })).toBe(1);
    const update = vi.mocked(sendMail).mock.calls[0][0];
    expect(update.to).toBe("alice@example.test");
    expect(update.headers?.["List-Unsubscribe"]).toContain("/api/public/status-unsubscribe/");
    expect(mailsTo("bob@example.test")).toHaveLength(0);

    // A forged unsubscribe token does nothing; the signed one works.
    await unsubscribePost(new Request("http://localhost/x", { method: "POST" }), params({ token: `${alice.id}.AAAAAAAAAAAAAAAAAAAAAA` }));
    expect((await db.statusPageSubscriber.findUniqueOrThrow({ where: { id: alice.id } })).unsubscribedAt).toBeNull();
    await unsubscribePost(new Request("http://localhost/x", { method: "POST" }), params({ token: createUnsubscribeToken(alice.id) }));
    expect((await db.statusPageSubscriber.findUniqueOrThrow({ where: { id: alice.id } })).unsubscribedAt).not.toBeNull();
    expect(await notifyStatusPageSubscribers(page.id, { headline: "Again", body: "x" })).toBe(0);
  });
});
