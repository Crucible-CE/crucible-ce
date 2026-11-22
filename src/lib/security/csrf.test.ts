import { describe, it, expect } from "vitest";
import { checkCsrf, describeCsrfAllowedOrigins } from "./csrf";

const PROD = { NODE_ENV: "production", PUBLIC_URL: "https://crucible.example.com" };
const check = (method: string, pathname: string, headers: Record<string, string> = {}, env: Record<string, string | undefined> = PROD) =>
  checkCsrf({ method, pathname, headers: new Headers(headers) }, env);

describe("checkCsrf", () => {
  it("ignores safe methods and non-API paths", () => {
    expect(check("GET", "/api/incidents", { origin: "https://evil.test" }).ok).toBe(true);
    expect(check("POST", "/incidents", { origin: "https://evil.test" }).ok).toBe(true);
  });

  it("accepts the configured origin and rejects others (Origin)", () => {
    expect(check("POST", "/api/incidents", { origin: "https://crucible.example.com" }).ok).toBe(true);
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(check(m, "/api/incidents", { origin: "https://evil.example.com" }).ok).toBe(false);
    }
    expect(check("POST", "/api/incidents", { origin: "null" }).ok).toBe(false);
  });

  it("falls back to Referer when Origin is absent", () => {
    expect(check("POST", "/api/incidents", { referer: "https://crucible.example.com/incidents/1" }).ok).toBe(true);
    expect(check("POST", "/api/incidents", { referer: "https://evil.example.com/x" }).ok).toBe(false);
  });

  it("allows requests with neither Origin nor Referer (non-browser clients)", () => {
    expect(check("POST", "/api/incidents").ok).toBe(true);
  });

  it("covers /api/auth and /api/public, exempts only Twilio webhooks", () => {
    expect(check("POST", "/api/auth/callback/credentials", { origin: "https://evil.test" }).ok).toBe(false);
    expect(check("POST", "/api/public/setup", { origin: "https://evil.test" }).ok).toBe(false);
    expect(check("POST", "/api/public/page-ack/tok", { origin: "https://evil.test" }).ok).toBe(false);
    expect(check("POST", "/api/public/page-ack/tok").ok).toBe(true);
    expect(check("POST", "/api/public/twilio/inbound", { origin: "https://evil.test" }).ok).toBe(true);
  });

  it("accepts AUTH_URL / NEXTAUTH_URL origins and dev localhost only outside production", () => {
    const env = { NODE_ENV: "production", AUTH_URL: "https://a.example.com/", NEXTAUTH_URL: "https://b.example.com" };
    expect(check("POST", "/api/x", { origin: "https://a.example.com" }, env).ok).toBe(true);
    expect(check("POST", "/api/x", { origin: "https://b.example.com" }, env).ok).toBe(true);
    expect(check("POST", "/api/x", { origin: "http://localhost:3000" }, env).ok).toBe(false);
    expect(check("POST", "/api/x", { origin: "http://localhost:3001" }, { ...env, NODE_ENV: "development" }).ok).toBe(true);
  });

  it("explains a mismatch with both origins and the fix", () => {
    const d = check("POST", "/api/incidents", { origin: "https://evil.example.com" });
    expect(d).toEqual({
      ok: false,
      reason:
        "Origin https://evil.example.com does not match PUBLIC_URL https://crucible.example.com; set PUBLIC_URL to the URL users open",
    });
    const r = check("POST", "/api/incidents", { referer: "http://10.0.0.5:3000/incidents/1" });
    expect(r.ok ? "" : r.reason).toBe(
      "Referer origin http://10.0.0.5:3000 does not match PUBLIC_URL https://crucible.example.com; set PUBLIC_URL to the URL users open",
    );
    const n = check("POST", "/api/incidents", { origin: "null" });
    expect(n.ok ? "" : n.reason).toBe(
      "Origin null does not match PUBLIC_URL https://crucible.example.com; set PUBLIC_URL to the URL users open",
    );
    const unset = check("POST", "/api/x", { origin: "http://evil.test", host: "10.0.0.5:3000" }, { NODE_ENV: "production" });
    expect(unset.ok ? "" : unset.reason).toContain("does not match PUBLIC_URL (not set)");
  });

  it("describes the allowed origin for the boot log", () => {
    expect(describeCsrfAllowedOrigins(PROD)).toBe("https://crucible.example.com");
    expect(
      describeCsrfAllowedOrigins({ NODE_ENV: "production", PUBLIC_URL: "https://a.example.com/", AUTH_URL: "https://b.example.com" }),
    ).toBe("https://a.example.com (also: https://b.example.com)");
    expect(describeCsrfAllowedOrigins({ NODE_ENV: "production" })).toMatch(/^none configured/);
  });

  it("with no public URL configured, falls back to same-Host only", () => {
    const env = { NODE_ENV: "production" };
    expect(check("POST", "/api/x", { origin: "http://10.0.0.5:3000", host: "10.0.0.5:3000" }, env).ok).toBe(true);
    expect(check("POST", "/api/x", { origin: "http://evil.test", host: "10.0.0.5:3000" }, env).ok).toBe(false);
  });
});
