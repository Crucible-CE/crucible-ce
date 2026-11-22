// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MFA_REAUTH_TTL_SEC,
  parsePendingCookie,
  readCookie,
  signPendingCookie,
  signReauthCookie,
  verifyPendingCookie,
  verifyReauthCookie,
} from "./cookies";

const env = { AUTH_SECRET: "x".repeat(40) };
const NOW = 1_760_000_000;
const ticket = { id: "ckticket1", userId: "u1", tokenVersion: 3 };

describe("pending-MFA cookie", () => {
  it("verifies for its own ticket until it expires", () => {
    const v = signPendingCookie(ticket, NOW + 300, env)!;
    expect(parsePendingCookie(v)).toMatchObject({ ticketId: "ckticket1", exp: NOW + 300 });
    expect(verifyPendingCookie(v, ticket, NOW, env)).toBe(true);
    expect(verifyPendingCookie(v, ticket, NOW + 301, env)).toBe(false);
  });

  it("is bound to the user and tokenVersion (sign-out / password change kills it)", () => {
    const v = signPendingCookie(ticket, NOW + 300, env)!;
    expect(verifyPendingCookie(v, { ...ticket, tokenVersion: 4 }, NOW, env)).toBe(false);
    expect(verifyPendingCookie(v, { ...ticket, userId: "u2" }, NOW, env)).toBe(false);
    expect(verifyPendingCookie(v, { ...ticket, id: "other" }, NOW, env)).toBe(false);
  });

  it("can't be forged, extended or verified under another secret", () => {
    const v = signPendingCookie(ticket, NOW + 300, env)!;
    const parts = v.split(".");
    expect(verifyPendingCookie([parts[0], parts[1], String(NOW + 9999), parts[3]].join("."), ticket, NOW, env)).toBe(false);
    expect(verifyPendingCookie(v.slice(0, -2) + "AA", ticket, NOW, env)).toBe(false);
    expect(verifyPendingCookie(v, ticket, NOW, { AUTH_SECRET: "y".repeat(40) })).toBe(false);
    expect(verifyPendingCookie("garbage", ticket, NOW, env)).toBe(false);
    expect(verifyPendingCookie(null, ticket, NOW, env)).toBe(false);
    expect(signPendingCookie(ticket, NOW + 300, {})).toBeNull();
  });
});

describe("step-up (reauth) cookie", () => {
  const user = { id: "u1", tokenVersion: 3 };
  it("returns its expiry while valid for the same user + tokenVersion", () => {
    const v = signReauthCookie(user, NOW + MFA_REAUTH_TTL_SEC, env)!;
    expect(verifyReauthCookie(v, user, NOW, env)).toBe(NOW + MFA_REAUTH_TTL_SEC);
    expect(verifyReauthCookie(v, user, NOW + MFA_REAUTH_TTL_SEC + 1, env)).toBeNull();
    expect(verifyReauthCookie(v, { ...user, tokenVersion: 4 }, NOW, env)).toBeNull();
    expect(verifyReauthCookie(v, { ...user, id: "u2" }, NOW, env)).toBeNull();
  });

  it("refuses a far-future expiry and tampering", () => {
    expect(verifyReauthCookie(signReauthCookie(user, NOW + 86_400, env), user, NOW, env)).toBeNull();
    const v = signReauthCookie(user, NOW + 60, env)!;
    expect(verifyReauthCookie(v.replace("u1", "u9"), user, NOW, env)).toBeNull();
  });
});

describe("readCookie", () => {
  it("reads one cookie from the header", () => {
    const req = new Request("http://x", { headers: { cookie: "a=1; crucible_mfa_pending=v1.x.1.y; b=2" } });
    expect(readCookie(req, "crucible_mfa_pending")).toBe("v1.x.1.y");
    expect(readCookie(req, "nope")).toBeNull();
    expect(readCookie(undefined, "a")).toBeNull();
  });
});
