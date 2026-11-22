// @vitest-environment node
// Escalation contacts (L7): allowUnverifiedPhone + manual "verified" are
// administrator-only; phones are normalized to E.164 at write; a changed
// number drops its verification (and, for non-admins, the override).
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const mockDb = {
    escalationContact: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    user: { findFirst: vi.fn() },
  };
  return { mockDb, mockAuth: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/auth", () => ({ auth: h.mockAuth }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));

import { PATCH } from "./route";
import { POST } from "../route";

const { mockDb, mockAuth } = h;
const params = Promise.resolve({ id: "c-1" });
const contributor = { user: { id: "u-1", organizationId: "org-1", role: "contributor" } };
const admin = { user: { id: "a-1", organizationId: "org-1", role: "administrator" } };

function patch(body: unknown) {
  return PATCH(new Request("http://x", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params });
}
function post(body: unknown) {
  return POST(new Request("http://x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.escalationContact.findFirst.mockResolvedValue({ id: "c-1", phone: "+14155550123", alternatePhone: null });
  mockDb.escalationContact.update.mockImplementation(async ({ data }: { data: unknown }) => ({ id: "c-1", ...(data as object) }));
  mockDb.escalationContact.create.mockImplementation(async ({ data }: { data: unknown }) => ({ id: "c-new", ...(data as object) }));
  mockDb.user.findFirst.mockResolvedValue({ id: "u-9" });
});

describe("allowUnverifiedPhone / markVerified are administrator-only", () => {
  it("a contributor can't set the override (PATCH or POST) or mark verified", async () => {
    mockAuth.mockResolvedValue(contributor);
    expect((await patch({ allowUnverifiedPhone: true })).status).toBe(403);
    expect((await patch({ markVerified: true })).status).toBe(403);
    expect((await post({ name: "N", role: "vendor", allowUnverifiedPhone: true })).status).toBe(403);
    expect(mockDb.escalationContact.update).not.toHaveBeenCalled();
    expect(mockDb.escalationContact.create).not.toHaveBeenCalled();
  });

  it("an administrator can", async () => {
    mockAuth.mockResolvedValue(admin);
    expect((await patch({ allowUnverifiedPhone: true })).status).toBe(200);
    expect(mockDb.escalationContact.update.mock.calls[0][0].data.allowUnverifiedPhone).toBe(true);
    expect((await post({ name: "N", role: "vendor", allowUnverifiedPhone: true })).status).toBe(201);
  });
});

describe("phones", () => {
  it("normalizes national input to E.164 at write", async () => {
    mockAuth.mockResolvedValue(contributor);
    await post({ name: "N", role: "vendor", phone: "(415) 555-0199", alternatePhone: "1-888-282-0870" });
    const data = mockDb.escalationContact.create.mock.calls[0][0].data;
    expect(data.phone).toBe("+14155550199");
    expect(data.alternatePhone).toBe("+18882820870");
  });

  it("rejects an unreadable number", async () => {
    mockAuth.mockResolvedValue(contributor);
    expect((await patch({ phone: "call me" })).status).toBe(400);
  });

  it("a changed number drops verification and (for non-admins) the override", async () => {
    mockAuth.mockResolvedValue(contributor);
    await patch({ phone: "+1 415 555 0100" });
    const data = mockDb.escalationContact.update.mock.calls[0][0].data;
    expect(data.phone).toBe("+14155550100");
    expect(data.phoneVerifiedAt).toBeNull();
    expect(data.phoneVerificationTokenHash).toBeNull();
    expect("emailVerifiedAt" in data).toBe(false); // the email is still verified
    expect(data.allowUnverifiedPhone).toBe(false);
  });

  it("a changed email drops only the email verification", async () => {
    mockAuth.mockResolvedValue(contributor);
    mockDb.escalationContact.findFirst.mockResolvedValue({ id: "c-1", email: "old@x.test", phone: "+14155550123", alternatePhone: null });
    await patch({ email: "new@x.test" });
    const data = mockDb.escalationContact.update.mock.calls[0][0].data;
    expect(data.emailVerifiedAt).toBeNull();
    expect("phoneVerifiedAt" in data).toBe(false);
  });

  it("an administrator marks email and phone verified separately", async () => {
    mockAuth.mockResolvedValue(admin);
    await patch({ markVerified: "phone" });
    let data = mockDb.escalationContact.update.mock.calls[0][0].data;
    expect(data.phoneVerifiedAt).toBeInstanceOf(Date);
    expect("emailVerifiedAt" in data).toBe(false);
    await patch({ markVerified: "email" });
    data = mockDb.escalationContact.update.mock.calls[1][0].data;
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect("phoneVerifiedAt" in data).toBe(false);
    await patch({ markVerified: true });
    data = mockDb.escalationContact.update.mock.calls[2][0].data;
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(data.phoneVerifiedAt).toBeInstanceOf(Date);
  });

  it("re-saving the same number keeps verification", async () => {
    mockAuth.mockResolvedValue(contributor);
    await patch({ phone: "(415) 555-0123", name: "Same" });
    const data = mockDb.escalationContact.update.mock.calls[0][0].data;
    expect("phoneVerifiedAt" in data).toBe(false);
  });
});

describe("member link", () => {
  it("rejects a userId outside the org", async () => {
    mockAuth.mockResolvedValue(contributor);
    mockDb.user.findFirst.mockResolvedValue(null);
    expect((await patch({ userId: "u-other" })).status).toBe(400);
    expect(mockDb.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u-other", organizationId: "org-1", isActive: true } }));
  });
});
