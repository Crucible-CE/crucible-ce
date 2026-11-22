// @vitest-environment node
// POST /api/onboarding/test-page/ack — in-app ack of your own pending test page.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  db: {
    onboardingState: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/db", () => ({ db: h.db }));

import { POST } from "./route";

const ROW = "cmonb00000000000000000001";
const updatedAt = new Date("2026-10-14T10:00:00Z");
const pending = { seq: 1, sentAt: "2026-10-14T10:00:00Z", ackedAt: null, everAckedAt: null, channels: [] };

function rowLookup(value: unknown) {
  h.db.onboardingState.findUnique.mockImplementation(async (args: { where: { id?: string } }) =>
    args.where.id ? { id: ROW, scope: "user", key: "test_page", subjectId: "u-1", value, updatedAt } : { id: ROW },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-1", organizationId: "org-1", role: "reader" } });
  h.db.user.findUnique.mockResolvedValue({ name: "Rhea", email: "r@acme.test", isActive: true });
  h.db.onboardingState.updateMany.mockResolvedValue({ count: 1 });
});

describe("in-app test page ack", () => {
  it("401 without a session", async () => {
    h.auth.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
  });

  it("acks the pending test page, guarded on the row being unchanged", async () => {
    rowLookup(pending);
    const res = await POST();
    expect(res.status).toBe(200);
    const call = h.db.onboardingState.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: ROW, updatedAt });
    expect(call.data.value).toMatchObject({ seq: 1, ackedVia: "app" });
    expect(call.data.value.ackedAt).toBeTruthy();
    expect(call.data.value.everAckedAt).toBe(call.data.value.ackedAt);
  });

  it("404 when nothing is pending, already acked, or the guarded write lost a race", async () => {
    h.db.onboardingState.findUnique.mockResolvedValue(null);
    expect((await POST()).status).toBe(404);

    rowLookup({ ...pending, ackedAt: "2026-10-14T10:01:00Z" });
    expect((await POST()).status).toBe(404);

    rowLookup(pending);
    h.db.onboardingState.updateMany.mockResolvedValue({ count: 0 });
    expect((await POST()).status).toBe(404);
  });
});
