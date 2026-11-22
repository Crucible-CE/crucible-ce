import { describe, expect, it } from "vitest";
import { channelList, evaluateReadiness, publicUrlCheck } from "./readiness";
import type { OrgSetupFacts, UserSetupFacts } from "./setup-facts";

const NOW = new Date("2026-10-14T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function org(over: Partial<OrgSetupFacts> = {}): OrgSetupFacts {
  return {
    orgName: "Acme",
    orgProfileFilled: true,
    otherActiveMembers: 4,
    pendingInvites: 0,
    emailTransport: "smtp",
    sms: false,
    extras: [{ name: "Webhook (hooks.acme.test)", kind: "webhook" }],
    pluginErrors: 0,
    lastDeliveryAt: daysAgo(2),
    lastDeliveryKind: "test",
    testPageConfirmed: true,
    contacts: { total: 18, tiers: 3, withEmail: 18, emailVerified: 18, withPhone: 10, phoneVerified: 10, verifiedAny: 18, fullyVerified: 18, stale: 0 },
    responders: 5,
    respondersWithoutPhone: 0,
    signingConfigured: true,
    publicUrl: "https://crucible.acme.test",
    slaConfigured: true,
    membersWithoutMfa: 0,
    requireMfa: true,
    ...over,
  };
}

function user(over: Partial<UserSetupFacts> = {}): UserSetupFacts {
  return {
    name: "Ada",
    jobTitle: "SOC lead",
    sms: false,
    emailTransport: "smtp",
    phoneSaved: false,
    phoneVerified: false,
    prefsReviewed: true,
    testPage: null,
    ackedRealPage: false,
    mfaEnabled: true,
    recoveryRemaining: 10,
    ...over,
  };
}

const keys = (v: ReturnType<typeof evaluateReadiness>, level?: string) =>
  v.items.filter((i) => !level || i.level === level).map((i) => i.key);

describe("evaluateReadiness (administrator)", () => {
  it("all good: collapsed one-line summary with channels, contacts and last test page", () => {
    const v = evaluateReadiness({ org: org(), user: user(), isAdmin: true, now: NOW });
    expect(v.ready).toBe(true);
    expect(v.attention).toBe(0);
    expect(v.summary).toBe("Paging ready · email, webhook · 18/18 contacts verified · last test page 2 days ago");
  });

  it("no email provider is an error and opens the panel", () => {
    const v = evaluateReadiness({ org: org({ emailTransport: null }), user: user(), isAdmin: true, now: NOW });
    expect(v.ready).toBe(false);
    expect(v.items[0]).toMatchObject({ key: "email", level: "error", fix: { href: "/org-admin/delivery" } });
    expect(v.summary).toBe("1 item needs attention");
  });

  it("SMS/voice and webhook are informational, never blocking", () => {
    const v = evaluateReadiness({ org: org({ sms: false, extras: [] }), user: user(), isAdmin: true, now: NOW });
    expect(v.ready).toBe(true);
    expect(keys(v, "info")).toEqual(expect.arrayContaining(["sms", "extras"]));
    expect(v.summary).toContain("Paging ready · email ·");
  });

  it("never delivered, or last delivery older than 30 days, warns", () => {
    const never = evaluateReadiness({ org: org({ lastDeliveryAt: null, lastDeliveryKind: null }), user: user(), isAdmin: true, now: NOW });
    expect(keys(never, "warn")).toContain("last_delivery");
    const stale = evaluateReadiness({ org: org({ lastDeliveryAt: daysAgo(45), lastDeliveryKind: "page" }), user: user(), isAdmin: true, now: NOW });
    expect(stale.items.find((i) => i.key === "last_delivery")).toMatchObject({ level: "warn", title: "Last page delivery 45 days ago" });
  });

  it("contacts: none, unverified email, stale; phones only checked with SMS configured", () => {
    const none = evaluateReadiness({ org: org({ contacts: { ...org().contacts, total: 0, withEmail: 0, emailVerified: 0 } }), user: user(), isAdmin: true, now: NOW });
    expect(keys(none, "warn")).toContain("contacts");

    const c = { total: 5, tiers: 1, withEmail: 5, emailVerified: 3, withPhone: 4, phoneVerified: 1, verifiedAny: 3, fullyVerified: 3, stale: 2 };
    const noSms = evaluateReadiness({ org: org({ contacts: c }), user: user(), isAdmin: true, now: NOW });
    expect(noSms.items.find((i) => i.key === "contact_email")?.title).toBe("2 of 5 contact emails not verified");
    expect(keys(noSms)).not.toContain("contact_phone");
    expect(noSms.items.find((i) => i.key === "contact_stale")?.title).toBe("2 contacts last verified over 90 days ago");

    const sms = evaluateReadiness({ org: org({ contacts: c, sms: true }), user: user(), isAdmin: true, now: NOW });
    expect(sms.items.find((i) => i.key === "contact_phone")).toMatchObject({ level: "warn", title: "3 of 4 contact phones not verified" });
  });

  it("members without a verified phone only matter with SMS configured", () => {
    expect(keys(evaluateReadiness({ org: org({ respondersWithoutPhone: 3 }), user: user(), isAdmin: true, now: NOW }))).not.toContain("member_phones");
    const v = evaluateReadiness({
      org: org({ sms: true, respondersWithoutPhone: 3 }),
      user: user({ sms: true, phoneVerified: true, phoneSaved: true }),
      isAdmin: true,
      now: NOW,
    });
    expect(v.items.find((i) => i.key === "member_phones")?.title).toBe("3 of 5 responders without a verified phone");
  });

  it("signing key missing warns with a link to the onboarding step; default SLAs are info", () => {
    const v = evaluateReadiness({ org: org({ signingConfigured: false, slaConfigured: false }), user: user(), isAdmin: true, now: NOW });
    expect(v.items.find((i) => i.key === "signing")).toMatchObject({ level: "warn", fix: { href: "/onboarding?tab=org#signing_key" } });
    expect(v.items.find((i) => i.key === "slas")?.level).toBe("info");
  });

  it("plugin load errors warn", () => {
    expect(keys(evaluateReadiness({ org: org({ pluginErrors: 2 }), user: user(), isAdmin: true, now: NOW }), "warn")).toContain("plugin_errors");
  });

  it("problems sort first", () => {
    const v = evaluateReadiness({ org: org({ emailTransport: null, signingConfigured: false }), user: user(), isAdmin: true, now: NOW });
    expect(v.items.slice(0, 2).map((i) => i.level)).toEqual(["error", "warn"]);
  });
});

describe("evaluateReadiness (non-administrator)", () => {
  it("sees only personal items, never server config", () => {
    const v = evaluateReadiness({ org: org({ emailTransport: null }), user: user(), isAdmin: false, now: NOW });
    expect(v.items).toEqual([]);
    expect(v.ready).toBe(true);
    expect(v.summary).toBe("Reachable by email and in the app");
  });

  it("asks to verify their phone when SMS is configured", () => {
    const v = evaluateReadiness({ org: null, user: user({ sms: true, phoneSaved: true }), isAdmin: false, now: NOW });
    expect(v.items).toEqual([expect.objectContaining({ key: "my_phone", level: "warn", title: "Verify your phone", audience: "personal" })]);
    expect(v.ready).toBe(false);
    const ok = evaluateReadiness({ org: null, user: user({ sms: true, phoneSaved: true, phoneVerified: true }), isAdmin: false, now: NOW });
    expect(ok.summary).toBe("Reachable by email, by SMS/voice and in the app");
  });
});

describe("publicUrlCheck", () => {
  it("https is ok; localhost http is info; public http, unset and garbage warn", () => {
    expect(publicUrlCheck("https://c.example.com").level).toBe("ok");
    expect(publicUrlCheck("http://localhost:3100").level).toBe("info");
    expect(publicUrlCheck("http://127.0.0.1:3000").level).toBe("info");
    expect(publicUrlCheck("http://crucible.internal:3000")).toMatchObject({ level: "warn", title: "PUBLIC_URL is http, not https" });
    expect(publicUrlCheck(null).level).toBe("warn");
    expect(publicUrlCheck("not a url").level).toBe("warn");
  });
});

describe("channelList", () => {
  it("names configured channels", () => {
    expect(
      channelList({
        emailTransport: "resend",
        sms: true,
        extras: [
          { name: "a", kind: "webhook" },
          { name: "b", kind: "webhook" },
          { name: "p", kind: "plugin" },
        ],
      }),
    ).toEqual(["email", "SMS/voice", "2 webhooks", "plugin"]);
  });
});

describe("two-factor sign-in checks", () => {
  it("admins see members without MFA (warn) and the policy state (info when off)", () => {
    const v = evaluateReadiness({ org: org({ membersWithoutMfa: 3, requireMfa: false }), user: user(), isAdmin: true, now: NOW });
    expect(v.items.find((i) => i.key === "mfa_members")).toMatchObject({ level: "warn", title: "3 members without two-factor sign-in", fix: { href: "/org-admin/members" } });
    expect(v.items.find((i) => i.key === "mfa_policy")).toMatchObject({ level: "info", title: "Two-factor sign-in not required" });
    expect(v.ready).toBe(false);
  });

  it("everyone enrolled + policy on: both ok", () => {
    const v = evaluateReadiness({ org: org(), user: user(), isAdmin: true, now: NOW });
    expect(keys(v, "ok")).toEqual(expect.arrayContaining(["mfa_members", "mfa_policy"]));
  });

  it("members never see the org MFA checks; anyone low on recovery codes gets a personal warning", () => {
    expect(keys(evaluateReadiness({ org: org({ membersWithoutMfa: 3 }), user: user(), isAdmin: false, now: NOW }))).not.toContain("mfa_members");
    const low = evaluateReadiness({ org: null, user: user({ recoveryRemaining: 2 }), isAdmin: false, now: NOW });
    expect(low.items[0]).toMatchObject({ key: "my_recovery_codes", level: "warn", title: "2 recovery codes left", fix: { href: "/settings?tab=security" } });
    expect(keys(evaluateReadiness({ org: null, user: user({ mfaEnabled: false, recoveryRemaining: 0 }), isAdmin: false, now: NOW }))).not.toContain("my_recovery_codes");
  });
});
