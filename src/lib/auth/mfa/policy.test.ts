import { describe, expect, it } from "vitest";
import { canEnablePolicy, canRemoveFactor, mfaEnrollRequired, signInWall } from "./policy";
import { webauthnConfig } from "./webauthn-config";

describe("require-MFA policy decisions", () => {
  it("funnels only when the policy is on and the user has no factor", () => {
    expect(mfaEnrollRequired({ requireMfa: true, hasMfa: false })).toBe(true);
    expect(mfaEnrollRequired({ requireMfa: true, hasMfa: true })).toBe(false);
    expect(mfaEnrollRequired({ requireMfa: false, hasMfa: false })).toBe(false);
  });

  it("keeps the last factor while the policy is on", () => {
    expect(canRemoveFactor({ requireMfa: true, factorsAfterRemoval: 0 })).toBe(false);
    expect(canRemoveFactor({ requireMfa: true, factorsAfterRemoval: 1 })).toBe(true);
    expect(canRemoveFactor({ requireMfa: false, factorsAfterRemoval: 0 })).toBe(true);
  });

  it("an admin without MFA can't turn the policy on (no self lock-out)", () => {
    expect(canEnablePolicy({ actorHasMfa: false })).toMatchObject({ ok: false });
    expect(canEnablePolicy({ actorHasMfa: true })).toEqual({ ok: true });
  });
});

describe("signInWall (middleware)", () => {
  const mfa = { mfaEnrollRequired: true };
  it("redirects pages to the enrollment funnel and 403s other APIs", () => {
    expect(signInWall("/dashboard", mfa)).toEqual({ kind: "redirect", to: "/mfa-setup-required" });
    expect(signInWall("/settings", mfa)).toEqual({ kind: "redirect", to: "/mfa-setup-required" });
    expect(signInWall("/api/incidents", mfa)).toMatchObject({ kind: "forbidden", code: "mfa_enrollment_required" });
  });

  it("allows what the funnel page needs", () => {
    for (const p of ["/mfa-setup-required", "/api/user/mfa", "/api/user/mfa/totp/setup", "/api/user/mfa/reauth", "/api/auth/session", "/api/auth/signout"]) {
      expect(signInWall(p, mfa), p).toEqual({ kind: "allow" });
    }
    // Not a prefix match on "/api/user/mfa-anything".
    expect(signInWall("/api/user/mfax", mfa).kind).toBe("forbidden");
  });

  it("no claims: no wall", () => {
    expect(signInWall("/dashboard", {})).toEqual({ kind: "allow" });
  });
});

describe("webauthnConfig (RP from PUBLIC_URL)", () => {
  it("https domain and http://localhost work", () => {
    expect(webauthnConfig({ PUBLIC_URL: "https://crucible.example.com" })).toEqual({ available: true, rpID: "crucible.example.com", origin: "https://crucible.example.com" });
    expect(webauthnConfig({ PUBLIC_URL: "http://localhost:3200" })).toEqual({ available: true, rpID: "localhost", origin: "http://localhost:3200" });
  });

  it("falls back to AUTH_URL / NEXTAUTH_URL", () => {
    expect(webauthnConfig({ AUTH_URL: "https://a.example.com/x" })).toMatchObject({ rpID: "a.example.com" });
    expect(webauthnConfig({ NEXTAUTH_URL: "https://b.example.com" })).toMatchObject({ rpID: "b.example.com" });
  });

  it("explains why plain http, IP addresses and a missing URL don't work", () => {
    const http = webauthnConfig({ PUBLIC_URL: "http://crucible.lan" });
    expect(http).toMatchObject({ available: false });
    expect(!http.available && http.reason).toMatch(/https/);
    expect(webauthnConfig({ PUBLIC_URL: "https://10.0.0.5" })).toMatchObject({ available: false });
    expect(webauthnConfig({})).toMatchObject({ available: false });
    expect(webauthnConfig({ PUBLIC_URL: "not a url" })).toMatchObject({ available: false });
  });
});
