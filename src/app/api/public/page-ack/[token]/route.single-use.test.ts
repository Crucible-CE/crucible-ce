// @vitest-environment node
// Real single-use of the public ack link: the actual route + the real
// acknowledgePage() guarded transition (atomic claim) over an in-memory page.
// A second use of the same token, or two racing uses, ack exactly once.
// Also: a redacted target of a LOCKED incident never sees the title.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    page: null as null | Record<string, unknown>,
    restricted: false,
  };
  const db = {
    incidentPage: {
      findUnique: vi.fn(async () => (state.page ? structuredClone(state.page) : null)),
      // The guarded sent -> acked transition, applied atomically (no await
      // between the check and the write, like a single SQL UPDATE ... WHERE).
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const p = state.page;
        if (!p) return { count: 0 };
        const inc = p.incident as Record<string, unknown>;
        const ok =
          p.id === where.id &&
          p.status === where.status &&
          (where.escalationLevel === undefined || p.escalationLevel === where.escalationLevel) &&
          inc.status !== "closed" &&
          !inc.deletedAt;
        if (!ok) return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      }),
    },
    escalationContact: { findFirst: vi.fn(async () => ({ userId: null })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
  return { state, db, appendLedger: vi.fn(), sendAckNotice: vi.fn(), canUserSeeIncident: vi.fn(async () => true) };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/ledger/append", () => ({ appendLedger: h.appendLedger }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/incident/access", () => ({ canUserSeeIncident: h.canUserSeeIncident }));
vi.mock("@/lib/delivery/engine", () => ({ deliverPage: vi.fn(), sendAckNotice: h.sendAckNotice }));

import { GET, POST } from "./route";
import { createAckToken } from "@/lib/delivery/ack-token";

const PAGE = "cmpage0000000000000000001";
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
const post = (token: string) => POST(new Request("https://x.test", { method: "POST" }), ctx(token));

beforeEach(() => {
  process.env.AUTH_SECRET = "single-use-test-secret-xxxxxxxxxxxxxxxxxxxxxx";
  vi.clearAllMocks();
  h.canUserSeeIncident.mockResolvedValue(true);
  h.state.page = {
    id: PAGE,
    organizationId: "org1",
    incidentId: "inc1",
    status: "sent",
    escalationLevel: 0,
    targetUserId: "u1",
    targetContactId: null,
    targetLabel: "Grace",
    incident: { title: "Insider exfiltration", severity: "critical", status: "investigating", restricted: false, deletedAt: null },
  };
});

describe("public page-ack link is single-use (real atomic claim)", () => {
  it("the second use of the same token is rejected and nothing is acked twice", async () => {
    const token = createAckToken(PAGE, 0);
    const first = await post(token);
    expect(first.status).toBe(200);
    expect(h.state.page!.status).toBe("acked");
    expect(h.state.page!.acknowledgedVia).toBe("link");

    const second = await post(token);
    expect(second.status).toBe(409);
    expect(await second.text()).toContain("already been acknowledged");
    expect(h.appendLedger).toHaveBeenCalledOnce();
    expect(h.sendAckNotice).toHaveBeenCalledOnce();
  });

  it("two racing uses of the same token ack exactly once", async () => {
    const token = createAckToken(PAGE, 0);
    const results = await Promise.all([post(token), post(token), post(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(h.db.incidentPage.updateMany).toHaveBeenCalled();
    expect(h.appendLedger).toHaveBeenCalledOnce();
  });

  it("a token minted for level 0 dies once the page escalates to level 1", async () => {
    const token = createAckToken(PAGE, 0);
    h.state.page!.escalationLevel = 1;
    expect((await post(token)).status).toBe(409);
    expect(h.state.page!.status).toBe("sent");
  });

  it("a deleted incident's link is not usable", async () => {
    (h.state.page!.incident as Record<string, unknown>).deletedAt = new Date();
    expect((await post(createAckToken(PAGE, 0))).status).toBe(410);
    expect(h.state.page!.status).toBe("sent");
  });
});

describe("LOCKED incident landing page", () => {
  it("a target the lock excludes never sees the title (GET and POST)", async () => {
    (h.state.page!.incident as Record<string, unknown>).restricted = true;
    h.canUserSeeIncident.mockResolvedValue(false);
    const token = createAckToken(PAGE, 0);
    const page = await (await GET(new Request("https://x.test"), ctx(token))).text();
    expect(page).not.toContain("Insider exfiltration");
    expect(page).toContain("Restricted incident");
    expect(page).toContain('<form method="post">');
    const done = await (await post(token)).text();
    expect(done).not.toContain("Insider exfiltration");
    expect(done).toContain("Acknowledged");
  });

  it("a target who can see it (participant / IC / admin) gets the title", async () => {
    (h.state.page!.incident as Record<string, unknown>).restricted = true;
    h.canUserSeeIncident.mockResolvedValue(true);
    const page = await (await GET(new Request("https://x.test"), ctx(createAckToken(PAGE, 0)))).text();
    expect(page).toContain("Insider exfiltration");
  });
});
