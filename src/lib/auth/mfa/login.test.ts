// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ticketFind: vi.fn(),
  ticketUpdate: vi.fn(),
  ticketUpdateMany: vi.fn(),
  ticketCreate: vi.fn(),
  ticketDeleteMany: vi.fn(),
  userFind: vi.fn(),
  verifyUserTotp: vi.fn(),
  consumeRecoveryCode: vi.fn(),
  loadFactors: vi.fn(),
  verifyAuthentication: vi.fn(),
  reserve: vi.fn(),
  finish: vi.fn(),
  knownDevice: vi.fn(),
  recordLoginFailure: vi.fn(),
  clearLoginPair: vi.fn(),
  recordActivity: vi.fn(),
  setKnownDevice: vi.fn(),
}));

vi.mock("next-auth", () => ({
  CredentialsSignin: class extends Error {
    code = "credentials";
  },
}));
vi.mock("@/lib/db", () => ({
  db: {
    mfaLoginTicket: { findUnique: h.ticketFind, update: h.ticketUpdate, updateMany: h.ticketUpdateMany, create: h.ticketCreate, deleteMany: h.ticketDeleteMany },
    user: { findUnique: h.userFind },
  },
}));
vi.mock("./service", () => ({ verifyUserTotp: h.verifyUserTotp, consumeRecoveryCode: h.consumeRecoveryCode, loadFactors: h.loadFactors }));
vi.mock("./webauthn", () => ({ verifyAuthentication: h.verifyAuthentication }));
vi.mock("@/lib/security/rate-limit", () => ({ ipFromRequest: () => "203.0.113.9" }));
vi.mock("./attempts", () => ({ reserveFactorAttempt: h.reserve }));
vi.mock("@/lib/security/login-throttle", () => ({ recordLoginFailure: h.recordLoginFailure, clearLoginPair: h.clearLoginPair }));
vi.mock("@/lib/security/activity-log", () => ({ recordActivity: h.recordActivity, deriveActivityIp: () => ({ ipHash: null, ipLastOctet: null }) }));
vi.mock("@/lib/auth/known-device", () => ({
  isHttpsRequest: () => false,
  setKnownDeviceCookie: h.setKnownDevice,
  readKnownDeviceCookie: () => "device-cookie",
  verifyKnownDevice: h.knownDevice,
}));

import { MAX_LIVE_TICKETS, MFA_TICKET_MAX_ATTEMPTS, authorizeMfa, loadPendingLogin, startMfaLogin } from "./login";
import { MFA_PENDING_COOKIE, signPendingCookie } from "./cookies";

const NOW_SEC = Math.floor(Date.now() / 1000);
const user = {
  id: "u1",
  email: "ada@x.test",
  name: "Ada",
  image: null,
  organizationId: "org-1",
  role: "contributor",
  isActive: true,
  emailVerified: new Date(),
  tokenVersion: 2,
};
function ticketRow(over: Record<string, unknown> = {}) {
  return {
    id: "tk1",
    userId: "u1",
    tokenVersion: 2,
    expiresAt: new Date((NOW_SEC + 240) * 1000),
    consumedAt: null,
    failedAttempts: 0,
    user,
    ...over,
  };
}
const cookie = (t = { id: "tk1", userId: "u1", tokenVersion: 2 }, exp = NOW_SEC + 240) => `${MFA_PENDING_COOKIE}=${signPendingCookie(t, exp)}`;
const req = (c?: string) => new Request("http://x/api/auth/callback/mfa", { method: "POST", headers: c ? { cookie: c } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "s".repeat(40);
  h.ticketFind.mockResolvedValue(ticketRow());
  h.ticketUpdateMany.mockResolvedValue({ count: 1 });
  h.userFind.mockResolvedValue({ id: "u1", passwordHash: "hash" });
  h.reserve.mockResolvedValue({ allowed: true, finish: h.finish });
  h.knownDevice.mockReturnValue(false);
  h.verifyUserTotp.mockResolvedValue(false);
});

describe("pending sign-in ticket", () => {
  it("needs a valid signed cookie for a live ticket", async () => {
    expect(await loadPendingLogin(req())).toBeNull();
    expect(await loadPendingLogin(req(cookie()))).toMatchObject({ ticket: { id: "tk1" }, user: { id: "u1" } });
    expect(await loadPendingLogin(req(`${MFA_PENDING_COOKIE}=v1.tk1.${NOW_SEC + 240}.forged`))).toBeNull();
  });

  it("expired, consumed or burned tickets are dead", async () => {
    for (const over of [{ expiresAt: new Date(Date.now() - 1000) }, { consumedAt: new Date() }, { failedAttempts: MFA_TICKET_MAX_ATTEMPTS }]) {
      h.ticketFind.mockResolvedValueOnce(ticketRow(over));
      expect(await loadPendingLogin(req(cookie()))).toBeNull();
    }
  });

  it("is bound to the user's tokenVersion and account state at the password step", async () => {
    h.ticketFind.mockResolvedValueOnce(ticketRow({ user: { ...user, tokenVersion: 3 } }));
    expect(await loadPendingLogin(req(cookie()))).toBeNull();
    h.ticketFind.mockResolvedValueOnce(ticketRow({ user: { ...user, isActive: false } }));
    expect(await loadPendingLogin(req(cookie()))).toBeNull();
    h.ticketFind.mockResolvedValueOnce(ticketRow({ user: { ...user, emailVerified: null } }));
    expect(await loadPendingLogin(req(cookie()))).toBeNull();
    // A cookie minted for another tokenVersion doesn't verify against this ticket.
    expect(await loadPendingLogin(req(cookie({ id: "tk1", userId: "u1", tokenVersion: 1 })))).toBeNull();
  });
});

describe("authorizeMfa (the 'mfa' provider)", () => {
  const reservationCall = () => h.ticketUpdateMany.mock.calls.find((c) => c[0].data?.failedAttempts);
  const consumeCall = () => h.ticketUpdateMany.mock.calls.find((c) => c[0].data?.consumedAt);

  it("no pending ticket -> mfa_expired", async () => {
    await expect(authorizeMfa({ method: "totp", code: "123456" }, req())).rejects.toMatchObject({ code: "mfa_expired" });
  });

  it("reserves an attempt on the ticket atomically BEFORE checking the code", async () => {
    h.verifyUserTotp.mockImplementation(async () => {
      expect(reservationCall()).toBeTruthy();
      return true;
    });
    await authorizeMfa({ method: "totp", code: "123456" }, req(cookie()));
    expect(reservationCall()![0]).toEqual({
      where: { id: "tk1", consumedAt: null, expiresAt: { gt: expect.any(Date) }, failedAttempts: { lt: MFA_TICKET_MAX_ATTEMPTS } },
      data: { failedAttempts: { increment: 1 } },
    });
  });

  it("no attempt left on the ticket (a concurrent request took the last one) -> mfa_expired, code never checked", async () => {
    h.ticketUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(authorizeMfa({ method: "totp", code: "123456" }, req(cookie()))).rejects.toMatchObject({ code: "mfa_expired" });
    expect(h.verifyUserTotp).not.toHaveBeenCalled();
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it("a valid TOTP code completes the sign-in once: limits refunded, ticket consumed, pair cleared, device remembered", async () => {
    h.verifyUserTotp.mockResolvedValue(true);
    const u = await authorizeMfa({ method: "totp", code: "123456" }, req(cookie()));
    expect(u).toMatchObject({ id: "u1", organizationId: "org-1", role: "contributor" });
    expect(h.finish).toHaveBeenCalledWith(true);
    expect(consumeCall()![0].where).toMatchObject({ id: "tk1", consumedAt: null });
    expect(h.clearLoginPair).toHaveBeenCalledWith({ email: "ada@x.test", ip: "203.0.113.9" });
    expect(h.setKnownDevice).toHaveBeenCalled();
    expect(h.recordActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa.success", metadata: { method: "totp" } }));
  });

  it("a ticket another request already consumed can't be used again", async () => {
    h.verifyUserTotp.mockResolvedValue(true);
    h.ticketUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(authorizeMfa({ method: "totp", code: "123456" }, req(cookie()))).rejects.toMatchObject({ code: "mfa_expired" });
  });

  it("a wrong code: limits kept (not refunded), login throttle and activity log", async () => {
    h.ticketFind.mockResolvedValueOnce(ticketRow()).mockResolvedValueOnce({ failedAttempts: 1 });
    await expect(authorizeMfa({ method: "totp", code: "000000" }, req(cookie()))).rejects.toMatchObject({ code: "mfa_invalid" });
    expect(h.finish).toHaveBeenCalledWith(false);
    expect(h.recordLoginFailure).toHaveBeenCalledWith({ email: "ada@x.test", ip: "203.0.113.9" });
    expect(h.recordActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa.failure" }));
    expect(consumeCall()).toBeUndefined();
  });

  it("the last attempt on a ticket burns it (back to the password step)", async () => {
    h.ticketFind.mockResolvedValueOnce(ticketRow()).mockResolvedValueOnce({ failedAttempts: MFA_TICKET_MAX_ATTEMPTS });
    await expect(authorizeMfa({ method: "totp", code: "000000" }, req(cookie()))).rejects.toMatchObject({ code: "mfa_expired" });
  });

  it("rate-limited (database or Redis cap): refused before any factor check", async () => {
    h.reserve.mockResolvedValueOnce({ allowed: false });
    await expect(authorizeMfa({ method: "totp", code: "123456" }, req(cookie()))).rejects.toMatchObject({ code: "mfa_rate_limited" });
    expect(h.verifyUserTotp).not.toHaveBeenCalled();
  });

  it("the per-user cap is keyed on user+IP; a valid known-device cookie is passed on (exempt from the per-user DB cap)", async () => {
    h.verifyUserTotp.mockResolvedValue(true);
    await authorizeMfa({ method: "totp", code: "123456" }, req(cookie()));
    expect(h.reserve).toHaveBeenLastCalledWith({ scope: "login", userId: "u1", ip: "203.0.113.9", deviceKey: null });
    h.knownDevice.mockReturnValue(true);
    await authorizeMfa({ method: "totp", code: "123456" }, req(cookie()));
    expect(h.reserve).toHaveBeenLastCalledWith({ scope: "login", userId: "u1", ip: "203.0.113.9", deviceKey: "device-cookie" });
  });

  it("recovery codes: accepted once, the reuse is a failure", async () => {
    h.consumeRecoveryCode.mockResolvedValueOnce({ ok: true, remaining: 9 });
    await expect(authorizeMfa({ method: "recovery", code: "ABCDE-FGHJK" }, req(cookie()))).resolves.toMatchObject({ id: "u1" });
    expect(h.recordActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa.success", metadata: { method: "recovery", recoveryCodesRemaining: 9 } }));
    h.consumeRecoveryCode.mockResolvedValueOnce({ ok: false, remaining: 9 });
    h.ticketFind.mockResolvedValueOnce(ticketRow()).mockResolvedValueOnce({ failedAttempts: 2 });
    await expect(authorizeMfa({ method: "recovery", code: "ABCDE-FGHJK" }, req(cookie()))).rejects.toMatchObject({ code: "mfa_invalid" });
  });

  it("WebAuthn: the assertion is checked against the challenge bound to this ticket", async () => {
    h.verifyAuthentication.mockResolvedValueOnce({ ok: true, credentialId: "c1" });
    const response = JSON.stringify({ id: "cred", response: {} });
    await expect(authorizeMfa({ method: "webauthn", response }, req(cookie()))).resolves.toMatchObject({ id: "u1" });
    expect(h.verifyAuthentication).toHaveBeenCalledWith("u1", { id: "cred", response: {} }, "login", "tk1");
    h.verifyAuthentication.mockResolvedValueOnce({ ok: false, reason: "counter" });
    h.ticketFind.mockResolvedValueOnce(ticketRow()).mockResolvedValueOnce({ failedAttempts: 2 });
    await expect(authorizeMfa({ method: "webauthn", response }, req(cookie()))).rejects.toMatchObject({ code: "mfa_invalid" });
  });

  it("malformed input is refused", async () => {
    await expect(authorizeMfa({ method: "sms", code: "1" }, req(cookie()))).rejects.toMatchObject({ code: "mfa_invalid" });
    await expect(authorizeMfa({ method: "webauthn", response: "{not json" }, req(cookie()))).rejects.toMatchObject({ code: "mfa_invalid" });
  });
});

describe("startMfaLogin", () => {
  it(`keeps at most ${MAX_LIVE_TICKETS} live pending sign-ins per user (drops the oldest)`, async () => {
    h.ticketFind.mockReset();
    const live = [{ id: "t4" }, { id: "t3" }, { id: "t2" }, { id: "t1" }];
    const findMany = vi.fn().mockResolvedValue(live);
    const { db } = await import("@/lib/db");
    (db.mfaLoginTicket as unknown as { findMany: typeof findMany }).findMany = findMany;
    h.ticketCreate.mockResolvedValue({ id: "t5", userId: "u1", tokenVersion: 2 });
    await startMfaLogin({ id: "u1", tokenVersion: 2 }, undefined);
    expect(h.ticketDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["t2", "t1"] } } });
    expect(h.ticketCreate).toHaveBeenCalled();
  });
});
