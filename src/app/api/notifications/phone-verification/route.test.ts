// @vitest-environment node
// Member phone verification by SMS code: hashed, 10-minute, 5-attempt,
// number-bound, single use; refused clearly when SMS isn't configured.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  configured: true,
  sms: vi.fn(),
  auth: vi.fn(),
}));
const matches = (where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => {
    if (k === "userId") return true;
    const val = h.row?.[k];
    if (v && typeof v === "object" && "lt" in (v as object)) return (val as number) < (v as { lt: number }).lt;
    return val === v;
  });
const apply = (data: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as object)) h.row![k] = (h.row![k] as number) + (v as { increment: number }).increment;
    else h.row![k] = v;
  }
};
vi.mock("@/lib/db", () => ({
  db: {
    userNotificationSetting: {
      findUnique: vi.fn(async () => h.row),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (apply(data), h.row)),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!h.row || !matches(where)) return { count: 0 };
        apply(data);
        return { count: 1 };
      }),
    },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/delivery/providers/twilio", () => ({ twilioConfigured: () => h.configured }));
vi.mock("@/lib/delivery/metered", () => ({ sendMeteredSms: h.sms }));

import { POST as send } from "./route";
import { POST as confirm } from "./confirm/route";
import { __resetDerivedKeysForTests } from "@/lib/crypto/org-crypto";

beforeAll(() => {
  process.env.MASTER_KEK = "c3".repeat(32);
  __resetDerivedKeysForTests();
});

const codeFromSms = () => /code: (\d{6})/.exec(h.sms.mock.calls.at(-1)![0].body)![1];
const submit = (code: string) =>
  confirm(new Request("http://x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.configured = true;
  h.row = { notificationPhone: "+15550001111", notificationPhoneVerifiedAt: null, phoneOtpHash: null, phoneOtpPhone: null, phoneOtpExpiresAt: null, phoneOtpAttempts: 0 };
  h.auth.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
  h.sms.mockResolvedValue({ ok: true });
});

describe("send code", () => {
  it("409 sms_not_configured without Twilio, and nothing is stored", async () => {
    h.configured = false;
    const res = await send();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "sms_not_configured", error: expect.stringContaining("SMS is not set up on this server") });
    expect(h.row!.phoneOtpHash).toBeNull();
  });

  it("texts a 6-digit code through the metered gate and stores only its hash", async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(h.sms).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org1", to: "+15550001111", purpose: "phone_otp" }));
    const code = codeFromSms();
    expect(h.row!.phoneOtpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.row!.phoneOtpHash).not.toContain(code);
    expect(h.row!.phoneOtpPhone).toBe("+15550001111");
  });
});

describe("confirm code", () => {
  it("the right code verifies the phone, once", async () => {
    await send();
    const code = codeFromSms();
    const res = await submit(code);
    expect(res.status).toBe(200);
    expect(h.row!.notificationPhoneVerifiedAt).toBeInstanceOf(Date);
    expect(h.row!.phoneOtpHash).toBeNull();
    expect((await submit(code)).status).toBe(400); // single use
  });

  it("5 wrong guesses burn the code", async () => {
    await send();
    const code = codeFromSms();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) expect((await submit(wrong)).status).toBe(400);
    expect((await submit(wrong)).status).toBe(400); // 5th: attempts exhausted, code cleared
    expect(h.row!.phoneOtpHash).toBeNull();
    expect((await submit(code)).status).toBe(400);
    expect(h.row!.notificationPhoneVerifiedAt).toBeNull();
  });

  it("an expired code, or a changed number, is refused", async () => {
    await send();
    const code = codeFromSms();
    h.row!.phoneOtpExpiresAt = new Date(Date.now() - 1000);
    expect((await submit(code)).status).toBe(400);
    await send();
    const code2 = codeFromSms();
    h.row!.notificationPhone = "+15559998888";
    expect((await submit(code2)).status).toBe(400);
    expect(h.row!.notificationPhoneVerifiedAt).toBeNull();
  });
});
