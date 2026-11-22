// @vitest-environment node
// `npm run reset-password` (scripts/reset-password.ts). Runs the real link
// issue and the real admin two-factor reset service against an in-memory
// store; only the factor tables, email and sockets are stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";

const h = vi.hoisted(() => ({
  audit: vi.fn(),
  activity: vi.fn(),
  removeAll: vi.fn(),
  loadFactors: vi.fn(),
  evict: vi.fn(),
  email: vi.fn(),
}));
vi.mock("@/lib/db", async () => (await import("@/test/reset-db")).dbModule);
vi.mock("@/lib/admin-audit", () => ({ recordAdminAuditLog: h.audit }));
vi.mock("@/lib/security/activity-log", () => ({ recordActivity: h.activity }));
vi.mock("@/lib/socket/evict", () => ({ disconnectUserSockets: h.evict }));
vi.mock("@/lib/email/send-mfa-reset", () => ({ sendMfaResetEmail: h.email }));
vi.mock("@/lib/email/transport", () => ({ activeEmailTransport: () => null }));
vi.mock("@/lib/auth/mfa/service", () => ({
  removeAllMfa: h.removeAll,
  loadFactors: h.loadFactors,
  hasAnyFactor: (f: { totp: boolean; webauthnCount: number }) => f.totp || f.webauthnCount > 0,
}));

import { resetDb } from "@/test/reset-db";
import { parseResetArgs, runResetPasswordCommand } from "./password-reset-command";

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runResetPasswordCommand(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out, err };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDb.reset();
  process.env.PUBLIC_URL = "https://crucible.example.test";
  h.loadFactors.mockResolvedValue({ totp: true, webauthnCount: 1, recoveryRemaining: 10 });
  resetDb.addUser({ id: "u1", email: "admin@x", name: "Ada", role: "administrator", tokenVersion: 7 });
});

describe("npm run reset-password", () => {
  it("prints a one-time PUBLIC_URL link; only its hash is stored; audited as the server console", async () => {
    const { code, out, err } = await run("--", "--email", "Admin@X");
    expect(code).toBe(0);
    expect(err).toEqual([]);
    const url = out.find((l) => l.startsWith("https://"))!;
    expect(url).toMatch(/^https:\/\/crucible\.example\.test\/reset-password\?token=[0-9a-f]{64}$/);
    const token = new URL(url).searchParams.get("token")!;
    const [row] = [...resetDb.tokens.values()];
    expect(row.identifier).toBe("reset:admin@x");
    expect(row.token).toBe(crypto.createHash("sha256").update(token).digest("hex"));
    expect(out[0]).toBe("Reset link for admin@x. It works once and expires in 1 hour.");

    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.reset_link_created",
        actorUserId: "server-console",
        actorName: "server console",
        targetId: "u1",
        organizationId: "org-1",
        metadata: expect.objectContaining({ via: "server_console", mfaReset: false }),
      }),
    );
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain(token);
    // Without --reset-mfa: factors and sessions are left alone.
    expect(h.removeAll).not.toHaveBeenCalled();
    expect(resetDb.users.get("u1")!.tokenVersion).toBe(7);
  });

  it("a second run replaces the first link", async () => {
    await run("--email", "admin@x");
    await run("--email=admin@x");
    expect(resetDb.tokens.size).toBe(1);
  });

  it("--reset-mfa removes every factor and ends sessions through the admin reset service", async () => {
    const { code, out } = await run("--email", "admin@x", "--reset-mfa");
    expect(code).toBe(0);
    expect(h.removeAll).toHaveBeenCalledWith("u1");
    expect(resetDb.users.get("u1")!.tokenVersion).toBe(8);
    expect(h.evict).toHaveBeenCalledWith("u1");
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.mfa_reset",
        actorUserId: "server-console",
        actorName: "server console",
        targetId: "u1",
        metadata: expect.objectContaining({ hadMfa: true, totp: true, securityKeys: 1, via: "server_console" }),
      }),
    );
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "user.reset_link_created", metadata: expect.objectContaining({ mfaReset: true }) }));
    expect(h.activity).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa.reset_by_admin", userId: "u1" }));
    expect(h.email).toHaveBeenCalledWith("admin@x", "Ada", null);
    expect(out).toContain("Two-factor sign-in was removed and all sessions ended.");
  });

  it("unknown email: exit 1, nothing created", async () => {
    const { code, out, err } = await run("--email", "nobody@x");
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(["No account uses nobody@x."]);
    expect(resetDb.tokens.size).toBe(0);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("deactivated account: exit 1, nothing created", async () => {
    resetDb.addUser({ id: "u2", email: "gone@x", isActive: false });
    const { code, err } = await run("--email", "gone@x", "--reset-mfa");
    expect(code).toBe(1);
    expect(err[0]).toBe("gone@x is deactivated. Activate it in Org admin > Members first.");
    expect(resetDb.tokens.size).toBe(0);
    expect(h.removeAll).not.toHaveBeenCalled();
  });

  it("usage errors exit 2", async () => {
    expect((await run()).code).toBe(2);
    expect((await run("--email")).code).toBe(2);
    expect((await run("--email", "a@x", "--force")).code).toBe(2);
    expect(parseResetArgs(["--help"])).toEqual({ ok: false, error: null });
  });

  it("warns when PUBLIC_URL isn't set", async () => {
    delete process.env.PUBLIC_URL;
    const { code, err } = await run("--email", "admin@x");
    expect(code).toBe(0);
    expect(err).toEqual(["PUBLIC_URL isn't set, so check the address in this link."]);
  });
});
