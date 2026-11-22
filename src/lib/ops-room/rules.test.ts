import { describe, expect, it } from "vitest";
import { classifyTaskDue, contactStats, myRoles, sortActive } from "./rules";
import { formatMinutes, slaHeadlineText, summarizeSla } from "./sla-headline";
import { formatAgo } from "./format";
import type { SlaStatus } from "@/lib/incident/sla";

const NOW = new Date("2026-10-14T12:00:00Z");
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe("classifyTaskDue", () => {
  it("overdue, due within 24h, later, none", () => {
    expect(classifyTaskDue(at(-1), NOW)).toBe("overdue");
    expect(classifyTaskDue(at(3), NOW)).toBe("due_soon");
    expect(classifyTaskDue(at(24), NOW)).toBe("due_soon");
    expect(classifyTaskDue(at(25), NOW)).toBeNull();
    expect(classifyTaskDue(null, NOW)).toBeNull();
  });
});

describe("myRoles", () => {
  it("orders command roles and appends assignee once", () => {
    expect(myRoles([{ role: "scribe" }, { role: "incident_commander" }], true)).toEqual(["incident_commander", "scribe", "assignee"]);
    expect(myRoles([], false)).toEqual([]);
  });
});

describe("sortActive", () => {
  it("most severe first, then newest", () => {
    const rows = [
      { id: "a", severity: "low", createdAt: at(-1) },
      { id: "b", severity: "critical", createdAt: at(-5) },
      { id: "c", severity: "critical", createdAt: at(-2) },
      { id: "d", severity: "high", createdAt: at(-1) },
    ];
    expect(sortActive(rows).map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("contactStats", () => {
  const base = { tier: 1, email: null, phone: null, emailVerifiedAt: null, phoneVerifiedAt: null, allowUnverifiedPhone: false };
  it("counts verified, fully verified and stale channels", () => {
    const old = new Date(NOW.getTime() - 100 * 86_400_000);
    const rows = [
      { ...base, email: "a@x", emailVerifiedAt: NOW },
      { ...base, tier: 2, email: "b@x", phone: "+15550001", phoneVerifiedAt: NOW },
      { ...base, tier: 2, phone: "+15550002", allowUnverifiedPhone: true },
      { ...base, tier: 3, email: "c@x", emailVerifiedAt: old },
    ];
    const noSms = contactStats(rows, { sms: false, now: NOW });
    expect(noSms).toMatchObject({ total: 4, tiers: 3, withEmail: 3, emailVerified: 2, withPhone: 2, phoneVerified: 2, verifiedAny: 3, stale: 1 });
    // Without SMS a phone-only contact is unreachable; b's email is unverified.
    expect(noSms.fullyVerified).toBe(2);
    // With SMS the phone-only contact (admin override) counts; b still needs its email.
    expect(contactStats(rows, { sms: true, now: NOW }).fullyVerified).toBe(3);
  });
});

function st(over: Partial<SlaStatus>): SlaStatus {
  return { milestone: "ack", label: "Acknowledge", targetMinutes: 15, deadline: NOW.toISOString(), completedAt: null, state: "on_track", remainingMinutes: 10, ...over };
}

describe("summarizeSla", () => {
  it("picks the most overdue breach, then at-risk, then the nearest on-track deadline", () => {
    expect(
      summarizeSla([
        st({ milestone: "contain", label: "Contain", state: "on_track", remainingMinutes: 100 }),
        st({ milestone: "ack", label: "Acknowledge", state: "breached", remainingMinutes: -5 }),
        st({ milestone: "first_update", label: "First stakeholder update", state: "breached", remainingMinutes: -40 }),
      ]),
    ).toMatchObject({ state: "breached", label: "First stakeholder update", remainingMinutes: -40 });
    expect(summarizeSla([st({ state: "on_track", remainingMinutes: 300, label: "Resolve" }), st({ state: "at_risk", remainingMinutes: 900, label: "Contain" })])).toMatchObject({
      state: "at_risk",
      label: "Contain",
    });
  });

  it("met when nothing is open but something was met; none otherwise", () => {
    expect(summarizeSla([st({ state: "met", remainingMinutes: null }), st({ state: "not_tracked", remainingMinutes: null })]).state).toBe("met");
    expect(summarizeSla([st({ state: "not_tracked", remainingMinutes: null })]).state).toBe("none");
  });

  it("formats headline text and durations", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(-192)).toBe("3h 12m");
    expect(formatMinutes(60 * 52)).toBe("2d 4h");
    const h = summarizeSla([st({ state: "on_track", remainingMinutes: 192, label: "Contain" })]);
    expect(slaHeadlineText(h)).toBe("Contain due in 3h 12m");
    expect(slaHeadlineText(h, -25)).toBe("Contain overdue 25m");
    expect(slaHeadlineText({ state: "none", label: null, deadline: null, remainingMinutes: null })).toBeNull();
  });
});

describe("formatAgo", () => {
  it("relative time", () => {
    expect(formatAgo(NOW, NOW)).toBe("just now");
    expect(formatAgo(at(-0.5), NOW)).toBe("30 min ago");
    expect(formatAgo(at(-1), NOW)).toBe("1 hour ago");
    expect(formatAgo(at(-48), NOW)).toBe("2 days ago");
  });
});
