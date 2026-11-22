// @vitest-environment node
// POST /api/incidents/[id]/page/ack — the paged person acks their own pages;
// acking someone else's page needs contributor+; readers can't.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockAck: vi.fn(),
  mockDb: {
    incident: { findFirst: vi.fn() },
    incidentPage: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: h.mockAuth }));
vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/escalation/engine", () => ({ acknowledgePage: h.mockAck }));

import { POST } from "./route";

const params = Promise.resolve({ id: "inc-1" });
const as = (role: string, id = "u-1") => ({ user: { id, name: "N", organizationId: "org-1", role } });
const req = (body?: unknown) => new Request("http://x", { method: "POST", ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });

beforeEach(() => {
  vi.clearAllMocks();
  h.mockDb.incident.findFirst.mockResolvedValue({ id: "inc-1" });
  h.mockAck.mockResolvedValue(true);
});

describe("page ack", () => {
  it("acks the caller's own open pages (a reader included)", async () => {
    h.mockAuth.mockResolvedValue(as("reader"));
    h.mockDb.incidentPage.findMany.mockResolvedValue([{ id: "p-1", escalationLevel: 0 }]);
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(h.mockDb.incidentPage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ targetUserId: "u-1" }) }));
  });

  it("403s a reader acking someone else's page", async () => {
    h.mockAuth.mockResolvedValue(as("reader"));
    h.mockDb.incidentPage.findFirst.mockResolvedValue({ id: "p-2", escalationLevel: 0, targetUserId: "u-other" });
    const res = await POST(req({ pageId: "p-2" }), { params });
    expect(res.status).toBe(403);
    expect(h.mockAck).not.toHaveBeenCalled();
  });

  it("lets a contributor ack a page on someone's behalf", async () => {
    h.mockAuth.mockResolvedValue(as("contributor"));
    h.mockDb.incidentPage.findFirst.mockResolvedValue({ id: "p-2", escalationLevel: 1, targetUserId: null });
    const res = await POST(req({ pageId: "p-2" }), { params });
    expect(res.status).toBe(200);
    expect(h.mockAck).toHaveBeenCalledWith("p-2", expect.objectContaining({ userId: "u-1", level: 1 }));
  });

  it("a sent body goes through the shared parser: oversized -> 413, non-JSON -> 415, NUL -> 400", async () => {
    h.mockAuth.mockResolvedValue(as("contributor"));
    const big = new Request("http://x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId: "p".repeat(10_000) }) });
    expect((await POST(big, { params })).status).toBe(413);
    const text = new Request("http://x", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{\"pageId\":\"p-2\"}" });
    expect((await POST(text, { params })).status).toBe(415);
    expect((await POST(req({ pageId: `p${String.fromCharCode(0)}` }), { params })).status).toBe(400);
    expect(h.mockAck).not.toHaveBeenCalled();
  });
});
