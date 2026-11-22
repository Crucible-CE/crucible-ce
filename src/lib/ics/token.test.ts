// @vitest-environment node
// Stored ICS feed tokens: hash-only storage, one live link per user+incident,
// and a feed is refused once revoked, for another incident, for an inactive
// owner, or when the owner can no longer see the incident.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sha256Hex } from "@/lib/crypto/hash";

const h = vi.hoisted(() => ({
  db: {
    icsFeedToken: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  findAccessibleIncident: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/incident/access", () => ({ findAccessibleIncident: h.findAccessibleIncident }));

import { mintIcsToken, verifyIcsToken, revokeIcsTokens } from "./token";

const owner = { id: "u-1", organizationId: "org-1", role: "contributor", isActive: true };
const live = { id: "t-1", incidentId: "inc-1", revokedAt: null, user: owner };

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$transaction.mockResolvedValue([]);
  h.db.icsFeedToken.update.mockResolvedValue({});
  h.db.icsFeedToken.updateMany.mockResolvedValue({ count: 1 });
  h.db.icsFeedToken.create.mockImplementation((a: unknown) => a);
  h.findAccessibleIncident.mockResolvedValue({ id: "inc-1" });
});

describe("mintIcsToken", () => {
  it("stores only the hash and revokes the user's previous link for the incident", async () => {
    const token = await mintIcsToken({ organizationId: "org-1", incidentId: "inc-1", userId: "u-1" });
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(h.db.icsFeedToken.updateMany).toHaveBeenCalledWith({
      where: { incidentId: "inc-1", userId: "u-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    const created = h.db.icsFeedToken.create.mock.calls[0][0].data;
    expect(created.tokenHash).toBe(sha256Hex(token));
    expect(JSON.stringify(created)).not.toContain(token);
  });
});

describe("verifyIcsToken", () => {
  it("accepts a live token whose owner can still see the incident", async () => {
    h.db.icsFeedToken.findUnique.mockResolvedValue(live);
    expect(await verifyIcsToken("inc-1", "tok")).toBe(true);
    expect(h.db.icsFeedToken.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: sha256Hex("tok") } }));
  });

  it("refuses unknown, revoked, and cross-incident tokens", async () => {
    h.db.icsFeedToken.findUnique.mockResolvedValueOnce(null);
    expect(await verifyIcsToken("inc-1", "tok")).toBe(false);
    h.db.icsFeedToken.findUnique.mockResolvedValueOnce({ ...live, revokedAt: new Date() });
    expect(await verifyIcsToken("inc-1", "tok")).toBe(false);
    h.db.icsFeedToken.findUnique.mockResolvedValueOnce(live);
    expect(await verifyIcsToken("inc-2", "tok")).toBe(false);
    expect(await verifyIcsToken("inc-1", "")).toBe(false);
  });

  it("refuses when the owner is deactivated", async () => {
    h.db.icsFeedToken.findUnique.mockResolvedValue({ ...live, user: { ...owner, isActive: false } });
    expect(await verifyIcsToken("inc-1", "tok")).toBe(false);
  });

  it("refuses when the owner lost access (e.g. removed from a locked incident)", async () => {
    h.db.icsFeedToken.findUnique.mockResolvedValue(live);
    h.findAccessibleIncident.mockResolvedValue(null);
    expect(await verifyIcsToken("inc-1", "tok")).toBe(false);
  });
});

describe("revokeIcsTokens", () => {
  it("revokes a user's live tokens, optionally scoped to one incident", async () => {
    await revokeIcsTokens({ userId: "u-1", incidentId: "inc-1" });
    expect(h.db.icsFeedToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u-1", incidentId: "inc-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    await revokeIcsTokens({ userId: "u-1" });
    expect(h.db.icsFeedToken.updateMany).toHaveBeenLastCalledWith({
      where: { userId: "u-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
