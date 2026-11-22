import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockResendSend } = vi.hoisted(() => ({ mockResendSend: vi.fn() }));

vi.mock("@/lib/email/resend", () => ({
  getResend: () =>
    process.env.RESEND_API_KEY ? { emails: { send: mockResendSend } } : null,
  resendConfigured: () => Boolean(process.env.RESEND_API_KEY),
  getFromEmail: () => "alerts@test.dev",
}));

import { sendEmail } from "./channels";

const ENV_KEYS = ["RESEND_API_KEY", "SMTP_HOST", "EMAIL_PROVIDER"];
const saved: Record<string, string | undefined> = {};

describe("notification channels", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    mockResendSend.mockReset();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("honest skips: no destination / unconfigured provider", async () => {
    expect(await sendEmail(null, { message: "x" })).toMatchObject({ ok: false, skipped: true, detail: "No email on file" });
    expect(await sendEmail("a@b.co", { message: "x" })).toMatchObject({ ok: false, skipped: true });
  });




  it("Email: sends via Resend and reports the provider id; error → failed", async () => {
    process.env.RESEND_API_KEY = "re_test";
    mockResendSend.mockResolvedValueOnce({ data: { id: "email-9" }, error: null });
    const ok = await sendEmail("ops@acme.co", { subject: "Alert", message: "Body", link: "https://x.test" });
    expect(ok).toMatchObject({ ok: true, detail: "email-9" });
    expect(mockResendSend.mock.calls[0][0]).toMatchObject({ to: "ops@acme.co", from: "alerts@test.dev", subject: "Alert" });

    mockResendSend.mockResolvedValueOnce({ data: null, error: { message: "domain not verified" } });
    const bad = await sendEmail("ops@acme.co", { message: "Body" });
    expect(bad).toMatchObject({ ok: false, detail: "domain not verified" });
    expect(bad.skipped).toBeUndefined();
  });
});
