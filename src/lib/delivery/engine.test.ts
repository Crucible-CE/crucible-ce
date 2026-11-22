// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DeliveryProvider, RegisteredProvider } from "./types";

// ---- in-memory PageDelivery store + db mock --------------------------------
type Row = Record<string, unknown> & {
  id: string;
  pageId: string;
  level: number;
  provider: string;
  attempt: number;
  status: string;
  nextRetryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const h = vi.hoisted(() => {
  const state = {
    rows: [] as Row[],
    seq: 0,
    page: null as Record<string, unknown> | null,
    contacts: [] as Record<string, unknown>[],
    notificationPhone: "+1 (555) 000-1111" as string | null,
    notificationPhoneVerifiedAt: new Date() as Date | null,
    memberPhoneOverride: false,
    refanEligible: false,
  };
  const uniq = (d: Record<string, unknown>) => `${d.pageId}|${d.level}|${d.provider}|${d.attempt}`;
  const matches = (r: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      const val = r[k];
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const o = v as Record<string, unknown>;
        if ("in" in o) return (o.in as unknown[]).includes(val);
        if ("gte" in o) return (val as Date) >= (o.gte as Date);
        if ("lte" in o) return val != null && (val as Date) <= (o.lte as Date);
        if ("lt" in o) return val != null && (val as Date) < (o.lt as Date);
        if ("not" in o) return val !== o.not;
        return true;
      }
      return val === v;
    });
  const db = {
    pageDelivery: {
      // skipDuplicates semantics of the real unique key (pageId, level, provider, attempt)
      createManyAndReturn: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        const out: { id: string }[] = [];
        for (const d of data) {
          if (state.rows.some((r) => uniq(r) === uniq(d))) continue;
          const now = new Date();
          const row = { id: `d${++state.seq}`, nextRetryAt: null, createdAt: now, updatedAt: now, ...d } as Row;
          state.rows.push(row);
          out.push({ id: row.id });
        }
        return out;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = state.rows.find((x) => x.id === where.id)!;
        Object.assign(r, data, { updatedAt: new Date() });
        return r;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = state.rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }));
        return { count: hit.length };
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => state.rows.filter((r) => matches(r, where))),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...state.rows.filter((r) => matches(r, where))].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null,
      ),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => state.rows.filter((r) => matches(r, where)).length),
    },
    incidentPage: {
      findUnique: vi.fn(async () => state.page),
      findMany: vi.fn(async () =>
        state.refanEligible && state.page && state.page.status === "sent"
          ? [
              {
                id: state.page.id,
                escalationLevel: state.page.escalationLevel,
                deliveries: state.rows.filter((r) => r.pageId === state.page!.id).map((r) => ({ level: r.level })),
              },
            ]
          : [],
      ),
    },
    user: {
      findFirst: vi.fn(async () => ({ id: "u1", name: "Grace", email: "grace@acme.test" })),
      findUnique: vi.fn(async () => ({ name: "Ada", email: "ada@acme.test" })),
      findMany: vi.fn(async () => [{ id: "admin1" }]),
    },
    incidentRoleAssignment: { findMany: vi.fn(async () => [{ userId: "ic1" }]) },
    userNotificationSetting: {
      findMany: vi.fn(async () => [
        {
          userId: "u1",
          notificationPhone: state.notificationPhone,
          notificationPhoneVerifiedAt: state.notificationPhoneVerifiedAt,
          allowUnverifiedPhone: state.memberPhoneOverride,
        },
      ]),
    },
    // Non-page metered sends (notify SMS, OTPs): none in these tests.
    meteredSend: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
    escalationContact: {
      findMany: vi.fn(async () => state.contacts),
      findFirst: vi.fn(async () => state.contacts[0] ?? null),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
  return { state, db, appendLedger: vi.fn(), createNotification: vi.fn(), canUserSeeIncident: vi.fn(async () => true), providers: [] as unknown[] };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/ledger/append", () => ({ appendLedger: h.appendLedger }));
vi.mock("@/lib/notifications", () => ({ createNotification: h.createNotification }));
vi.mock("@/lib/incident/access", () => ({ canUserSeeIncident: h.canUserSeeIncident }));
vi.mock("./registry", async (orig) => ({
  ...(await orig<typeof import("./registry")>()),
  allProviders: vi.fn(async () => h.providers),
}));

import {
  deliverPage,
  processDeliveryRetries,
  refanOutUndeliveredPages,
  sendAckNotice,
  sendTestDelivery,
  sweepStalePendingDeliveries,
} from "./engine";

function provider(id: string, channel: DeliveryProvider["channels"][number], send: DeliveryProvider["send"], configured = true): DeliveryProvider {
  return { id, displayName: id, channels: [channel], isConfigured: () => configured, send: vi.fn(send) };
}
const reg = (p: DeliveryProvider, addressed: boolean): RegisteredProvider => ({ provider: p, source: addressed ? "builtin" : "plugin", addressed });

const ENV = [
  "SMTP_HOST", "RESEND_API_KEY", "EMAIL_PROVIDER", "AUTH_SECRET", "NEXTAUTH_SECRET", "PUBLIC_URL",
  "DELIVERY_RATE_LIMIT_PER_RECIPIENT_HOUR", "DELIVERY_RATE_LIMIT_PER_ORG_HOUR", "DELIVERY_RATE_LIMIT_PER_NUMBER_CEILING_HOUR",
  "DELIVERY_RETRY_BACKOFF_MINUTES",
];
const saved: Record<string, string | undefined> = {};
const NOW = new Date("2026-10-14T12:00:00Z");
const PAGE_ID = "cmpage0000000000000000001";

let smtp: DeliveryProvider, sms: DeliveryProvider, voice: DeliveryProvider, hook: DeliveryProvider;

function seedSent(n: number, channel: "sms" | "voice", destination = "+15550001111") {
  for (let i = 0; i < n; i++) {
    h.state.rows.push({
      id: `old-${channel}-${destination}-${i}`, pageId: `other${i}`, level: 0, provider: `twilio-${channel}`, attempt: 1, channel, status: "sent",
      destination, organizationId: "org1", nextRetryAt: null, createdAt: new Date(Date.now() - 30 * 60_000), updatedAt: new Date(),
    });
  }
}
const incident = () => h.state.page!.incident as Record<string, unknown>;

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
  process.env.SMTP_HOST = "mail.test"; // active email transport = smtp
  process.env.AUTH_SECRET = "engine-test-secret-xxxxxxxxxxxxxxxxxxxxxxxx";
  process.env.PUBLIC_URL = "https://crucible.test";
  h.state.rows = [];
  h.state.seq = 0;
  h.state.contacts = [];
  h.state.notificationPhone = "+1 (555) 000-1111";
  h.state.notificationPhoneVerifiedAt = new Date();
  h.state.memberPhoneOverride = false;
  h.state.refanEligible = false;
  h.state.page = {
    id: PAGE_ID,
    organizationId: "org1",
    incidentId: "inc1",
    targetUserId: "u1",
    targetContactId: null,
    targetLabel: "Grace",
    message: "join the bridge",
    priority: "critical",
    status: "sent",
    escalationLevel: 0,
    createdById: "u0",
    incident: { id: "inc1", title: "Ransomware", severity: "critical", status: "investigating", restricted: false, deletedAt: null },
  };
  smtp = provider("smtp", "email", async () => ({ status: "sent", providerRef: "<m1>" }));
  sms = provider("twilio-sms", "sms", async () => ({ status: "sent", providerRef: "SM1" }));
  voice = provider("twilio-voice", "voice", async () => ({ status: "failed", error: "carrier busy" }));
  hook = provider("webhook", "webhook", async () => ({ status: "sent", providerRef: "HTTP 200" }));
  h.providers = [reg(smtp, true), reg(provider("resend", "email", async () => ({ status: "sent" }), false), true), reg(sms, true), reg(voice, true), reg(hook, false)];
  vi.clearAllMocks();
  h.canUserSeeIncident.mockResolvedValue(true);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("deliverPage fan-out", () => {
  it("sends one attempt per configured channel, records a row each, ledgers a summary", async () => {
    const { outcomes } = await deliverPage(PAGE_ID, { now: NOW });
    expect(outcomes.map((o) => `${o.provider}:${o.status}`).sort()).toEqual(["smtp:sent", "twilio-sms:sent", "twilio-voice:failed", "webhook:sent"]);
    expect(h.state.rows).toHaveLength(4);

    // Addresses: email to the account, phone normalized to E.164 (also on the row).
    expect(smtp.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "page" }), expect.objectContaining({ email: "grace@acme.test", phone: "+15550001111" }));
    expect(h.state.rows.find((r) => r.provider === "twilio-sms")!.destination).toBe("+15550001111");
    const msg = vi.mocked(smtp.send).mock.calls[0][0];
    expect(msg.title).toBe("[CRITICAL] Paged: Ransomware");
    expect(msg.text).toBe("Ada paged you to a critical incident. Note: join the bridge");
    expect(msg.ackUrl).toMatch(/^https:\/\/crucible\.test\/api\/public\/page-ack\/cmpage0000000000000000001\.0\.\d+\./);
    // Idempotency key without the attempt; attempt is its own field.
    expect(msg.id).toBe(`${PAGE_ID}:0:smtp`);
    expect(msg.attempt).toBe(1);
    expect(msg.restricted).toBe(false);

    // Failed attempt carries a retry; successes don't.
    const v = h.state.rows.find((r) => r.provider === "twilio-voice")!;
    expect(v.status).toBe("failed");
    expect(v.nextRetryAt).toBeInstanceOf(Date);
    expect(h.state.rows.find((r) => r.provider === "smtp")!.nextRetryAt).toBeNull();

    expect(h.appendLedger).toHaveBeenCalledOnce();
    const payload = h.appendLedger.mock.calls[0][1];
    expect(payload).toMatchObject({ eventType: "page_delivery", payload: { pageId: PAGE_ID } });
    // The ledger carries a coarse error category, never raw provider text.
    expect(payload.payload.deliveries.find((d: { provider: string }) => d.provider === "twilio-voice").error).toBe("delivery error");
  });

  it("records honest skips for unconfigured built-in channels; unconfigured plugins are left out", async () => {
    delete process.env.SMTP_HOST;
    h.providers = [reg(provider("twilio-sms", "sms", async () => ({ status: "sent" }), false), true), reg(provider("ntfy", "push", async () => ({ status: "sent" }), false), false)];
    const { outcomes } = await deliverPage(PAGE_ID, { now: NOW });
    expect(outcomes.map((o) => `${o.provider}:${o.channel}:${o.status}:${o.error}`).sort()).toEqual([
      "email:email:skipped:not configured",
      "twilio-sms:sms:skipped:not configured",
      "twilio-voice:voice:skipped:not configured",
    ]);
  });

  it("is idempotent on (page, level, provider, attempt): a second call sends nothing", async () => {
    await deliverPage(PAGE_ID, { now: NOW });
    const again = await deliverPage(PAGE_ID, { now: NOW });
    expect(again.outcomes.every((o) => o.status === "duplicate")).toBe(true);
    expect(smtp.send).toHaveBeenCalledOnce();
    expect(h.state.rows).toHaveLength(4);
    expect(h.appendLedger).toHaveBeenCalledOnce(); // nothing new to ledger
  });

  it("skips pages of closed or deleted incidents and pages that are no longer open", async () => {
    incident().status = "closed";
    expect(await deliverPage(PAGE_ID, { now: NOW })).toEqual({ outcomes: [], skippedReason: "incident_closed" });
    incident().status = "open";
    incident().deletedAt = new Date();
    expect((await deliverPage(PAGE_ID, { now: NOW })).skippedReason).toBe("incident_deleted");
    incident().deletedAt = null;
    h.state.page!.status = "acked";
    expect((await deliverPage(PAGE_ID, { now: NOW })).skippedReason).toBe("page_acked");
    expect(h.state.rows).toHaveLength(0);
    expect(smtp.send).not.toHaveBeenCalled();
  });

  it("escalation kind renders an escalation message", async () => {
    h.state.page!.escalationLevel = 2;
    await deliverPage(PAGE_ID, { kind: "escalation", now: NOW });
    const msg = vi.mocked(hook.send).mock.calls[0][0];
    expect(msg.kind).toBe("escalation");
    expect(msg.title).toBe("[CRITICAL] Escalated page: Ransomware");
    expect(msg.page).toEqual({ id: PAGE_ID, level: 2, priority: "critical" });
    expect(h.state.rows.every((r) => r.level === 2 && r.kind === "escalation")).toBe(true);
  });
});

describe("crash safety", () => {
  it("builds the message BEFORE inserting: a build failure is a failed row with a retry, never pending", async () => {
    delete process.env.AUTH_SECRET; // the ack link can't be signed
    const { outcomes } = await deliverPage(PAGE_ID, { now: NOW });
    const sent = outcomes.filter((o) => o.provider !== "email");
    expect(sent.every((o) => o.status === "failed" && /could not build message/.test(o.error ?? ""))).toBe(true);
    expect(h.state.rows.some((r) => r.status === "pending")).toBe(false);
    expect(h.state.rows.filter((r) => r.status === "failed").every((r) => r.nextRetryAt instanceof Date)).toBe(true);
    expect(smtp.send).not.toHaveBeenCalled();
  });

  it("a throw after the insert (result write fails) marks the row failed with a retry", async () => {
    h.db.pageDelivery.update.mockRejectedValueOnce(new Error("db blip"));
    await deliverPage(PAGE_ID, { now: NOW });
    expect(h.state.rows.some((r) => r.status === "pending")).toBe(false);
    const broken = h.state.rows.find((r) => String(r.error ?? "").startsWith("internal error"))!;
    expect(broken.status).toBe("failed");
    expect(broken.nextRetryAt).toBeInstanceOf(Date);
  });

  it("sweeps rows stuck in pending > 2 minutes to failed with a retry", async () => {
    const old = new Date(Date.now() - 3 * 60_000);
    h.state.rows.push({ id: "stuck", pageId: PAGE_ID, level: 0, provider: "twilio-sms", channel: "sms", attempt: 1, status: "pending", nextRetryAt: null, createdAt: old, updatedAt: old });
    h.state.rows.push({ id: "fresh", pageId: PAGE_ID, level: 0, provider: "smtp", channel: "email", attempt: 1, status: "pending", nextRetryAt: null, createdAt: new Date(), updatedAt: new Date() });
    expect(await sweepStalePendingDeliveries(new Date())).toBe(1);
    const stuck = h.state.rows.find((r) => r.id === "stuck")!;
    expect(stuck.status).toBe("failed");
    expect(stuck.error).toMatch(/stalled/);
    expect(stuck.nextRetryAt).toBeInstanceOf(Date);
    expect(h.state.rows.find((r) => r.id === "fresh")!.status).toBe("pending");
  });

  it("re-fans-out an open page whose current level has no delivery rows (crash before deliverPage)", async () => {
    h.state.refanEligible = true;
    h.state.page!.escalationLevel = 1;
    expect(await refanOutUndeliveredPages(NOW)).toBe(1);
    expect(h.state.rows.length).toBe(4);
    expect(h.state.rows.every((r) => r.level === 1 && r.kind === "escalation")).toBe(true);
    // Rows exist now: a second sweep does nothing.
    expect(await refanOutUndeliveredPages(NOW)).toBe(0);
    expect(smtp.send).toHaveBeenCalledOnce();
  });

  it("processDeliveryRetries runs the sweep and the re-fan-out", async () => {
    h.state.refanEligible = true;
    const r = await processDeliveryRetries(new Date());
    expect(r.refanned).toBe(1);
    expect(r.swept).toBe(0);
  });
});

describe("rate limits (toll fraud) never silently drop a page", () => {
  beforeEach(() => {
    incident().severity = "high"; // not exempt
    h.state.page!.priority = "high";
  });

  it("per-number cap, counted per channel: a skipped SMS is re-queued for the window and alerts IC + admins", async () => {
    process.env.DELIVERY_RATE_LIMIT_PER_RECIPIENT_HOUR = "2";
    seedSent(2, "sms");
    const { outcomes } = await deliverPage(PAGE_ID, { now: new Date() });
    const smsOut = outcomes.find((o) => o.provider === "twilio-sms")!;
    expect(smsOut.status).toBe("skipped");
    expect(smsOut.error).toMatch(/rate limited: 2 SMS to this number/);
    expect(sms.send).not.toHaveBeenCalled();
    // Voice is counted separately: not limited by the SMS count.
    expect(voice.send).toHaveBeenCalledOnce();
    expect(smtp.send).toHaveBeenCalledOnce(); // email is not metered

    const skipped = h.state.rows.find((r) => r.provider === "twilio-sms" && r.pageId === PAGE_ID)!;
    expect(skipped.nextRetryAt).toBeInstanceOf(Date);
    // Frees when the oldest counted send (30 min ago) leaves the hour.
    expect((skipped.nextRetryAt as Date).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);

    const alerted = h.createNotification.mock.calls.map((c) => c[0]).sort();
    expect(alerted).toEqual(["admin1", "ic1"]);
    expect(h.createNotification.mock.calls[0][1]).toBe("page_delivery_rate_limited");
  });

  it("the retry cron sends a rate-limited skip once its window frees", async () => {
    process.env.DELIVERY_RATE_LIMIT_PER_RECIPIENT_HOUR = "2";
    seedSent(2, "sms");
    await deliverPage(PAGE_ID, { now: new Date() });
    const skipped = h.state.rows.find((r) => r.provider === "twilio-sms" && r.pageId === PAGE_ID)!;
    // The window frees: the old sends age out.
    h.state.rows = h.state.rows.filter((r) => !r.id.startsWith("old-"));
    const r = await processDeliveryRetries(new Date((skipped.nextRetryAt as Date).getTime() + 1000));
    expect(r.retried).toBeGreaterThanOrEqual(1);
    expect(sms.send).toHaveBeenCalledOnce();
    expect(h.state.rows.find((x) => x.provider === "twilio-sms" && x.attempt === 2)!.status).toBe("sent");
    expect(skipped.nextRetryAt).toBeNull(); // claimed
    expect(h.createNotification).toHaveBeenCalledTimes(2); // alerted once (first skip), not again
  });

  it("escalations and critical pages are exempt from the per-number cap but not the abuse ceiling", async () => {
    process.env.DELIVERY_RATE_LIMIT_PER_RECIPIENT_HOUR = "2";
    process.env.DELIVERY_RATE_LIMIT_PER_NUMBER_CEILING_HOUR = "5";
    seedSent(3, "sms");
    incident().severity = "critical";
    await deliverPage(PAGE_ID, { now: new Date() });
    expect(sms.send).toHaveBeenCalledOnce();

    h.state.rows = [];
    vi.mocked(sms.send).mockClear();
    incident().severity = "high";
    seedSent(3, "sms");
    await deliverPage(PAGE_ID, { kind: "escalation", now: new Date() });
    expect(sms.send).toHaveBeenCalledOnce();

    h.state.rows = [];
    vi.mocked(sms.send).mockClear();
    seedSent(5, "sms");
    const { outcomes } = await deliverPage(PAGE_ID, { kind: "escalation", now: new Date() });
    expect(outcomes.find((o) => o.provider === "twilio-sms")!.error).toMatch(/abuse ceiling 5/);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it("per-org cap applies to every page", async () => {
    process.env.DELIVERY_RATE_LIMIT_PER_ORG_HOUR = "1";
    seedSent(1, "voice", "+19999999999");
    incident().severity = "critical";
    const { outcomes } = await deliverPage(PAGE_ID, { now: new Date() });
    expect(outcomes.find((o) => o.provider === "twilio-voice")!.error).toMatch(/voice calls for the organization/);
    expect(outcomes.find((o) => o.provider === "twilio-sms")!.status).toBe("sent"); // SMS counted separately
  });

  it("compares the number in E.164 regardless of how it was stored", async () => {
    process.env.DELIVERY_RATE_LIMIT_PER_RECIPIENT_HOUR = "1";
    seedSent(1, "sms", "+15550001111");
    h.state.notificationPhone = "(555) 000-1111"; // national format
    const { outcomes } = await deliverPage(PAGE_ID, { now: new Date() });
    expect(outcomes.find((o) => o.provider === "twilio-sms")!.status).toBe("skipped");
  });
});

describe("toll fraud: unverified escalation-contact phones", () => {
  const contactPage = () => {
    Object.assign(h.state.page!, { targetUserId: null, targetContactId: "ec1", targetLabel: "Vendor IR" });
  };

  it("an unverified contact gets email/webhook but SMS + voice are skipped 'phone not verified'", async () => {
    contactPage();
    h.state.contacts = [{ id: "ec1", name: "Vendor IR", email: "ir@vendor.test", phone: "+15550002222", userId: null, phoneVerifiedAt: null, allowUnverifiedPhone: false }];
    const { outcomes } = await deliverPage(PAGE_ID, { now: NOW });
    for (const p of ["twilio-sms", "twilio-voice"]) {
      const o = outcomes.find((x) => x.provider === p)!;
      expect(o).toMatchObject({ status: "skipped", error: "phone not verified" });
    }
    expect(sms.send).not.toHaveBeenCalled();
    expect(smtp.send).toHaveBeenCalledOnce();
    // Plugins/webhooks don't get the unverified number either.
    expect(vi.mocked(hook.send).mock.calls[0][1].phone).toBeNull();
  });

  it("a verified contact, or allowUnverifiedPhone, is dialed", async () => {
    contactPage();
    h.state.contacts = [{ id: "ec1", name: "Vendor IR", email: null, phone: "+15550002222", userId: null, phoneVerifiedAt: new Date(), allowUnverifiedPhone: false }];
    await deliverPage(PAGE_ID, { now: NOW });
    expect(sms.send).toHaveBeenCalledOnce();

    h.state.rows = [];
    vi.mocked(sms.send).mockClear();
    h.state.contacts = [{ id: "ec1", name: "Vendor IR", email: null, phone: "+15550002222", userId: null, phoneVerifiedAt: null, allowUnverifiedPhone: true }];
    await deliverPage(PAGE_ID, { now: NOW });
    expect(sms.send).toHaveBeenCalledOnce();
  });

  it("a member's own phone is dialed only when verified (SMS code) or admin-overridden", async () => {
    h.state.notificationPhoneVerifiedAt = null;
    h.state.contacts = [];
    const { outcomes } = await deliverPage(PAGE_ID, { now: NOW });
    expect(outcomes.find((o) => o.provider === "twilio-sms")).toMatchObject({ status: "skipped", error: "phone not verified" });
    expect(sms.send).not.toHaveBeenCalled();

    h.state.rows = [];
    h.state.memberPhoneOverride = true;
    await deliverPage(PAGE_ID, { now: NOW });
    expect(vi.mocked(sms.send).mock.calls[0][1].phone).toBe("+15550001111");
  });

  it("a member's linked-contact fallback follows the contact phone rule", async () => {
    h.state.notificationPhone = null;
    h.state.contacts = [{ userId: "u1", phone: "+15550003333", phoneVerifiedAt: null, allowUnverifiedPhone: false }];
    const { outcomes } = await deliverPage(PAGE_ID, { now: NOW });
    expect(outcomes.find((o) => o.provider === "twilio-sms")).toMatchObject({ status: "skipped", error: "phone not verified" });

    h.state.rows = [];
    h.state.contacts = [
      { userId: "u1", phone: "+15550003333", phoneVerifiedAt: null, allowUnverifiedPhone: false },
      { userId: "u1", phone: "+15550004444", phoneVerifiedAt: new Date(), allowUnverifiedPhone: false },
    ];
    await deliverPage(PAGE_ID, { now: NOW });
    expect(vi.mocked(sms.send).mock.calls[0][1].phone).toBe("+15550004444");
  });
});

describe("unreachable target (no addressed channel could be attempted)", () => {
  it("warns the pager and alerts IC + admins when email/SMS/voice were all skipped", async () => {
    Object.assign(h.state.page!, { targetUserId: null, targetContactId: "ec1", targetLabel: "Vendor IR" });
    h.state.contacts = [{ id: "ec1", name: "Vendor IR", email: null, phone: "+15550002222", userId: null, phoneVerifiedAt: null, allowUnverifiedPhone: false }];
    const res = await deliverPage(PAGE_ID, { now: NOW });
    expect(res.warning).toMatch(/No email, SMS or voice channel could reach Vendor IR/);
    expect(res.warning).toMatch(/phone not verified/);
    const types = h.createNotification.mock.calls.map((c) => c[1]);
    expect(types.filter((t) => t === "page_delivery_unreachable")).toHaveLength(2); // ic1 + admin1
  });

  it("no warning when any addressed channel was attempted", async () => {
    const res = await deliverPage(PAGE_ID, { now: NOW });
    expect(res.warning).toBeUndefined();
    expect(h.createNotification.mock.calls.map((c) => c[1])).not.toContain("page_delivery_unreachable");
  });
});

describe("locked incidents: never refused, redacted for a target who can't see it", () => {
  beforeEach(() => {
    incident().restricted = true;
  });

  it("a member the lock excludes gets severity + ack link only, on every channel", async () => {
    h.canUserSeeIncident.mockResolvedValue(false);
    const { outcomes } = await deliverPage(PAGE_ID, { now: NOW });
    expect(outcomes.filter((o) => o.status === "sent").length).toBeGreaterThan(0); // still delivered
    expect(h.canUserSeeIncident).toHaveBeenCalledWith("u1", "inc1");
    for (const p of [smtp, sms, voice, hook]) {
      const msg = vi.mocked(p.send).mock.calls[0][0];
      expect(msg.restricted).toBe(true);
      expect(JSON.stringify(msg)).not.toContain("Ransomware");
      expect(JSON.stringify(msg)).not.toContain("join the bridge");
      expect(msg.incident).toEqual({ id: "", title: "Restricted incident", severity: "critical", url: "" });
      expect(msg.text).toBe("Crucible: you are paged for a restricted incident (severity critical).");
      expect(msg.ackUrl).toMatch(/page-ack/);
    }
  });

  it("a participant / IC / admin (can see it) gets the full page", async () => {
    h.canUserSeeIncident.mockResolvedValue(true);
    await deliverPage(PAGE_ID, { now: NOW });
    expect(vi.mocked(smtp.send).mock.calls[0][0].title).toBe("[CRITICAL] Paged: Ransomware");
  });

  it("an external contact with no linked account is always redacted", async () => {
    Object.assign(h.state.page!, { targetUserId: null, targetContactId: "ec1" });
    h.state.contacts = [{ id: "ec1", name: "Vendor IR", email: "ir@vendor.test", phone: null, userId: null, phoneVerifiedAt: null }];
    await deliverPage(PAGE_ID, { now: NOW });
    expect(vi.mocked(hook.send).mock.calls[0][0].restricted).toBe(true);
  });

  it("the ack notice for a locked incident never carries the title", async () => {
    await sendAckNotice(PAGE_ID, "link", NOW);
    const msg = vi.mocked(hook.send).mock.calls[0][0];
    expect(msg.kind).toBe("ack");
    expect(msg.restricted).toBe(true);
    expect(JSON.stringify(msg)).not.toContain("Ransomware");
  });
});

describe("processDeliveryRetries (backoff)", () => {
  it("retries a due failure as attempt 2 after 1m, then 5m, 15m, then gives up", async () => {
    await deliverPage(PAGE_ID, { now: NOW });
    const first = h.state.rows.find((r) => r.provider === "twilio-voice")!;
    const due1 = first.nextRetryAt as Date;
    expect(due1.getTime() - Date.now()).toBeGreaterThan(50_000); // ~1 minute out

    // Not due yet -> nothing.
    expect(await processDeliveryRetries(new Date(due1.getTime() - 1000))).toMatchObject({ retried: 0, abandoned: 0 });

    let at = due1;
    for (const attempt of [2, 3, 4]) {
      const r = await processDeliveryRetries(new Date(at.getTime() + 1000));
      expect(r.retried).toBe(1);
      const row = h.state.rows.find((x) => x.provider === "twilio-voice" && x.attempt === attempt)!;
      expect(row.status).toBe("failed");
      if (attempt < 4) {
        expect(row.nextRetryAt).toBeInstanceOf(Date);
        at = row.nextRetryAt as Date;
      } else {
        expect(row.nextRetryAt).toBeNull(); // backoff exhausted: 4 attempts total
      }
    }
    expect(voice.send).toHaveBeenCalledTimes(4);
    // Same idempotency key on every attempt; the attempt number differs.
    const ids = vi.mocked(voice.send).mock.calls.map((c) => `${c[0].id}#${c[0].attempt}`);
    expect(ids).toEqual([2, 3, 4].reduce((a, n) => [...a, `${PAGE_ID}:0:twilio-voice#${n}`], [`${PAGE_ID}:0:twilio-voice#1`]));
    // The claimed rows no longer carry a retry.
    expect(h.state.rows.filter((r) => r.provider === "twilio-voice" && r.nextRetryAt !== null)).toHaveLength(0);
  });

  it("abandons (and clears) retries once the page is acked / escalated / closed", async () => {
    await deliverPage(PAGE_ID, { now: NOW });
    h.state.page!.status = "acked";
    const r = await processDeliveryRetries(new Date(Date.now() + 2 * 60_000));
    expect(r).toMatchObject({ retried: 0, abandoned: 1 });
    expect(voice.send).toHaveBeenCalledOnce();
    expect(h.state.rows.find((x) => x.provider === "twilio-voice")!.nextRetryAt).toBeNull();
  });

  it("never loses an attempt: the next attempt is inserted BEFORE the old row is cleared", async () => {
    await deliverPage(PAGE_ID, { now: NOW });
    const first = h.state.rows.find((r) => r.provider === "twilio-voice")!;
    // Crash right after the next attempt is inserted: the clear fails.
    h.db.pageDelivery.updateMany.mockRejectedValueOnce(new Error("crash"));
    const due = new Date((first.nextRetryAt as Date).getTime() + 1000);
    await processDeliveryRetries(due);
    expect(h.state.rows.some((r) => r.provider === "twilio-voice" && r.attempt === 2)).toBe(true);
    expect(first.nextRetryAt).toBeInstanceOf(Date); // still due: nothing lost
    // Next run: the insert is a duplicate (no second send), and the old row is cleared.
    await processDeliveryRetries(due);
    expect(voice.send).toHaveBeenCalledTimes(2);
    expect(first.nextRetryAt).toBeNull();
  });

  it("a concurrent worker whose next-attempt insert is a duplicate sends nothing", async () => {
    await deliverPage(PAGE_ID, { now: NOW });
    const first = h.state.rows.find((r) => r.provider === "twilio-voice")!;
    // Another worker already inserted attempt 2.
    h.state.rows.push({ ...first, id: "racer", attempt: 2, status: "pending", nextRetryAt: null });
    const r = await processDeliveryRetries(new Date((first.nextRetryAt as Date).getTime() + 1000));
    expect(r.retried).toBe(0);
    expect(voice.send).toHaveBeenCalledOnce();
  });
});

describe("sendTestDelivery", () => {
  it("sends through one configured provider without recording rows", async () => {
    const r = await sendTestDelivery("webhook", { name: "Admin", email: "a@acme.test" });
    expect(r).toEqual({ status: "sent", providerRef: "HTTP 200", error: undefined });
    expect(vi.mocked(hook.send).mock.calls[0][0].kind).toBe("test");
    expect(h.state.rows).toHaveLength(0);
    expect(await sendTestDelivery("resend", { name: "Admin" })).toEqual({ status: "skipped", error: "not configured" });
    expect(await sendTestDelivery("nope", { name: "Admin" })).toEqual({ status: "failed", error: "unknown provider" });
  });
});
