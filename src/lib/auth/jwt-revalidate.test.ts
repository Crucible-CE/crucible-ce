import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  JWT_REVALIDATE_GRACE_MS,
  __resetJwtValidationStampsForTests,
  revalidateToken,
  type RevalidateUser,
} from "./jwt-revalidate";

beforeEach(() => __resetJwtValidationStampsForTests());

const NOW = 1_000_000_000;
const user: RevalidateUser = {
  isActive: true,
  organizationId: "org-1",
  role: "contributor",
  tokenVersion: 2,
};
const quiet = { warn: vi.fn(), error: vi.fn() };
const deps = (over: Partial<Parameters<typeof revalidateToken>[1]> = {}) => ({
  loadUser: vi.fn().mockResolvedValue(user),
  loadOrgName: vi.fn().mockResolvedValue("Acme"),
  now: () => NOW,
  log: quiet,
  ...over,
});

describe("revalidateToken", () => {
  it("passes tokens without an id through untouched", async () => {
    const t = { foo: 1 };
    expect(await revalidateToken(t, deps())).toBe(t);
  });

  it("refreshes fields and stamps lastValidatedAt on success", async () => {
    const t = { id: "u1", tokenVersion: 2, role: "reader" };
    const out = await revalidateToken(t, deps());
    expect(out).toMatchObject({ id: "u1", role: "contributor", organizationName: "Acme", lastValidatedAt: NOW });
  });

  it("ends the session for a deactivated user or a stale tokenVersion", async () => {
    expect(await revalidateToken({ id: "u1", tokenVersion: 2 }, deps({ loadUser: vi.fn().mockResolvedValue({ ...user, isActive: false }) }))).toBeNull();
    expect(await revalidateToken({ id: "u1", tokenVersion: 1 }, deps())).toBeNull();
    expect(await revalidateToken({ id: "u1" }, deps({ loadUser: vi.fn().mockResolvedValue(null) }))).toBeNull();
  });

  it("DB error within the 60s grace: keeps the previous token unchanged", async () => {
    const t = { id: "u1", tokenVersion: 2, role: "reader", lastValidatedAt: NOW - 30_000 };
    const out = await revalidateToken(t, deps({ loadUser: vi.fn().mockRejectedValue(new Error("pool")) }));
    expect(out).toBe(t);
    expect(out).toEqual({ id: "u1", tokenVersion: 2, role: "reader", lastValidatedAt: NOW - 30_000 });
  });

  it("DB error past the grace (or never validated): fails closed", async () => {
    const failing = deps({ loadUser: vi.fn().mockRejectedValue(new Error("pool")) });
    expect(await revalidateToken({ id: "u1", lastValidatedAt: NOW - JWT_REVALIDATE_GRACE_MS - 1 }, failing)).toBeNull();
    expect(await revalidateToken({ id: "u1" }, failing)).toBeNull();
  });

  it("timeout: grace keeps the token, and a late DB answer cannot mutate it", async () => {
    let resolveLate: (u: RevalidateUser) => void = () => {};
    const late = new Promise<RevalidateUser>((r) => {
      resolveLate = r;
    });
    const t = { id: "u1", tokenVersion: 2, role: "reader", lastValidatedAt: NOW - 1_000 };
    const out = await revalidateToken(t, deps({ loadUser: () => late, timeoutMs: 5 }));
    expect(out).toBe(t);
    resolveLate({ ...user, role: "administrator" });
    await new Promise((r) => setTimeout(r, 5));
    expect(t.role).toBe("reader");
  });

  it("timeout past the grace fails closed", async () => {
    const never = new Promise<RevalidateUser>(() => {});
    const out = await revalidateToken({ id: "u1", lastValidatedAt: NOW - 120_000 }, deps({ loadUser: () => never, timeoutMs: 5 }));
    expect(out).toBeNull();
  });

  describe("server-side validation stamp (cookie not reissued)", () => {
    const failing = (n: () => number) => deps({ now: n, loadUser: vi.fn().mockRejectedValue(new Error("db down")) });

    it("a token validated by THIS process <60s ago survives a DB error even though its cookie claim is stale", async () => {
      // The cookie was minted long ago and never reissued: its claim is stale.
      const cookie = { id: "u1", tokenVersion: 2, lastValidatedAt: NOW - 10 * 60_000 };
      let t = NOW;
      expect(await revalidateToken(cookie, deps({ now: () => t }))).not.toBeNull(); // success, stamped server-side
      t = NOW + 45_000;
      expect(await revalidateToken(cookie, failing(() => t))).toBe(cookie); // outage: grace from the server stamp
      t = NOW + JWT_REVALIDATE_GRACE_MS + 1;
      expect(await revalidateToken(cookie, failing(() => t))).toBeNull(); // grace over: fail closed
    });

    it("never applies the grace to a definite mismatch, and a mismatch clears the stamp", async () => {
      const cookie = { id: "u1", tokenVersion: 2 };
      expect(await revalidateToken(cookie, deps())).not.toBeNull();
      // tokenVersion bumped (force logout): definite mismatch -> no session.
      expect(await revalidateToken(cookie, deps({ loadUser: vi.fn().mockResolvedValue({ ...user, tokenVersion: 3 }) }))).toBeNull();
      // ...and a DB error right after does not resurrect it via the old stamp.
      expect(await revalidateToken(cookie, failing(() => NOW + 1_000))).toBeNull();
    });

    it("stamps are per user + tokenVersion", async () => {
      expect(await revalidateToken({ id: "u1", tokenVersion: 2 }, deps())).not.toBeNull();
      expect(await revalidateToken({ id: "u2", tokenVersion: 2 }, failing(() => NOW + 1_000))).toBeNull();
      expect(await revalidateToken({ id: "u1", tokenVersion: 1 }, failing(() => NOW + 1_000))).toBeNull();
    });
  });
});
