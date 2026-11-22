import { describe, expect, it, vi } from "vitest";
import { generatePublicToken, guestDisplayName, guestInviteUsable, hashPublicToken, isWellFormedToken } from "./guest";

vi.mock("@/lib/db", () => ({ db: {} }));

const now = new Date("2026-10-26T12:00:00Z");
const invite = (over: Partial<{ revokedAt: Date | null; expiresAt: Date; createdAt: Date }> = {}) => ({
  revokedAt: null,
  expiresAt: new Date("2026-11-02T12:00:00Z"),
  createdAt: new Date("2026-10-25T12:00:00Z"),
  ...over,
});
const open = { deletedAt: null, restricted: false, lockedAt: null };

describe("guest tokens", () => {
  it("are 64 hex characters and stored as their SHA-256", () => {
    const t = generatePublicToken();
    expect(isWellFormedToken(t)).toBe(true);
    expect(hashPublicToken(t)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPublicToken(t)).not.toBe(t);
    expect(isWellFormedToken("abc")).toBe(false);
    expect(isWellFormedToken(`${"a".repeat(63)}Z`)).toBe(false);
  });

  it("show the guest as a guest", () => {
    expect(guestDisplayName({ name: "Pat Counsel", email: "p@law.example" })).toBe("Pat Counsel (guest)");
    expect(guestDisplayName({ name: null, email: "p@law.example" })).toBe("p@law.example (guest)");
  });
});

describe("guestInviteUsable", () => {
  it("works until revoked or expired", () => {
    expect(guestInviteUsable(invite(), open, now)).toBe(true);
    expect(guestInviteUsable(invite({ revokedAt: now }), open, now)).toBe(false);
    expect(guestInviteUsable(invite({ expiresAt: now }), open, now)).toBe(false);
  });

  it("stops on a deleted incident", () => {
    expect(guestInviteUsable(invite(), { ...open, deletedAt: now }, now)).toBe(false);
  });

  it("a lock suspends links made before it, not links made after it", () => {
    const locked = { deletedAt: null, restricted: true, lockedAt: new Date("2026-10-26T00:00:00Z") };
    expect(guestInviteUsable(invite(), locked, now)).toBe(false);
    expect(guestInviteUsable(invite({ createdAt: new Date("2026-10-26T06:00:00Z") }), locked, now)).toBe(true);
    expect(guestInviteUsable(invite(), { ...locked, lockedAt: null }, now)).toBe(false);
  });
});
