// @vitest-environment node
// /api/user/mfa/* route tests: step-up (reauth), TOTP enroll + disable,
// recovery-code regeneration, turning MFA off, WebAuthn key removal.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  userFind: vi.fn(),
  mfaFind: vi.fn(),
  mfaUpsert: vi.fn(),
  mfaUpdate: vi.fn(),
  mfaUpdateMany: vi.fn(),
  credFind: vi.fn(),
  credFindMany: vi.fn(),
  credDelete: vi.fn(),
  compare: vi.fn(),
  peek: vi.fn(),
  hit: vi.fn(),
  loadFactors: vi.fn(),
  verifyUserTotp: vi.fn(),
  consumeRecoveryCode: vi.fn(),
  ensureRecoveryCodes: vi.fn(),
  issueRecoveryCodes: vi.fn(),
  cleanupIfNoFactors: vi.fn(),
  removeAllMfa: vi.fn(),
  activity: vi.fn(),
  reserve: vi.fn(),
  finish: vi.fn(),
  removeGuarded: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: h.userFind },
    userMfa: { findUnique: h.mfaFind, upsert: h.mfaUpsert, update: h.mfaUpdate, updateMany: h.mfaUpdateMany },
    webAuthnCredential: { findUnique: h.credFind, findMany: h.credFindMany, delete: h.credDelete },
  },
}));
vi.mock("bcryptjs", () => ({ default: { compare: h.compare } }));
vi.mock("@/lib/security/rate-limit", () => ({ ipFromRequest: () => "1.2.3.4", peekRateLimit: h.peek, recordRateLimitHit: h.hit }));
vi.mock("@/lib/auth/mfa/attempts", () => ({ reserveFactorAttempt: h.reserve }));
vi.mock("@/lib/security/activity-log", () => ({ recordActivity: h.activity }));
vi.mock("@/lib/auth/mfa/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/mfa/service")>()),
  loadFactors: h.loadFactors,
  verifyUserTotp: h.verifyUserTotp,
  consumeRecoveryCode: h.consumeRecoveryCode,
  ensureRecoveryCodes: h.ensureRecoveryCodes,
  issueRecoveryCodes: h.issueRecoveryCodes,
  cleanupIfNoFactors: h.cleanupIfNoFactors,
  removeAllMfa: h.removeAllMfa,
  removeFactorGuarded: h.removeGuarded,
}));
vi.mock("@/lib/auth/mfa/webauthn", () => ({ verifyAuthentication: vi.fn(), CREDENTIAL_NAME_MAX: 64 }));

import { __resetDerivedKeysForTests } from "@/lib/crypto/org-crypto";
import { MFA_REAUTH_COOKIE, signReauthCookie } from "@/lib/auth/mfa/cookies";
import { encryptTotpSecret } from "@/lib/auth/mfa/secrets";
import { generateTotp, generateTotpSecret } from "@/lib/auth/mfa/totp";
import { DELETE as deleteAll } from "./route";
import { POST as reauth } from "./reauth/route";
import { POST as totpSetup } from "./totp/setup/route";
import { POST as totpEnable } from "./totp/enable/route";
import { DELETE as totpDelete } from "./totp/route";
import { POST as regenerate } from "./recovery-codes/route";
import { DELETE as keyDelete } from "./webauthn/[id]/route";

const dbUser = (over: Record<string, unknown> = {}) => ({
  id: "u1",
  email: "ada@x.test",
  name: "Ada",
  organizationId: "org-1",
  tokenVersion: 2,
  passwordHash: "hash",
  isActive: true,
  organization: { requireMfa: false },
  ...over,
});
const grant = () => `${MFA_REAUTH_COOKIE}=${signReauthCookie({ id: "u1", tokenVersion: 2 }, Math.floor(Date.now() / 1000) + 200)}`;
const req = (body?: unknown, cookie?: string, method = "POST") =>
  new Request("http://x/api/user/mfa", {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const factors = (over: Partial<{ totp: boolean; webauthnCount: number; recoveryRemaining: number }> = {}) => ({ totp: false, webauthnCount: 0, recoveryRemaining: 0, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "s".repeat(40);
  process.env.MASTER_KEK = "ab".repeat(32);
  __resetDerivedKeysForTests();
  h.auth.mockResolvedValue({ user: { id: "u1" } });
  h.userFind.mockResolvedValue(dbUser());
  h.peek.mockResolvedValue({ allowed: true, retryAfter: 0 });
  h.loadFactors.mockResolvedValue(factors());
  h.mfaUpdateMany.mockResolvedValue({ count: 1 });
  h.reserve.mockResolvedValue({ allowed: true, finish: h.finish });
  // The guarded removal runs the removal against the (mocked) client as "tx".
  h.removeGuarded.mockImplementation(async (_userId: string, remove: (tx: unknown) => Promise<unknown>) => {
    await remove({ userMfa: { update: h.mfaUpdate }, webAuthnCredential: { delete: h.credDelete } });
    return "ok";
  });
});

describe("POST /api/user/mfa/reauth", () => {
  it("password only when the account has no MFA; sets the step-up cookie", async () => {
    h.compare.mockResolvedValue(true);
    const res = await reauth(req({ password: "pw" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${MFA_REAUTH_COOKIE}=v1\\.u1\\.2\\.`));
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/Path=\/api(;|$)/);
    expect(h.finish).toHaveBeenCalledWith(true);
  });

  it("with MFA on, the password alone is not enough; a code is", async () => {
    h.compare.mockResolvedValue(true);
    h.loadFactors.mockResolvedValue(factors({ totp: true, recoveryRemaining: 10 }));
    expect((await reauth(req({ password: "pw" }))).status).toBe(400);
    h.verifyUserTotp.mockResolvedValue(false);
    expect((await reauth(req({ password: "pw", code: "000000" }))).status).toBe(400);
    expect(h.finish).toHaveBeenLastCalledWith(false);
    h.verifyUserTotp.mockResolvedValue(true);
    expect((await reauth(req({ password: "pw", code: "123456" }))).status).toBe(200);
    // A recovery code works too (and is spent).
    h.consumeRecoveryCode.mockResolvedValue({ ok: true, remaining: 9 });
    expect((await reauth(req({ password: "pw", code: "ABCDE-FGHJK" }))).status).toBe(200);
    expect(h.consumeRecoveryCode).toHaveBeenCalledWith("u1", "ABCDE-FGHJK");
  });

  it("each attempt is reserved before the password check; a wrong password keeps it; a used-up cap is 429 without bcrypt", async () => {
    h.compare.mockImplementation(async () => {
      expect(h.reserve).toHaveBeenCalledWith({ scope: "reauth", userId: "u1", ip: "1.2.3.4", deviceKey: null });
      return false;
    });
    expect((await reauth(req({ password: "bad" }))).status).toBe(400);
    expect(h.finish).toHaveBeenCalledWith(false);
    h.compare.mockClear();
    h.reserve.mockResolvedValueOnce({ allowed: false });
    expect((await reauth(req({ password: "pw" }))).status).toBe(429);
    expect(h.compare).not.toHaveBeenCalled();
  });
});

describe("TOTP enrollment", () => {
  it("setup needs a step-up grant and stores the secret encrypted as pending", async () => {
    expect((await totpSetup(req())).status).toBe(403);
    const res = await totpSetup(req(undefined, grant()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    const stored = h.mfaUpsert.mock.calls[0][0].create.totpPendingSecretEnc as string;
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain(body.secret);
  });

  it("enable: the right code promotes the pending secret and issues recovery codes once", async () => {
    const secret = generateTotpSecret();
    const enc = encryptTotpSecret("u1", secret);
    h.mfaFind.mockResolvedValue({ totpPendingSecretEnc: enc, totpPendingCreatedAt: new Date(), totpEnabledAt: null });
    h.ensureRecoveryCodes.mockResolvedValue(["AAAAA-BBBBB"]);
    const bad = await totpEnable(req({ code: "000000" === generateTotp(secret) ? "111111" : "000000" }));
    expect(bad.status).toBe(400);
    const res = await totpEnable(req({ code: generateTotp(secret) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recoveryCodes: ["AAAAA-BBBBB"] });
    expect(h.mfaUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totpSecretEnc: enc, totpPendingSecretEnc: null, totpLastCounter: expect.any(Number) }) }),
    );
    expect(h.activity).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa.enabled" }));
  });

  it("enable: an expired setup is refused", async () => {
    h.mfaFind.mockResolvedValue({ totpPendingSecretEnc: "v1:x", totpPendingCreatedAt: new Date(Date.now() - 60 * 60 * 1000), totpEnabledAt: null });
    expect((await totpEnable(req({ code: "123456" }))).status).toBe(400);
  });
});

describe("disable / regenerate / turn off", () => {
  it("removing the authenticator app needs the grant; it's blocked as the last factor under the policy", async () => {
    h.loadFactors.mockResolvedValue(factors({ totp: true }));
    expect((await totpDelete(req(undefined, undefined, "DELETE"))).status).toBe(403);
    h.userFind.mockResolvedValue(dbUser({ organization: { requireMfa: true } }));
    expect((await totpDelete(req(undefined, grant(), "DELETE"))).status).toBe(409);
    // A concurrent removal won the race: the locked re-check inside the transaction refuses.
    h.userFind.mockResolvedValue(dbUser());
    h.removeGuarded.mockResolvedValueOnce("blocked");
    expect((await totpDelete(req(undefined, grant(), "DELETE"))).status).toBe(409);
    h.cleanupIfNoFactors.mockResolvedValue(true);
    const res = await totpDelete(req(undefined, grant(), "DELETE"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mfaOff: true });
    expect(h.mfaUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totpSecretEnc: null, totpEnabledAt: null }) }));
  });

  it("regenerating recovery codes needs the grant and MFA on", async () => {
    expect((await regenerate(req())).status).toBe(403);
    expect((await regenerate(req(undefined, grant()))).status).toBe(400);
    h.loadFactors.mockResolvedValue(factors({ totp: true, recoveryRemaining: 1 }));
    h.issueRecoveryCodes.mockResolvedValue(Array.from({ length: 10 }, (_, i) => `CODE${i}`));
    const res = await regenerate(req(undefined, grant()));
    expect(res.status).toBe(200);
    expect((await res.json()).recoveryCodes).toHaveLength(10);
    expect(h.activity).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa.recovery_regenerated" }));
  });

  it("turning MFA off needs the grant and is refused under the policy", async () => {
    expect((await deleteAll(req(undefined, undefined, "DELETE"))).status).toBe(403);
    h.userFind.mockResolvedValue(dbUser({ organization: { requireMfa: true } }));
    expect((await deleteAll(req(undefined, grant(), "DELETE"))).status).toBe(409);
    h.userFind.mockResolvedValue(dbUser());
    expect((await deleteAll(req(undefined, grant(), "DELETE"))).status).toBe(200);
    expect(h.removeAllMfa).toHaveBeenCalledWith("u1");
  });

  it("a grant from before a sign-out (old tokenVersion) is not accepted", async () => {
    h.userFind.mockResolvedValue(dbUser({ tokenVersion: 3 }));
    expect((await deleteAll(req(undefined, grant(), "DELETE"))).status).toBe(403);
  });

  it("removing a security key: own keys only, needs the grant, last-factor guard", async () => {
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    h.credFind.mockResolvedValue({ id: "k1", userId: "u2", name: "Key" });
    expect((await keyDelete(req(undefined, grant(), "DELETE"), ctx("k1"))).status).toBe(404);
    h.credFind.mockResolvedValue({ id: "k1", userId: "u1", name: "Key" });
    expect((await keyDelete(req(undefined, undefined, "DELETE"), ctx("k1"))).status).toBe(403);
    h.loadFactors.mockResolvedValue(factors({ webauthnCount: 1 }));
    h.userFind.mockResolvedValue(dbUser({ organization: { requireMfa: true } }));
    expect((await keyDelete(req(undefined, grant(), "DELETE"), ctx("k1"))).status).toBe(409);
    h.loadFactors.mockResolvedValue(factors({ webauthnCount: 2 }));
    expect((await keyDelete(req(undefined, grant(), "DELETE"), ctx("k1"))).status).toBe(200);
    expect(h.credDelete).toHaveBeenCalledWith({ where: { id: "k1" } });
  });
});
