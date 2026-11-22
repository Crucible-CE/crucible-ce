// @vitest-environment node
// Completing a reset sets the password and ends every session. It never signs
// anyone in and never touches two-factor sign-in, so the next sign-in still
// asks for the second factor (authorizeCredentials, auth.config.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mfa: vi.fn() }));
vi.mock("@/lib/db", async () => (await import("@/test/reset-db")).dbModule);
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfter: 0 }), ipFromRequest: () => "1.2.3.4" }));
vi.mock("@/lib/security/activity-log", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/security/login-throttle", () => ({ clearLoginThrottleForEmail: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("new-hash") } }));
// Any two-factor change would go through these.
vi.mock("@/lib/auth/mfa/service", () => ({ removeAllMfa: h.mfa, cleanupIfNoFactors: h.mfa, removeFactorGuarded: h.mfa }));
vi.mock("@/lib/auth/mfa/admin-reset", () => ({ resetMemberMfa: h.mfa }));

import { resetDb } from "@/test/reset-db";
import { issuePasswordResetLink } from "@/lib/auth/password-reset";
import { POST } from "./route";

const use = (token: string) =>
  POST(
    new Request("http://x/api/public/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "a-new-password-1" }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  resetDb.reset();
  resetDb.addUser({ id: "u1", email: "mfa@x", tokenVersion: 4 });
});

describe("POST /api/public/reset-password", () => {
  it("sets the password and bumps tokenVersion, nothing else: no session, two-factor untouched", async () => {
    const { token } = await issuePasswordResetLink("mfa@x");
    const res = await use(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(resetDb.db.user.update).toHaveBeenCalledTimes(1);
    expect(resetDb.db.user.update).toHaveBeenCalledWith({
      where: { email: "mfa@x" },
      data: { passwordHash: "new-hash", tokenVersion: { increment: 1 } },
    });
    expect(resetDb.users.get("u1")!.tokenVersion).toBe(5);
    expect(h.mfa).not.toHaveBeenCalled();
  });

  it("an expired link is refused", async () => {
    const { token } = await issuePasswordResetLink("mfa@x", Date.now() - 61 * 60_000);
    expect((await use(token)).status).toBe(400);
    expect(resetDb.users.get("u1")!.passwordHash).toBe("old-hash");
  });
});
