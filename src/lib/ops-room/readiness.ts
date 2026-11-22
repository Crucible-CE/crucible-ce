// Ops Room "Readiness": paging and setup health for THIS server, as a list of
// checks with a fix link each. Not a score: every item is a concrete thing
// that would make a page fail to reach someone (or a case file fail to sign).
//
// Pure decision functions over the facts from lib/ops-room/setup-facts
// (unit-tested). Administrators get the server/org checks plus their own;
// everyone else gets only their personal items.

import type { OrgSetupFacts, UserSetupFacts } from "./setup-facts";
import { CONTACT_VERIFY_STALE_DAYS } from "@/lib/escalation/contact-fields";
import { daysBetween, formatAgo } from "./format";

export type ReadinessLevel = "ok" | "info" | "warn" | "error";

export interface ReadinessItem {
  key: string;
  level: ReadinessLevel;
  title: string;
  detail: string | null;
  fix: { label: string; href: string } | null;
  audience: "admin" | "personal";
}

export interface ReadinessView {
  items: ReadinessItem[];
  /** Items at warn/error level. */
  attention: number;
  /** No warn/error item: the panel collapses to its one-line summary. */
  ready: boolean;
  /** The collapsed one-liner. */
  summary: string;
}

/** A configured delivery older than this is worth re-testing. */
export const DELIVERY_STALE_DAYS = 30;

const DELIVERY_FIX = { label: "Delivery settings", href: "/org-admin/delivery" };
const MATRIX_FIX = { label: "Escalation matrix", href: "/escalation-matrix" };

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\./.test(h);
}

/** PUBLIC_URL check: unset / http on a real host / unparseable are problems. */
export function publicUrlCheck(url: string | null): Pick<ReadinessItem, "level" | "title" | "detail"> {
  if (!url) {
    return {
      level: "warn",
      title: "PUBLIC_URL is not set",
      detail: "Set PUBLIC_URL to the address people open and restart.",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { level: "warn", title: "PUBLIC_URL is not a valid URL", detail: `Couldn't read "${url}". Set PUBLIC_URL to a full https URL.` };
  }
  if (parsed.protocol === "https:") return { level: "ok", title: `PUBLIC_URL is https (${parsed.host})`, detail: null };
  if (isLocalHost(parsed.hostname)) {
    return { level: "info", title: `PUBLIC_URL is ${parsed.origin}`, detail: "OK for testing. Set a public https URL for phones and Twilio." };
  }
  return {
    level: "warn",
    title: "PUBLIC_URL is http, not https",
    detail: "Put Crucible behind TLS and set an https PUBLIC_URL. See docs/reverse-proxy.md.",
  };
}

/** "email, SMS/voice, webhook" for the summary line. */
export function channelList(f: Pick<OrgSetupFacts, "emailTransport" | "sms" | "extras">): string[] {
  const out: string[] = [];
  if (f.emailTransport) out.push("email");
  if (f.sms) out.push("SMS/voice");
  const webhooks = f.extras.filter((e) => e.kind === "webhook").length;
  const plugins = f.extras.filter((e) => e.kind === "plugin").length;
  if (webhooks) out.push(webhooks === 1 ? "webhook" : `${webhooks} webhooks`);
  if (plugins) out.push(plugins === 1 ? "plugin" : `${plugins} plugins`);
  return out;
}

/** Warn about recovery codes at or below this many. */
const RECOVERY_LOW = 2;
const SECURITY_FIX = { label: "Security settings", href: "/settings?tab=security" };

function personalItems(u: UserSetupFacts): ReadinessItem[] {
  const out: ReadinessItem[] = [];
  if (u.mfaEnabled && u.recoveryRemaining <= RECOVERY_LOW) {
    out.push({
      key: "my_recovery_codes",
      level: "warn",
      title: u.recoveryRemaining === 0 ? "No recovery codes left" : `${u.recoveryRemaining} recovery code${u.recoveryRemaining === 1 ? "" : "s"} left`,
      detail: "Generate new recovery codes.",
      fix: SECURITY_FIX,
      audience: "personal",
    });
  }
  if (!u.sms || u.phoneVerified) return out;
  return [
    ...out,
    {
      key: "my_phone",
      level: "warn",
      title: u.phoneSaved ? "Verify your phone" : "Add your phone",
      detail: u.phoneSaved
        ? "SMS and voice pages skip unverified numbers."
        : "Add a mobile number for SMS and voice pages.",
      fix: { label: "Notification settings", href: "/settings/notifications" },
      audience: "personal",
    },
  ];
}

function adminItems(f: OrgSetupFacts, now: Date): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const c = f.contacts;

  items.push(
    f.emailTransport
      ? { key: "email", level: "ok", title: `Email via ${f.emailTransport === "smtp" ? "SMTP" : "Resend"}`, detail: null, fix: null, audience: "admin" }
      : {
          key: "email",
          level: "error",
          title: "No email set up",
          detail: "Set SMTP_HOST or RESEND_API_KEY and restart.",
          fix: DELIVERY_FIX,
          audience: "admin",
        },
  );

  items.push(
    f.sms
      ? { key: "sms", level: "ok", title: "SMS and voice via Twilio", detail: null, fix: null, audience: "admin" }
      : {
          key: "sms",
          level: "info",
          title: "No SMS or voice",
          detail: "Optional. Add a Twilio account.",
          fix: DELIVERY_FIX,
          audience: "admin",
        },
  );

  const extraNames = f.extras.map((e) => e.name).join(", ");
  items.push({
    key: "extras",
    level: "info",
    title: f.extras.length ? `Also sends to ${extraNames}` : "No webhook or plugin",
    detail: f.extras.length ? null : "Optional.",
    fix: f.extras.length ? null : DELIVERY_FIX,
    audience: "admin",
  });
  if (f.pluginErrors > 0) {
    items.push({
      key: "plugin_errors",
      level: "warn",
      title: `${f.pluginErrors === 1 ? "A delivery plugin" : `${f.pluginErrors} delivery plugins`} failed to load`,
      detail: "See Delivery settings for the error.",
      fix: DELIVERY_FIX,
      audience: "admin",
    });
  }

  if (!f.lastDeliveryAt) {
    items.push({
      key: "last_delivery",
      level: "warn",
      title: "No page sent yet",
      detail: "Send a test page.",
      fix: { label: "Send a test", href: "/org-admin/delivery" },
      audience: "admin",
    });
  } else {
    const days = daysBetween(f.lastDeliveryAt, now);
    const what = f.lastDeliveryKind === "page" ? "page delivery" : "test page";
    items.push(
      days > DELIVERY_STALE_DAYS
        ? {
            key: "last_delivery",
            level: "warn",
            title: `Last ${what} ${formatAgo(f.lastDeliveryAt, now)}`,
            detail: "Send a new test page.",
            fix: { label: "Send a test", href: "/org-admin/delivery" },
            audience: "admin",
          }
        : { key: "last_delivery", level: "ok", title: `Last ${what} ${formatAgo(f.lastDeliveryAt, now)}`, detail: null, fix: null, audience: "admin" },
    );
  }

  if (c.total === 0) {
    items.push({
      key: "contacts",
      level: "warn",
      title: "No escalation contacts",
      detail: "Add contacts to the escalation matrix.",
      fix: MATRIX_FIX,
      audience: "admin",
    });
  } else {
    const unverifiedEmail = c.withEmail - c.emailVerified;
    items.push(
      unverifiedEmail > 0
        ? {
            key: "contact_email",
            level: "warn",
            title: `${unverifiedEmail} of ${c.withEmail} contact email${c.withEmail === 1 ? "" : "s"} not verified`,
            detail: "Ask contacts to verify.",
            fix: { label: "Verify contacts", href: "/escalation-matrix" },
            audience: "admin",
          }
        : { key: "contact_email", level: "ok", title: `Contact emails verified (${c.emailVerified}/${c.withEmail})`, detail: null, fix: null, audience: "admin" },
    );
    if (f.sms) {
      const unverifiedPhone = c.withPhone - c.phoneVerified;
      items.push(
        unverifiedPhone > 0
          ? {
              key: "contact_phone",
              level: "warn",
              title: `${unverifiedPhone} of ${c.withPhone} contact phone${c.withPhone === 1 ? "" : "s"} not verified`,
              detail: "SMS and voice pages skip unverified numbers.",
              fix: { label: "Verify contacts", href: "/escalation-matrix" },
              audience: "admin",
            }
          : { key: "contact_phone", level: "ok", title: `Contact phones verified (${c.phoneVerified}/${c.withPhone})`, detail: null, fix: null, audience: "admin" },
      );
    }
    if (c.stale > 0) {
      items.push({
        key: "contact_stale",
        level: "warn",
        title: `${c.stale} contact${c.stale === 1 ? "" : "s"} last verified over ${CONTACT_VERIFY_STALE_DAYS} days ago`,
        detail: "Ask them to verify again.",
        fix: { label: "Re-verify", href: "/escalation-matrix" },
        audience: "admin",
      });
    }
  }

  if (f.sms && f.respondersWithoutPhone > 0) {
    items.push({
      key: "member_phones",
      level: "warn",
      title: `${f.respondersWithoutPhone} of ${f.responders} responders without a verified phone`,
      detail: "They get no SMS or voice pages.",
      fix: { label: "Members", href: "/org-admin/members" },
      audience: "admin",
    });
  }

  items.push(
    f.signingConfigured
      ? { key: "signing", level: "ok", title: "Case-file signing key set", detail: null, fix: null, audience: "admin" }
      : {
          key: "signing",
          level: "warn",
          title: "Case-file signing key not set",
          detail: "Set EXPORT_SIGNING_PRIVATE_KEY to turn on signed exports.",
          fix: { label: "How to set it", href: "/onboarding?tab=org#signing_key" },
          audience: "admin",
        },
  );

  // Two-factor sign-in across the org.
  items.push(
    f.membersWithoutMfa > 0
      ? {
          key: "mfa_members",
          level: "warn",
          title: `${f.membersWithoutMfa} member${f.membersWithoutMfa === 1 ? "" : "s"} without two-factor sign-in`,
          detail: f.requireMfa
            ? "They must set it up at next sign-in."
            : "Ask them to turn it on, or require it.",
          fix: { label: "Members", href: "/org-admin/members" },
          audience: "admin",
        }
      : { key: "mfa_members", level: "ok", title: "All members use two-factor sign-in", detail: null, fix: null, audience: "admin" },
  );
  items.push(
    f.requireMfa
      ? { key: "mfa_policy", level: "ok", title: "Two-factor sign-in required", detail: null, fix: null, audience: "admin" }
      : {
          key: "mfa_policy",
          level: "info",
          title: "Two-factor sign-in not required",
          detail: "Optional for members now.",
          fix: { label: "Sign-in security", href: "/org-admin/members#security-policy" },
          audience: "admin",
        },
  );

  const pu = publicUrlCheck(f.publicUrl);
  items.push({ key: "public_url", ...pu, fix: null, audience: "admin" });

  items.push(
    f.slaConfigured
      ? { key: "slas", level: "ok", title: "Response SLAs set", detail: null, fix: null, audience: "admin" }
      : {
          key: "slas",
          level: "info",
          title: "Response SLAs use defaults",
          detail: "Review the targets.",
          fix: { label: "Response SLAs", href: "/org-admin/incident-slas" },
          audience: "admin",
        },
  );
  return items;
}

const LEVEL_ORDER: Record<ReadinessLevel, number> = { error: 0, warn: 1, info: 2, ok: 3 };

export function evaluateReadiness(input: { org: OrgSetupFacts | null; user: UserSetupFacts; isAdmin: boolean; now?: Date }): ReadinessView {
  const now = input.now ?? new Date();
  const items = [...personalItems(input.user), ...(input.isAdmin && input.org ? adminItems(input.org, now) : [])];
  // Stable sort: problems first, the rest keep their order.
  items.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const attention = items.filter((i) => i.level === "warn" || i.level === "error").length;
  const ready = attention === 0;

  let summary: string;
  if (!ready) {
    summary = `${attention} item${attention === 1 ? " needs" : "s need"} attention`;
  } else if (input.isAdmin && input.org) {
    const f = input.org;
    const parts = ["Paging ready", channelList(f).join(", ")];
    if (f.contacts.total > 0) parts.push(`${f.contacts.fullyVerified}/${f.contacts.total} contacts verified`);
    if (f.lastDeliveryAt) parts.push(`last ${f.lastDeliveryKind === "page" ? "page delivery" : "test page"} ${formatAgo(f.lastDeliveryAt, now)}`);
    summary = parts.filter(Boolean).join(" · ");
  } else {
    const u = input.user;
    const ch = [u.emailTransport ? "by email" : null, u.sms && u.phoneVerified ? "by SMS/voice" : null, "in the app"].filter(
      (x): x is string => !!x,
    );
    summary = `Reachable ${ch.length > 1 ? `${ch.slice(0, -1).join(", ")} and ${ch[ch.length - 1]}` : ch[0]}`;
  }
  return { items, attention, ready, summary };
}
