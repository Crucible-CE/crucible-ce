// @vitest-environment node
// Real-Postgres concurrency tests for the second-factor attempt reservation.
// Runs only when MFA_PG_TEST_URL points at a throwaway database with the
// migrations applied (e.g. a disposable postgres:16 container):
//
//   MFA_PG_TEST_URL=postgresql://u:p@127.0.0.1:55439/fresh npx vitest run src/lib/auth/mfa/login.pg.test.ts
//
// No REDIS_URL: the Redis limiters fail open, so these also show that the
// database caps hold without Redis.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const PG = process.env.MFA_PG_TEST_URL;

const h = vi.hoisted(() => ({ totpChecks: 0 }));
vi.mock("next-auth", () => ({
  CredentialsSignin: class extends Error {
    code = "credentials";
  },
}));
vi.mock("./service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return {
    ...actual,
    verifyUserTotp: async (...a: Parameters<typeof actual.verifyUserTotp>) => {
      h.totpChecks++;
      return actual.verifyUserTotp(...a);
    },
  };
});

describe.skipIf(!PG)("MFA attempt reservation against real Postgres (no Redis)", () => {
  type Db = typeof import("@/lib/db").db;
  let db: Db;
  const orgId = `org-pg-${Date.now()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = PG;
    delete process.env.REDIS_URL;
    process.env.AUTH_SECRET = "s".repeat(40);
    process.env.MASTER_KEK = "ab".repeat(32);
    db = (await import("@/lib/db")).db;
    await db.organization.create({ data: { id: orgId, name: "PG test", slug: orgId } });
  });

  afterAll(async () => {
    await db?.organization.deleteMany({ where: { id: orgId } });
    await db?.$disconnect();
  });

  async function userWithTotp(email: string) {
    const { encryptTotpSecret } = await import("./secrets");
    const { generateTotpSecret } = await import("./totp");
    const u = await db.user.create({
      data: { email, organizationId: orgId, passwordHash: "x", emailVerified: new Date(), tokenVersion: 1 },
    });
    const secret = generateTotpSecret();
    await db.userMfa.create({ data: { userId: u.id, totpSecretEnc: encryptTotpSecret(u.id, secret), totpEnabledAt: new Date() } });
    return { user: u, secret };
  }

  it("N concurrent wrong codes on one pending sign-in: exactly MFA_TICKET_MAX_ATTEMPTS are checked, none succeed", async () => {
    const { authorizeMfa, MFA_TICKET_MAX_ATTEMPTS } = await import("./login");
    const { MFA_PENDING_COOKIE, signPendingCookie } = await import("./cookies");
    const { generateTotp } = await import("./totp");
    const { user, secret } = await userWithTotp(`race-${Date.now()}@pg.test`);
    const expSec = Math.floor(Date.now() / 1000) + 240;
    const ticket = await db.mfaLoginTicket.create({ data: { userId: user.id, tokenVersion: 1, expiresAt: new Date(expSec * 1000) } });
    const cookie = `${MFA_PENDING_COOKIE}=${signPendingCookie(ticket, expSec)}`;
    const wrong = String((Number(generateTotp(secret)) + 500_000) % 1_000_000).padStart(6, "0");

    h.totpChecks = 0;
    const N = 12;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        authorizeMfa({ method: "totp", code: wrong }, new Request("http://x/api/auth/callback/mfa", { method: "POST", headers: { cookie } })),
      ),
    );
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    const codes = results.map((r) => (r.status === "rejected" ? (r.reason as { code?: string }).code : "ok"));
    expect(codes.every((c) => c === "mfa_invalid" || c === "mfa_expired")).toBe(true);
    expect(h.totpChecks).toBe(MFA_TICKET_MAX_ATTEMPTS);
    const row = await db.mfaLoginTicket.findUnique({ where: { id: ticket.id } });
    expect(row?.failedAttempts).toBe(MFA_TICKET_MAX_ATTEMPTS);
    expect(row?.consumedAt).toBeNull();
  });

  it("the per-user database cap holds under concurrency without Redis, and refunds give slots back", async () => {
    const { MFA_DB_FAILURE_CAP, refundMfaFailureSlot, reserveMfaFailureSlot } = await import("./service");
    const { user } = await userWithTotp(`cap-${Date.now()}@pg.test`);
    const got = await Promise.all(Array.from({ length: MFA_DB_FAILURE_CAP + 10 }, () => reserveMfaFailureSlot(user.id)));
    expect(got.filter(Boolean)).toHaveLength(MFA_DB_FAILURE_CAP);
    expect(await reserveMfaFailureSlot(user.id)).toBe(false);
    await refundMfaFailureSlot(user.id);
    expect(await reserveMfaFailureSlot(user.id)).toBe(true);
    expect(await reserveMfaFailureSlot(user.id)).toBe(false);
    // A new window opens after the old one expires.
    expect(await reserveMfaFailureSlot(user.id, Date.now() + 16 * 60 * 1000)).toBe(true);
  });
});
