// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ transport: vi.fn(), send: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/db", async () => (await import("@/test/reset-db")).dbModule);
vi.mock("@/lib/email/transport", () => ({ activeEmailTransport: h.transport }));
vi.mock("@/lib/email/send-password-reset", () => ({ sendPasswordResetEmail: h.send }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: h.limit, ipFromRequest: () => "1.2.3.4" }));
vi.mock("@/lib/security/activity-log", () => ({ recordActivity: vi.fn() }));

import { resetDb } from "@/test/reset-db";
import { POST } from "./route";

const ask = async (email: string) => {
  const res = await POST(
    new Request("http://x/api/public/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  vi.clearAllMocks();
  resetDb.reset();
  process.env.PUBLIC_URL = "https://crucible.example.test";
  h.send.mockResolvedValue(undefined);
  h.limit.mockResolvedValue({ allowed: true, retryAfter: 0 });
  resetDb.addUser({ id: "u1", email: "known@x.test", name: "Kim" });
});

describe("POST /api/public/forgot-password with email configured", () => {
  beforeEach(() => h.transport.mockReturnValue("smtp"));

  it("answers the same for known and unknown addresses; only a known one gets a link", async () => {
    const known = await ask("Known@X.TEST");
    const unknown = await ask("nobody@x.test");
    expect(known).toEqual(unknown);
    expect(known).toEqual({ status: 200, body: { message: "If that email has an account, we sent a reset link." } });
    expect(resetDb.tokens.size).toBe(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith("known@x.test", "Kim", expect.stringMatching(/^https:\/\/crucible\.example\.test\/reset-password\?token=[0-9a-f]{64}$/));
  });

  it("a new request replaces the earlier link", async () => {
    await ask("known@x.test");
    await ask("known@x.test");
    expect(resetDb.tokens.size).toBe(1);
  });
});

describe("POST /api/public/forgot-password without email", () => {
  beforeEach(() => h.transport.mockReturnValue(null));

  it("says email isn't set up, the same for every address, and creates nothing", async () => {
    const known = await ask("known@x.test");
    const unknown = await ask("nobody@x.test");
    expect(known).toEqual(unknown);
    expect(known).toEqual({
      status: 200,
      body: { emailConfigured: false, message: "Email isn't set up on this server. Ask an administrator to reset your password." },
    });
    expect(JSON.stringify(known.body)).not.toMatch(/sent|on its way/);
    expect(resetDb.db.user.findUnique).not.toHaveBeenCalled();
    expect(resetDb.tokens.size).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });
});
