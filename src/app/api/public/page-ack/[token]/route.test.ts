// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  acknowledgePage: vi.fn(),
  stateFind: vi.fn(),
  stateUpdate: vi.fn(),
  userFind: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    incidentPage: { findUnique: h.findUnique },
    onboardingState: { findUnique: h.stateFind, updateMany: h.stateUpdate },
    user: { findUnique: h.userFind },
    broadcastRecipient: { findUnique: async () => null },
  },
}));
vi.mock("@/lib/escalation/engine", () => ({ acknowledgePage: h.acknowledgePage }));

import { GET, POST } from "./route";
import { createAckToken } from "@/lib/delivery/ack-token";

const PAGE = "cmpage0000000000000000001";
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
const openPage = {
  id: PAGE,
  status: "sent",
  escalationLevel: 0,
  targetUserId: "u1",
  targetLabel: "Grace <script>",
  incident: { title: "Ransomware", severity: "critical", status: "investigating" },
};

beforeEach(() => {
  process.env.AUTH_SECRET = "route-test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxx";
  vi.clearAllMocks();
});

describe("public page-ack link", () => {
  it("GET is scanner-safe: shows a confirm form and never acks", async () => {
    h.findUnique.mockResolvedValue(openPage);
    const res = await GET(new Request("https://x.test"), ctx(createAckToken(PAGE, 0)));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<form method="post">');
    expect(html).toContain("Grace &lt;script&gt;"); // escaped
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.acknowledgePage).not.toHaveBeenCalled();
  });

  it("POST acks once, pinned to the token's level, attributed to the target", async () => {
    h.findUnique.mockResolvedValue(openPage);
    h.acknowledgePage.mockResolvedValue(true);
    const res = await POST(new Request("https://x.test", { method: "POST" }), ctx(createAckToken(PAGE, 0)));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Acknowledged");
    expect(h.acknowledgePage).toHaveBeenCalledWith(PAGE, { userId: "u1", via: "link", level: 0 });
  });

  it("a token for an earlier escalation level, a closed incident or a bad token cannot ack", async () => {
    h.findUnique.mockResolvedValue({ ...openPage, escalationLevel: 1 });
    expect((await POST(new Request("https://x.test", { method: "POST" }), ctx(createAckToken(PAGE, 0)))).status).toBe(409);

    h.findUnique.mockResolvedValue({ ...openPage, incident: { ...openPage.incident, status: "closed" } });
    expect((await POST(new Request("https://x.test", { method: "POST" }), ctx(createAckToken(PAGE, 0)))).status).toBe(409);

    expect((await POST(new Request("https://x.test", { method: "POST" }), ctx("garbage"))).status).toBe(410);
    expect(h.acknowledgePage).not.toHaveBeenCalled();
  });

  it("second use reports already handled", async () => {
    h.findUnique.mockResolvedValue({ ...openPage, status: "acked" });
    const res = await POST(new Request("https://x.test", { method: "POST" }), ctx(createAckToken(PAGE, 0)));
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("already been acknowledged");
  });
});

describe("public page-ack link for the onboarding self test page", () => {
  const TEST = "cmonb00000000000000000001";
  const updatedAt = new Date("2026-10-14T10:00:00Z");
  const row = (value: Record<string, unknown>) => ({ id: TEST, scope: "user", key: "test_page", subjectId: "u1", value, updatedAt });
  const pending = { seq: 2, sentAt: "2026-10-14T10:00:00Z", ackedAt: null, everAckedAt: null, channels: [] };

  beforeEach(() => {
    h.findUnique.mockResolvedValue(null); // not an incident page
    h.userFind.mockResolvedValue({ name: "Rhea", email: "r@acme.test", isActive: true });
    h.stateUpdate.mockResolvedValue({ count: 1 });
  });

  it("GET shows the same scanner-safe confirm form, labelled as a test", async () => {
    h.stateFind.mockResolvedValue(row(pending));
    const res = await GET(new Request("https://x.test"), ctx(createAckToken(TEST, 2)));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Test page");
    expect(html).toContain('<form method="post">');
    expect(h.stateUpdate).not.toHaveBeenCalled();
  });

  it("POST acknowledges it once; a link from an earlier send cannot", async () => {
    h.stateFind.mockResolvedValue(row(pending));
    const res = await POST(new Request("https://x.test", { method: "POST" }), ctx(createAckToken(TEST, 2)));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Acknowledged");
    expect(h.stateUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TEST, updatedAt } }));
    expect(h.stateUpdate.mock.calls[0][0].data.value).toMatchObject({ ackedVia: "link", seq: 2 });

    h.stateUpdate.mockClear();
    const old = await POST(new Request("https://x.test", { method: "POST" }), ctx(createAckToken(TEST, 1)));
    expect(old.status).toBe(409);
    expect(await old.text()).toContain("A newer test page was sent");

    h.stateFind.mockResolvedValue(row({ ...pending, ackedAt: "2026-10-14T10:05:00Z" }));
    const again = await POST(new Request("https://x.test", { method: "POST" }), ctx(createAckToken(TEST, 2)));
    expect(again.status).toBe(409);
    expect(await again.text()).toContain("already been acknowledged");
    expect(h.stateUpdate).not.toHaveBeenCalled();
  });

  it("an id that is neither a page nor a test page is gone", async () => {
    h.stateFind.mockResolvedValue(null);
    const res = await GET(new Request("https://x.test"), ctx(createAckToken(TEST, 0)));
    expect(res.status).toBe(410);
    expect(await res.text()).toContain("no longer exists");
  });
});
