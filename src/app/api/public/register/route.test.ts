// @vitest-environment node
// Invite-only registration: an invite bound to an email only works for that
// email, and the single-use claim is atomic inside the register transaction
// (a concurrently consumed invite aborts before any user is created).
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const mockDb = {
    orgInvite: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
    verificationToken: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { mockDb };
});
vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/email/send-welcome", () => ({ sendWelcomeEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/security/bot-check", () => ({ validateBotCheck: vi.fn().mockReturnValue({ ok: true }) }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfter: 0 }),
  ipFromRequest: () => "1.2.3.4",
}));
vi.mock("@/lib/org-invite/tokens", () => ({
  verifyOrgInviteToken: () => ({ valid: true, idHash: "hash", payload: {} }),
  ORG_INVITE_ALLOWED_ROLES: ["reader", "contributor", "administrator"],
  ORG_INVITE_DEFAULT_ROLE: "contributor",
}));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hashed") } }));

import { POST } from "./route";

const { mockDb } = h;
const inviteRow = {
  id: "inv-1",
  organizationId: "org-1",
  role: "contributor",
  usedAt: null,
  revokedAt: null,
  expiresAt: new Date(Date.now() + 86_400_000),
  skipEmailVerification: true,
  inviteeEmail: null as string | null,
  organization: { id: "org-1", name: "Acme" },
};

function register(email = "new@acme.test") {
  return POST(
    new Request("http://x/api/public/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New", email, password: "correct-horse-battery", orgInviteToken: "a.b.c" }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.orgInvite.findUnique.mockResolvedValue({ ...inviteRow });
  mockDb.user.findUnique.mockResolvedValue(null);
  mockDb.user.create.mockResolvedValue({ id: "u-new" });
  mockDb.orgInvite.updateMany.mockResolvedValue({ count: 1 });
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));
});

describe("register with an invite", () => {
  it("claims the invite atomically before creating the user", async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(mockDb.orgInvite.updateMany).toHaveBeenCalledWith({
      where: { id: "inv-1", usedAt: null, revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    });
    expect(mockDb.orgInvite.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mockDb.user.create.mock.invocationCallOrder[0]);
  });

  it("aborts (no user) when the invite was consumed concurrently", async () => {
    mockDb.orgInvite.updateMany.mockResolvedValue({ count: 0 });
    const res = await register();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already been used/);
    expect(mockDb.user.create).not.toHaveBeenCalled();
  });

  it("enforces the invite's bound email", async () => {
    mockDb.orgInvite.findUnique.mockResolvedValue({ ...inviteRow, inviteeEmail: "Invited@Acme.test" });
    const wrong = await register("someone-else@acme.test");
    expect(wrong.status).toBe(403);
    expect(mockDb.user.create).not.toHaveBeenCalled();
    const right = await register("invited@acme.test");
    expect(right.status).toBe(201);
  });

  it("rejects an invite carrying a role that no longer exists", async () => {
    mockDb.orgInvite.findUnique.mockResolvedValue({ ...inviteRow, role: "facilitator" });
    const res = await register();
    expect(res.status).toBe(400);
    expect(mockDb.user.create).not.toHaveBeenCalled();
  });
});
