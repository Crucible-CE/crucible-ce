import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { deriveOrgTrack, deriveUserTrack, getReadyCard, practiceSteps, trainingDone } from "./steps";
import type { PracticeFacts } from "./practice-facts";
import { readTestPage, skippedSteps } from "./state";
import { testPageStateMessage } from "./test-page-ack";
import type { OrgSetupFacts, UserSetupFacts } from "@/lib/ops-room/setup-facts";

const NOW = new Date("2026-10-14T12:00:00Z");

const freshOrg: OrgSetupFacts = {
  orgName: "Acme",
  orgProfileFilled: false,
  otherActiveMembers: 0,
  pendingInvites: 0,
  emailTransport: null,
  sms: false,
  extras: [],
  pluginErrors: 0,
  lastDeliveryAt: null,
  lastDeliveryKind: null,
  testPageConfirmed: false,
  contacts: { total: 0, tiers: 0, withEmail: 0, emailVerified: 0, withPhone: 0, phoneVerified: 0, verifiedAny: 0, fullyVerified: 0, stale: 0 },
  responders: 1,
  respondersWithoutPhone: 1,
  signingConfigured: false,
  publicUrl: null,
  slaConfigured: false,
  membersWithoutMfa: 1,
  requireMfa: false,
};

const freshUser: UserSetupFacts = {
  name: "Ada",
  jobTitle: null,
  sms: false,
  emailTransport: null,
  phoneSaved: false,
  phoneVerified: false,
  prefsReviewed: false,
  testPage: null,
  ackedRealPage: false,
  mfaEnabled: false,
  recoveryRemaining: 0,
};

const statusOf = (t: ReturnType<typeof deriveOrgTrack>) => Object.fromEntries(t.steps.map((s) => [s.key, s.status]));

describe("deriveOrgTrack", () => {
  it("a brand-new install has nine steps, none done", () => {
    const t = deriveOrgTrack(freshOrg, new Set(), NOW);
    expect(t.steps.map((s) => s.key)).toEqual([
      "org_profile",
      "invite_team",
      "email_delivery",
      "extra_channel",
      "escalation_matrix",
      "verify_contacts",
      "incident_slas",
      "test_page",
      "signing_key",
    ]);
    expect(t).toMatchObject({ done: 0, total: 9, pct: 0, complete: false });
    expect(t.next?.key).toBe("org_profile");
  });

  it("each step completes from real data", () => {
    const t = deriveOrgTrack(
      {
        ...freshOrg,
        orgProfileFilled: true,
        pendingInvites: 1,
        emailTransport: "smtp",
        extras: [{ name: "Webhook", kind: "webhook" }],
        contacts: { ...freshOrg.contacts, total: 3, tiers: 2, verifiedAny: 1 },
        slaConfigured: true,
        testPageConfirmed: true,
        lastDeliveryAt: new Date(NOW.getTime() - 2 * 86_400_000),
        signingConfigured: true,
      },
      new Set(),
      NOW,
    );
    expect(t).toMatchObject({ done: 9, total: 9, pct: 100, complete: true, next: null });
    expect(t.steps.find((s) => s.key === "test_page")?.detail).toBe("Last delivered 2 days ago");
  });

  it("the matrix needs three contacts; verification needs one verified", () => {
    const s = statusOf(deriveOrgTrack({ ...freshOrg, contacts: { ...freshOrg.contacts, total: 2, tiers: 1, verifiedAny: 0 } }, new Set(), NOW));
    expect(s.escalation_matrix).toBe("todo");
    expect(s.verify_contacts).toBe("todo");
    const t = deriveOrgTrack({ ...freshOrg, contacts: { ...freshOrg.contacts, total: 2, tiers: 1 } }, new Set(), NOW);
    expect(t.steps.find((x) => x.key === "escalation_matrix")?.detail).toBe("2 of 3 contacts · 1 tier");
  });

  it("only optional steps can be skipped, and skipped counts as done", () => {
    const t = deriveOrgTrack(freshOrg, new Set(["extra_channel", "signing_key", "email_delivery"]), NOW);
    const s = statusOf(t);
    expect(s.extra_channel).toBe("skipped");
    expect(s.signing_key).toBe("skipped");
    expect(s.email_delivery).toBe("todo");
    expect(t.done).toBe(2);
  });
});

describe("deriveUserTrack", () => {
  it("phone step is not available without SMS and is left out of the total", () => {
    const t = deriveUserTrack(freshUser);
    expect(t.steps.find((s) => s.key === "phone")).toMatchObject({ status: "unavailable", detail: "SMS not set up" });
    expect(t.total).toBe(4);
    expect(t.done).toBe(0);
  });

  it("with SMS the phone step needs a verified number", () => {
    expect(deriveUserTrack({ ...freshUser, sms: true, phoneSaved: true }).steps[1].status).toBe("todo");
    const t = deriveUserTrack({ ...freshUser, sms: true, phoneSaved: true, phoneVerified: true });
    expect(t.steps[1].status).toBe("complete");
    expect(t.total).toBe(5);
  });

  it("profile needs name and title; prefs need a save; the test page needs an ack", () => {
    const pending = {
      id: "s1",
      seq: 0,
      sentAt: NOW.toISOString(),
      deliveredAt: NOW.toISOString(),
      channels: [],
      ackedAt: null,
      ackedVia: null,
      everAckedAt: null,
    };
    let t = deriveUserTrack({ ...freshUser, jobTitle: "SOC lead", prefsReviewed: true, emailTransport: "smtp", testPage: pending });
    expect(t.steps.map((s) => s.status)).toEqual(["complete", "unavailable", "todo", "complete", "todo"]);
    expect(t.steps[4].detail).toBe("Sent. Acknowledge it from the email or the Ops Room.");
    expect(t.steps[4].cta).toMatchObject({ label: "Send again", action: "test_page" });

    t = deriveUserTrack({ ...freshUser, jobTitle: "SOC lead", prefsReviewed: true, mfaEnabled: true, testPage: { ...pending, ackedAt: NOW.toISOString(), everAckedAt: NOW.toISOString() } });
    expect(t.complete).toBe(true);
    // Acking a real page also teaches the flow.
    expect(deriveUserTrack({ ...freshUser, ackedRealPage: true }).steps[4].status).toBe("complete");
    // A re-sent test page keeps the step done.
    expect(deriveUserTrack({ ...freshUser, testPage: { ...pending, everAckedAt: NOW.toISOString() } }).steps[4].status).toBe("complete");
  });

  it("two-factor sign-in is derived from a configured factor and links to Settings > Security", () => {
    const off = deriveUserTrack(freshUser).steps.find((s) => s.key === "two_factor");
    expect(off).toMatchObject({ status: "todo", optional: false, cta: { href: "/settings?tab=security" } });
    const on = deriveUserTrack({ ...freshUser, mfaEnabled: true }).steps.find((s) => s.key === "two_factor");
    expect(on).toMatchObject({ status: "complete", detail: "On" });
    // Not skippable: skipping is only for optional steps.
    expect(deriveUserTrack(freshUser, new Set(["two_factor"])).steps.find((s) => s.key === "two_factor")?.status).toBe("todo");
  });
});

describe("getReadyCard", () => {
  it("admins count the org track first, then their own; hidden or done shows nothing", () => {
    const org = deriveOrgTrack(freshOrg, new Set(), NOW);
    const user = deriveUserTrack(freshUser);
    expect(getReadyCard(org, user, false)).toMatchObject({ primary: { key: "org" }, secondary: { key: "user" } });
    expect(getReadyCard(org, user, true)).toBeNull();
    const doneUser = deriveUserTrack({ ...freshUser, jobTitle: "x", prefsReviewed: true, ackedRealPage: true, mfaEnabled: true });
    expect(getReadyCard(null, user, false)).toMatchObject({ primary: { key: "user" }, secondary: null });
    expect(getReadyCard(null, doneUser, false)).toBeNull();
  });
});

describe("onboarding state helpers", () => {
  it("parses test pages defensively and lists skipped steps", () => {
    expect(readTestPage("x", null)).toBeNull();
    expect(readTestPage("x", { seq: "1" })).toBeNull();
    expect(readTestPage("x", { seq: 3, sentAt: "2026-10-14T00:00:00Z" })).toMatchObject({ id: "x", seq: 3, ackedAt: null, channels: [] });
    expect([...skippedSteps(new Map<string, unknown>([["skip:signing_key", true], ["welcome_dismissed", true]]))]).toEqual(["signing_key"]);
  });

  it("a test page link only works for the latest send and only once", () => {
    const s = readTestPage("x", { seq: 2, sentAt: NOW.toISOString() })!;
    expect(testPageStateMessage(s, 2)).toBeNull();
    expect(testPageStateMessage(s, undefined)).toBeNull();
    expect(testPageStateMessage(s, 1)).toBe("A newer test page was sent. Use the latest link.");
    expect(testPageStateMessage({ ...s, ackedAt: NOW.toISOString() }, 2)).toBe("This test page has already been acknowledged.");
  });
});

describe("practice steps", () => {
  const facilitator: PracticeFacts = {
    canIncidents: true,
    canExercises: true,
    canDocuments: true,
    training: null,
    practiceSimOpenId: null,
    practiceSimEnded: false,
    localPlaybooks: 0,
    schedules: 0,
  };
  const keys = (p: PracticeFacts) => practiceSteps(p).map((s) => s.key);

  it("shows only the steps a role can complete; readers get none", () => {
    expect(keys(facilitator)).toEqual(["training_incident", "practice_sim", "ir_playbook", "first_exercise"]);
    expect(keys({ ...facilitator, canIncidents: false, canExercises: false, canDocuments: false })).toEqual([]);
    expect(keys({ ...facilitator, canExercises: false })).toEqual(["training_incident", "ir_playbook"]);
    const reader = deriveUserTrack({ ...freshUser, practice: { ...facilitator, canIncidents: false, canExercises: false, canDocuments: false } });
    expect(reader.total).toBe(4);
    const contributor = deriveUserTrack({ ...freshUser, practice: facilitator });
    expect(contributor.total).toBe(8);
    expect(contributor.steps.slice(-4).every((s) => s.status === "todo")).toBe(true);
  });

  it("training incident: starts in place, then needs opened, a task or action, and a status update", () => {
    const [none] = practiceSteps(facilitator);
    expect(none).toMatchObject({ status: "todo", cta: { action: "training_incident" }, secondary: null, detail: null });
    const t = { incidentId: "inc1", opened: true, worked: true, statusUpdate: false };
    expect(trainingDone(null)).toBe(false);
    expect(trainingDone(t)).toBe(false);
    expect(trainingDone({ ...t, opened: false, statusUpdate: true })).toBe(false);
    const [partial] = practiceSteps({ ...facilitator, training: t });
    expect(partial).toMatchObject({ status: "todo", cta: { href: "/incidents/inc1" }, secondary: { action: "training_reset" }, detail: "Opened · Task or action added" });
    const [fresh] = practiceSteps({ ...facilitator, training: { ...t, opened: false, worked: false } });
    expect(fresh.detail).toBe("Not opened yet");
    const [done] = practiceSteps({ ...facilitator, training: { ...t, statusUpdate: true } });
    expect(done.status).toBe("complete");
  });

  it("practice sim completes at ENDEX; an open run is reopened, not duplicated", () => {
    const sim = (p: Partial<PracticeFacts>) => practiceSteps({ ...facilitator, ...p }).find((s) => s.key === "practice_sim")!;
    expect(sim({})).toMatchObject({ status: "todo", cta: { action: "practice_sim", label: "Start practice sim" } });
    expect(sim({ practiceSimOpenId: "ex1" })).toMatchObject({ status: "todo", detail: "In progress", cta: { href: "/exercises/ex1" } });
    expect(sim({ practiceSimEnded: true })).toMatchObject({ status: "complete", detail: "Reached ENDEX" });
  });

  it("playbook and schedule steps complete from org data", () => {
    const step = (p: Partial<PracticeFacts>, key: string) => practiceSteps({ ...facilitator, ...p }).find((s) => s.key === key)!;
    expect(step({}, "ir_playbook")).toMatchObject({ status: "todo", cta: { href: "/documents?tab=library" } });
    expect(step({ localPlaybooks: 2 }, "ir_playbook")).toMatchObject({ status: "complete", detail: "2 playbooks" });
    expect(step({}, "first_exercise")).toMatchObject({ status: "todo", cta: { href: "/schedule" } });
    expect(step({ schedules: 1 }, "first_exercise")).toMatchObject({ status: "complete", detail: "1 exercise scheduled" });
  });

  it("copy is plain: no dashes, and no description repeats its title", () => {
    for (const s of practiceSteps(facilitator)) {
      expect(s.label + s.description).not.toMatch(/[–—]/);
      expect(s.description.toLowerCase()).not.toContain(s.label.toLowerCase());
    }
  });
});
