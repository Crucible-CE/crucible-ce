// @vitest-environment node
// /api/incidents/[id]/page: GET redacts raw delivery errors for viewers without
// incidents.edit; POST never refuses a LOCKED-incident target (the in-app page
// is redacted instead) and rate-limits per (pager, target).
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  createNotification: vi.fn(),
  deliverPage: vi.fn(),
  checkRateLimit: vi.fn(),
  canUserSeeIncident: vi.fn(),
  db: {
    incident: { findFirst: vi.fn() },
    incidentPage: { findMany: vi.fn(), create: vi.fn() },
    user: { findFirst: vi.fn() },
    escalationContact: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  },
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/ledger/append", () => ({ appendLedger: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: h.createNotification }));
vi.mock("@/lib/delivery/engine", () => ({ deliverPage: h.deliverPage }));
vi.mock("@/lib/incident/lock", () => ({ assertIncidentWritable: vi.fn(async () => null) }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("@/lib/incident/access", () => ({
  accessibleIncidentsWhere: () => ({}),
  canUserSeeIncident: h.canUserSeeIncident,
}));

import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ id: "inc-1" }) };
const as = (role: string) => ({ user: { id: "u-pager", name: "Pat", email: "pat@acme.test", organizationId: "org-1", role } });
const postReq = (body: unknown) =>
  new Request("http://x/api/incidents/inc-1/page", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  process.env.AUTH_SECRET = "page-route-test-secret-xxxxxxxxxxxxxxxxxxxxx";
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
  h.deliverPage.mockResolvedValue({ outcomes: [] });
  h.canUserSeeIncident.mockResolvedValue(true);
  h.db.incidentPage.create.mockResolvedValue({ id: "cmpage0000000000000000009" });
  h.db.user.findFirst.mockResolvedValue({ id: "u-target", name: "Tara", email: "tara@acme.test" });
});

describe("GET page — delivery error redaction", () => {
  const pages = [
    {
      id: "p1",
      deliveries: [
        { provider: "twilio-sms", channel: "sms", level: 0, attempt: 1, status: "failed", error: "The 'To' number +15550001111 is not a valid phone number", nextRetryAt: null, createdAt: new Date() },
        { provider: "twilio-voice", channel: "voice", level: 0, attempt: 1, status: "skipped", error: "rate limited: 10 voice calls to this number in the last hour (limit 10)", nextRetryAt: null, createdAt: new Date() },
      ],
    },
  ];

  it("a reader gets coarse categories, never raw provider text", async () => {
    h.auth.mockResolvedValue(as("reader"));
    h.db.incident.findFirst.mockResolvedValue({ id: "inc-1" });
    h.db.incidentPage.findMany.mockResolvedValue(structuredClone(pages));
    const body = await (await GET(new Request("http://x"), ctx)).json();
    const errors = body.pages[0].deliveries.map((d: { error: string }) => d.error);
    expect(errors).toEqual(["delivery error", "rate limited"]);
    expect(JSON.stringify(body)).not.toContain("+1555");
  });

  it("a contributor sees the raw error", async () => {
    h.auth.mockResolvedValue(as("contributor"));
    h.db.incident.findFirst.mockResolvedValue({ id: "inc-1" });
    h.db.incidentPage.findMany.mockResolvedValue(structuredClone(pages));
    const body = await (await GET(new Request("http://x"), ctx)).json();
    expect(body.pages[0].deliveries[0].error).toContain("+15550001111");
  });
});

describe("POST page — LOCKED incident", () => {
  beforeEach(() => {
    h.auth.mockResolvedValue(as("contributor"));
    h.db.incident.findFirst.mockResolvedValue({ id: "inc-1", title: "Insider case", severity: "critical", status: "investigating", restricted: true });
  });

  it("pages a member who can't see it (never refused), with a REDACTED in-app page", async () => {
    h.canUserSeeIncident.mockResolvedValue(false);
    const res = await POST(postReq({ userId: "u-target", note: "secret note" }), ctx);
    expect(res.status).toBe(200);
    expect(h.db.incidentPage.create).toHaveBeenCalledOnce();
    const [userId, , title, body, metadata, link] = h.createNotification.mock.calls[0];
    expect(userId).toBe("u-target");
    expect(`${title} ${body}`).not.toMatch(/Insider case|secret note/);
    expect(body).toContain("restricted incident (severity critical)");
    expect(metadata).toEqual({ pageId: "cmpage0000000000000000009", restricted: true });
    expect(link).toMatch(/^\/api\/public\/page-ack\//);
    expect(h.deliverPage).toHaveBeenCalledOnce();
  });

  it("a member who can see it gets the full in-app page", async () => {
    h.canUserSeeIncident.mockResolvedValue(true);
    await POST(postReq({ userId: "u-target" }), ctx);
    expect(h.createNotification.mock.calls[0][2]).toContain("Insider case");
  });

  it("pages an external contact (never refused)", async () => {
    h.db.escalationContact.findFirst.mockResolvedValue({ id: "ec-1", name: "Vendor IR" });
    const res = await POST(postReq({ contactId: "ec-1" }), ctx);
    expect(res.status).toBe(200);
    expect(h.deliverPage).toHaveBeenCalledOnce();
  });
});

describe("POST page — rate limits", () => {
  beforeEach(() => {
    h.auth.mockResolvedValue(as("contributor"));
    h.db.incident.findFirst.mockResolvedValue({ id: "inc-1", title: "T", severity: "high", status: "investigating", restricted: false });
  });

  it("limits per (pager, target) and, more loosely, per pager", async () => {
    await POST(postReq({ userId: "u-target" }), ctx);
    const calls = h.checkRateLimit.mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      expect.objectContaining({ namespace: "page:user", identifier: "u-pager", max: 30 }),
      expect.objectContaining({ namespace: "page:user-target", identifier: "u-pager:u:u-target", max: 5 }),
    ]);
  });

  it("over the per-target limit -> 429, no page created", async () => {
    h.checkRateLimit.mockImplementation(async (o: { namespace: string }) =>
      o.namespace === "page:user-target" ? { allowed: false, retryAfter: 120 } : { allowed: true, retryAfter: 0 },
    );
    const res = await POST(postReq({ userId: "u-target" }), ctx);
    expect(res.status).toBe(429);
    expect(h.db.incidentPage.create).not.toHaveBeenCalled();
  });
});
