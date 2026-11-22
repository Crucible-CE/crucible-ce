// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const updateMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: (...a: unknown[]) => findUnique(...a), updateMany: (...a: unknown[]) => updateMany(...a) } },
}));
const checkLoginThrottle = vi.fn();
const recordLoginFailure = vi.fn();
vi.mock("@/lib/security/login-throttle", () => ({
  checkLoginThrottle: (...a: unknown[]) => checkLoginThrottle(...a),
  recordLoginFailure: (...a: unknown[]) => recordLoginFailure(...a),
  clearLoginPair: (...a: unknown[]) => clearLoginPair(...a),
}));
const recordActivity = vi.fn();
vi.mock("@/lib/security/activity-log", () => ({
  recordActivity: (...a: unknown[]) => recordActivity(...a),
  deriveActivityIp: () => ({ ipHash: null, ipLastOctet: null }),
}));
const disconnectUserSockets = vi.fn();
vi.mock("@/lib/socket/evict", () => ({ disconnectUserSockets: (...a: unknown[]) => disconnectUserSockets(...a) }));

// next-auth's ESM entry doesn't resolve under vitest; only authorize logic is under test.
vi.mock("next-auth", () => ({ CredentialsSignin: class extends Error {} }));
vi.mock("next-auth/providers/credentials", () => ({ default: (c: unknown) => c }));

// Two-factor: only "does this account have MFA" and "open a pending ticket" matter here.
const userHasMfa = vi.fn();
const startMfaLogin = vi.fn();
const grantReauthOnSignIn = vi.fn();
vi.mock("@/lib/auth/mfa/service", () => ({ userHasMfa: (...a: unknown[]) => userHasMfa(...a) }));
vi.mock("@/lib/auth/mfa/login", () => ({
  MfaRequiredError: class extends Error {
    code = "mfa_required";
  },
  startMfaLogin: (...a: unknown[]) => startMfaLogin(...a),
  grantReauthOnSignIn: (...a: unknown[]) => grantReauthOnSignIn(...a),
  authorizeMfa: vi.fn(),
  sessionUser: (u: { id: string }) => ({ ...u, _loginIp: {} }),
}));
const clearLoginPair = vi.fn();

const compare = vi.fn();
vi.mock("bcryptjs", () => ({ default: { compare: (...a: unknown[]) => compare(...a) } }));

import { authorizeCredentials, revokeOnSignOut } from "./auth.config";
import { KNOWN_DEVICE_COOKIE, signKnownDevice } from "./known-device";

const activeUser = {
  id: "u1",
  email: "a@x.test",
  name: "A",
  image: null,
  organizationId: "org-1",
  role: "contributor",
  passwordHash: "$2b$12$real",
  isActive: true,
  emailVerified: new Date(),
};
const req = (cookie?: string) => new Request("http://x/api/auth/callback/credentials", { method: "POST", headers: cookie ? { cookie } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "s".repeat(40);
  checkLoginThrottle.mockResolvedValue({ allowed: true, retryAfter: 0 });
  userHasMfa.mockResolvedValue(false);
  compare.mockResolvedValue(false);
});

describe("authorizeCredentials", () => {
  it("unknown email: still runs one bcrypt compare (dummy hash), counts a failure, logs a hashed email", async () => {
    findUnique.mockResolvedValue(null);
    expect(await authorizeCredentials({ email: "Nobody@X.test ", password: "pw" }, req())).toBeNull();
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0][1]).toMatch(/^\$2[ab]\$12\$/);
    expect(recordLoginFailure).toHaveBeenCalledWith(expect.objectContaining({ email: "nobody@x.test" }));
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "login.failure", userId: null, email: "nobody@x.test" }));
  });

  it("inactive or passwordless accounts compare against the dummy hash too", async () => {
    for (const u of [{ ...activeUser, isActive: false }, { ...activeUser, passwordHash: null }]) {
      compare.mockClear();
      findUnique.mockResolvedValue(u);
      expect(await authorizeCredentials({ email: "a@x.test", password: "pw" }, req())).toBeNull();
      expect(compare).toHaveBeenCalledTimes(1);
      expect(compare.mock.calls[0][1]).not.toBe("$2b$12$real");
    }
  });

  it("a throttled attempt returns null without bcrypt and without counting another failure", async () => {
    findUnique.mockResolvedValue(activeUser);
    checkLoginThrottle.mockResolvedValue({ allowed: false, retryAfter: 30, gate: "pair" });
    compare.mockResolvedValue(true);
    expect(await authorizeCredentials({ email: "a@x.test", password: "right" }, req())).toBeNull();
    expect(compare).not.toHaveBeenCalled();
    expect(recordLoginFailure).not.toHaveBeenCalled();
  });

  it("a valid known-device cookie for THIS account marks the attempt trusted", async () => {
    findUnique.mockResolvedValue(activeUser);
    compare.mockResolvedValue(true);
    const mine = signKnownDevice(activeUser)!;
    const r = await authorizeCredentials({ email: "a@x.test", password: "right" }, req(`${KNOWN_DEVICE_COOKIE}=${mine}`));
    expect(r?.id).toBe("u1");
    expect(checkLoginThrottle).toHaveBeenCalledWith(expect.objectContaining({ trustedDevice: true }));

    const someoneElse = signKnownDevice({ id: "u2", passwordHash: "$2b$12$other" })!;
    await authorizeCredentials({ email: "a@x.test", password: "right" }, req(`${KNOWN_DEVICE_COOKIE}=${someoneElse}`));
    expect(checkLoginThrottle).toHaveBeenLastCalledWith(expect.objectContaining({ trustedDevice: false }));

    // A malformed cookie is simply "not known".
    await authorizeCredentials({ email: "a@x.test", password: "right" }, req(`${KNOWN_DEVICE_COOKIE}=%%garbage`));
    expect(checkLoginThrottle).toHaveBeenLastCalledWith(expect.objectContaining({ trustedDevice: false }));
  });

  it("an account with MFA gets no session from the password: a pending ticket + mfa_required, even from a known device", async () => {
    findUnique.mockResolvedValue({ ...activeUser, tokenVersion: 4 });
    compare.mockResolvedValue(true);
    userHasMfa.mockResolvedValue(true);
    const mine = signKnownDevice(activeUser)!;
    await expect(authorizeCredentials({ email: "a@x.test", password: "right" }, req(`${KNOWN_DEVICE_COOKIE}=${mine}`))).rejects.toMatchObject({
      code: "mfa_required",
    });
    expect(startMfaLogin).toHaveBeenCalledWith({ id: "u1", tokenVersion: 4 }, expect.anything());
    // Password was right: not a failure; but the throttle pair is only cleared once MFA passes.
    expect(recordLoginFailure).not.toHaveBeenCalled();
    expect(clearLoginPair).not.toHaveBeenCalled();
    expect(grantReauthOnSignIn).not.toHaveBeenCalled();
  });

  it("a completed password-only sign-in sets the 5-minute confirm-it's-you grant", async () => {
    findUnique.mockResolvedValue({ ...activeUser, tokenVersion: 4 });
    compare.mockResolvedValue(true);
    expect(await authorizeCredentials({ email: "a@x.test", password: "right" }, req())).toMatchObject({ id: "u1" });
    expect(grantReauthOnSignIn).toHaveBeenCalledWith(expect.objectContaining({ id: "u1", tokenVersion: 4 }), expect.anything());
  });

  it("an unverified email is refused before the MFA step", async () => {
    findUnique.mockResolvedValue({ ...activeUser, emailVerified: null });
    compare.mockResolvedValue(true);
    userHasMfa.mockResolvedValue(true);
    await expect(authorizeCredentials({ email: "a@x.test", password: "right" }, req())).rejects.toBeTruthy();
    expect(startMfaLogin).not.toHaveBeenCalled();
  });

  it("rejects NUL bytes before touching the DB", async () => {
    expect(await authorizeCredentials({ email: "a\u0000@x.test", password: "pw" }, req())).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("revokeOnSignOut", () => {
  it("bumps tokenVersion only while the token's version is current, and drops sockets", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    expect(await revokeOnSignOut({ id: "u1", tokenVersion: 4 })).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "u1", tokenVersion: 4 },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(disconnectUserSockets).toHaveBeenCalledWith("u1");

    updateMany.mockResolvedValue({ count: 0 }); // stale token replayed
    disconnectUserSockets.mockClear();
    expect(await revokeOnSignOut({ id: "u1", tokenVersion: 3 })).toBe(false);
    expect(disconnectUserSockets).not.toHaveBeenCalled();
  });

  it("is a no-op without a token and never throws", async () => {
    expect(await revokeOnSignOut(null)).toBe(false);
    updateMany.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await revokeOnSignOut({ id: "u1", tokenVersion: 1 })).toBe(false);
  });
});
