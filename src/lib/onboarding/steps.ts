// Onboarding: the two tracks (Organization setup for
// administrators, Your setup for everyone), tailored to what Crucible CE
// actually has. Completion is DERIVED from real data (lib/ops-room/setup-facts);
// only optional steps can be skipped. Pure: no I/O, unit-tested.

import type { OrgSetupFacts, UserSetupFacts } from "@/lib/ops-room/setup-facts";
import { formatAgo } from "@/lib/ops-room/format";
import type { PracticeFacts, TrainingFacts } from "./practice-facts";

export type StepStatus = "complete" | "skipped" | "todo" | "unavailable";

export type StepAction = "test_page" | "training_incident" | "training_reset" | "practice_sim";

export interface StepView {
  key: string;
  label: string;
  description: string;
  /** Lucide icon name, resolved in the UI. */
  icon: string;
  optional: boolean;
  status: StepStatus;
  /** Short live detail ("2 of 3 contacts"), or why a step is unavailable. */
  detail: string | null;
  /** Primary call to action: a link, or an in-place action. */
  cta: { label: string; href?: string; action?: StepAction } | null;
  /** Secondary in-place action (e.g. "Send me a test page"). */
  secondary?: { label: string; action: StepAction } | null;
}

export interface TrackView {
  key: "org" | "user";
  steps: StepView[];
  /** Complete + skipped. */
  done: number;
  /** Steps that apply on this server (unavailable ones are left out). */
  total: number;
  pct: number;
  complete: boolean;
  /** First step still to do. */
  next: StepView | null;
}

/** Optional steps (the only ones that can be skipped). */
export const OPTIONAL_ORG_STEPS = new Set<string>(["extra_channel", "signing_key"]);

/** Escalation matrix target: at least this many active contacts. */
export const MATRIX_MIN_CONTACTS = 3;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function status(done: boolean, optional: boolean, skipped: Set<string>, key: string): StepStatus {
  if (done) return "complete";
  if (optional && skipped.has(key)) return "skipped";
  return "todo";
}

export function summarizeTrack(key: "org" | "user", steps: StepView[]): TrackView {
  const applicable = steps.filter((s) => s.status !== "unavailable");
  const done = applicable.filter((s) => s.status === "complete" || s.status === "skipped").length;
  const total = applicable.length;
  return {
    key,
    steps,
    done,
    total,
    pct: total === 0 ? 100 : Math.round((done / total) * 100),
    complete: done === total,
    next: applicable.find((s) => s.status === "todo") ?? null,
  };
}

export function deriveOrgTrack(f: OrgSetupFacts, skipped: Set<string> = new Set(), now: Date = new Date()): TrackView {
  const c = f.contacts;
  const channelNames = [f.sms ? "SMS/voice (Twilio)" : null, ...f.extras.map((e) => e.name)].filter(Boolean).join(", ");
  const steps: StepView[] = [
    {
      key: "org_profile",
      label: "Complete your organization profile",
      description: "Name, size, technology and critical assets.",
      icon: "Building2",
      optional: false,
      status: status(f.orgProfileFilled, false, skipped, "org_profile"),
      detail: f.orgName || null,
      cta: { label: "Open organization profile", href: "/org-profile" },
    },
    {
      key: "invite_team",
      label: "Invite your team",
      description: "Contributors can edit. Readers can view.",
      icon: "UserPlus",
      optional: false,
      status: status(f.otherActiveMembers > 0 || f.pendingInvites > 0, false, skipped, "invite_team"),
      detail:
        f.otherActiveMembers > 0 || f.pendingInvites > 0
          ? [f.otherActiveMembers > 0 ? plural(f.otherActiveMembers, "other member") : null, f.pendingInvites > 0 ? plural(f.pendingInvites, "pending invite") : null]
              .filter(Boolean)
              .join(" · ")
          : "Only you",
      cta: { label: "Invite members", href: "/org-admin/members" },
    },
    {
      key: "email_delivery",
      label: "Set up email",
      description: "Set SMTP_HOST or RESEND_API_KEY on the server and restart.",
      icon: "Mail",
      optional: false,
      status: status(!!f.emailTransport, false, skipped, "email_delivery"),
      detail: f.emailTransport ? `Email via ${f.emailTransport === "smtp" ? "SMTP" : "Resend"}` : "No email set up",
      cta: { label: "Open Delivery settings", href: "/org-admin/delivery" },
    },
    {
      key: "extra_channel",
      label: "Add another channel",
      description: "Add SMS, voice or a webhook.",
      icon: "RadioTower",
      optional: true,
      status: status(f.sms || f.extras.length > 0, true, skipped, "extra_channel"),
      detail: channelNames || "Email only",
      cta: { label: "Open Delivery settings", href: "/org-admin/delivery" },
    },
    {
      key: "escalation_matrix",
      label: "Build the escalation matrix",
      description: `Add at least ${MATRIX_MIN_CONTACTS} contacts.`,
      icon: "Phone",
      optional: false,
      status: status(c.total >= MATRIX_MIN_CONTACTS && c.tiers >= 1, false, skipped, "escalation_matrix"),
      detail: `${c.total} of ${MATRIX_MIN_CONTACTS} contacts${c.total > 0 ? ` · ${plural(c.tiers, "tier")}` : ""}`,
      cta: { label: "Open escalation matrix", href: "/escalation-matrix" },
    },
    {
      key: "verify_contacts",
      label: "Verify your contacts",
      description: "Ask each contact to confirm their email and phone.",
      icon: "BadgeCheck",
      optional: false,
      status: status(c.verifiedAny >= 1, false, skipped, "verify_contacts"),
      detail: c.total > 0 ? `${c.verifiedAny} of ${c.total} verified` : "Add contacts first",
      cta: { label: "Send verification", href: "/escalation-matrix" },
    },
    {
      key: "incident_slas",
      label: "Set response SLAs",
      description: "Set target times for each severity.",
      icon: "Timer",
      optional: false,
      status: status(f.slaConfigured, false, skipped, "incident_slas"),
      detail: f.slaConfigured ? "Targets saved" : "Using defaults",
      cta: { label: "Review SLAs", href: "/org-admin/incident-slas" },
    },
    {
      key: "test_page",
      label: "Send a test page",
      description: "From Delivery settings, or to yourself.",
      icon: "Send",
      optional: false,
      status: status(f.testPageConfirmed, false, skipped, "test_page"),
      detail: f.lastDeliveryAt ? `Last delivered ${formatAgo(f.lastDeliveryAt, now)}` : "Not sent yet",
      cta: { label: "Open Delivery settings", href: "/org-admin/delivery" },
      secondary: { label: "Send me a test page", action: "test_page" },
    },
    {
      key: "signing_key",
      label: "Set the case-file signing key",
      description: "Set EXPORT_SIGNING_PRIVATE_KEY (Ed25519) and restart. Case-file exports need it.",
      icon: "KeyRound",
      optional: true,
      status: status(f.signingConfigured, true, skipped, "signing_key"),
      detail: f.signingConfigured ? "Signing key set" : "Not set. Case-file exports are off.",
      cta: null,
    },
  ];
  return summarizeTrack("org", steps);
}

export function deriveUserTrack(f: UserSetupFacts, skipped: Set<string> = new Set()): TrackView {
  const tp = f.testPage;
  const testDone = !!tp?.everAckedAt || f.ackedRealPage;
  const pending = !!tp && !tp.ackedAt;
  const steps: StepView[] = [
    {
      key: "profile",
      label: "Complete your profile",
      description: "Add your name and job title.",
      icon: "UserCog",
      optional: false,
      status: status(!!f.name?.trim() && !!f.jobTitle?.trim(), false, skipped, "profile"),
      detail: [f.name?.trim() || null, f.jobTitle?.trim() || null].filter(Boolean).join(" · ") || null,
      cta: { label: "Edit profile", href: "/settings" },
    },
    f.sms
      ? {
          key: "phone",
          label: "Add and verify your phone",
          description: "Add your mobile number and enter the code we text you.",
          icon: "Smartphone",
          optional: false,
          status: status(f.phoneVerified, false, skipped, "phone"),
          detail: f.phoneVerified ? "Verified" : f.phoneSaved ? "Not verified" : "No phone",
          cta: { label: "Verify phone", href: "/settings/notifications" },
        }
      : {
          key: "phone",
          label: "Add and verify your phone",
          description: "SMS is not set up on this server.",
          icon: "Smartphone",
          optional: false,
          status: "unavailable",
          detail: "SMS not set up",
          cta: null,
        },
    {
      key: "two_factor",
      label: "Turn on two-factor sign-in",
      description: "Require a code or security key after your password.",
      icon: "ShieldCheck",
      optional: false,
      status: status(f.mfaEnabled, false, skipped, "two_factor"),
      detail: f.mfaEnabled ? "On" : null,
      cta: { label: f.mfaEnabled ? "Manage" : "Set up two-factor", href: "/settings?tab=security" },
    },
    {
      key: "notification_prefs",
      label: "Review notification preferences",
      description: "Choose what reaches you and where. Set quiet hours.",
      icon: "Bell",
      optional: false,
      status: status(f.prefsReviewed, false, skipped, "notification_prefs"),
      detail: f.prefsReviewed ? "Preferences saved" : null,
      cta: { label: "Open preferences", href: "/settings/notifications" },
    },
    {
      key: "ack_test_page",
      label: "Acknowledge a test page",
      description: "Acknowledge it from the email or the Ops Room.",
      icon: "BellRing",
      optional: false,
      status: status(testDone, false, skipped, "ack_test_page"),
      detail: testDone
        ? "Acknowledged"
        : pending
          ? f.emailTransport || f.sms
            ? "Sent. Acknowledge it from the email or the Ops Room."
            : "Sent. Acknowledge it in the Ops Room."
          : null,
      cta: { label: pending ? "Send again" : "Send me a test page", action: "test_page" },
    },
    ...(f.practice ? practiceSteps(f.practice, skipped) : []),
  ];
  return summarizeTrack("user", steps);
}

/**
 * The practice steps of Your setup, each only for a role that can complete it
 * (readers get none): a training incident, the practice Crisis Sim, the
 * organization's IR playbook and its first scheduled exercise.
 */
/** The training step is done when the member opened it, added a task or action, and posted a status update. */
export function trainingDone(t: TrainingFacts | null): boolean {
  return !!t && t.opened && t.worked && t.statusUpdate;
}

export function practiceSteps(p: PracticeFacts, skipped: Set<string> = new Set()): StepView[] {
  const steps: StepView[] = [];
  if (p.canIncidents) {
    const t = p.training;
    const parts = t ? [t.opened && "Opened", t.worked && "Task or action added", t.statusUpdate && "Status update posted"].filter(Boolean) : [];
    steps.push({
      key: "training_incident",
      label: "Run a training incident",
      description: "Add a task or action and post a status update in a sandbox that reaches no one.",
      icon: "GraduationCap",
      optional: false,
      status: status(trainingDone(t), false, skipped, "training_incident"),
      detail: t ? (parts.length ? parts.join(" · ") : "Not opened yet") : null,
      cta: t ? { label: "Open training incident", href: `/incidents/${t.incidentId}` } : { label: "Start training incident", action: "training_incident" },
      secondary: t ? { label: "Reset", action: "training_reset" } : null,
    });
  }
  if (p.canExercises) {
    steps.push({
      key: "practice_sim",
      label: "Run the practice Crisis Sim",
      description: "Play the short solo sim through to ENDEX.",
      icon: "Swords",
      optional: false,
      status: status(p.practiceSimEnded, false, skipped, "practice_sim"),
      detail: p.practiceSimEnded ? "Reached ENDEX" : p.practiceSimOpenId ? "In progress" : null,
      cta: p.practiceSimOpenId
        ? { label: "Open practice sim", href: `/exercises/${p.practiceSimOpenId}` }
        : { label: p.practiceSimEnded ? "Run it again" : "Start practice sim", action: "practice_sim" },
    });
  }
  if (p.canDocuments) {
    steps.push({
      key: "ir_playbook",
      label: "Add your IR playbook",
      description: "Upload or paste yours, or duplicate one from the library.",
      icon: "BookOpen",
      optional: false,
      status: status(p.localPlaybooks > 0, false, skipped, "ir_playbook"),
      detail: p.localPlaybooks > 0 ? plural(p.localPlaybooks, "playbook") : null,
      cta: { label: "Open the library", href: "/documents?tab=library" },
    });
  }
  if (p.canExercises) {
    steps.push({
      key: "first_exercise",
      label: "Schedule your first exercise",
      description: "Pick a date and a format for the team.",
      icon: "CalendarClock",
      optional: false,
      status: status(p.schedules > 0, false, skipped, "first_exercise"),
      detail: p.schedules > 0 ? plural(p.schedules, "exercise") + " scheduled" : null,
      cta: { label: "Open schedule", href: "/schedule" },
    });
  }
  return steps;
}

export interface GetReadyCard {
  /** The track the card counts ("Onboarding · 3 of 9 done"). */
  primary: TrackView;
  /** Administrators: their personal track, shown as a side note. */
  secondary: TrackView | null;
}

/**
 * The compact Ops Room card, or null when there is nothing left to do or the
 * member hid it. Administrators count Organization setup until it is done,
 * then Your setup; everyone else counts Your setup.
 */
export function getReadyCard(org: TrackView | null, user: TrackView, hidden: boolean): GetReadyCard | null {
  if (hidden) return null;
  if (org && !org.complete) return { primary: org, secondary: user };
  if (!user.complete) return { primary: user, secondary: null };
  return null;
}
