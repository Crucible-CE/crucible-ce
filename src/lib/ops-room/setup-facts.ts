// The setup facts the Ops Room readiness panel and the onboarding checklist
// both derive from: what is configured on this server (env) and what the org
// and the signed-in user have done (database). One loader per scope so the two
// surfaces read the same numbers; the decisions live in lib/ops-room/readiness
// and lib/onboarding/steps (pure, unit-tested).

import { db } from "@/lib/db";
import { activeEmailTransport, type EmailTransportId } from "@/lib/email/transport";
import { twilioConfigured } from "@/lib/delivery/providers/twilio";
import { allProviders, ensurePluginsLoaded } from "@/lib/delivery/registry";
import { memberPhoneAllowed, resolveMemberPhones } from "@/lib/delivery/phone-gate";
import { contactStats, type ContactStats } from "./rules";
import { isSigningConfigured } from "@/lib/export/signing";
import { TEST_PAGE_KEY, readTestPage, type TestPageState } from "@/lib/onboarding/state";
import { countMembersWithoutMfa } from "@/lib/auth/mfa/org-status";
import { hasAnyFactor, loadFactors } from "@/lib/auth/mfa/service";
import type { PracticeFacts } from "@/lib/onboarding/practice-facts";

// ---------------------------------------------------------------------------
// Org facts
// ---------------------------------------------------------------------------

export interface OrgSetupFacts {
  orgName: string;
  /** Industry / region or any org profile field saved. */
  orgProfileFilled: boolean;
  /** Active members other than the caller. */
  otherActiveMembers: number;
  pendingInvites: number;
  emailTransport: EmailTransportId | null;
  sms: boolean;
  /** Display names of configured webhooks and delivery plugins. */
  extras: { name: string; kind: "webhook" | "plugin" }[];
  pluginErrors: number;
  /** Last successful out-of-band delivery: a page delivery, a Delivery-settings test send, or a self test page. */
  lastDeliveryAt: Date | null;
  lastDeliveryKind: "page" | "test" | null;
  /** A test page provably went out (Delivery-settings test send "sent", a self test page acknowledged) or a real page was acknowledged. */
  testPageConfirmed: boolean;
  contacts: ContactStats;
  /** Active contributors + administrators. */
  responders: number;
  /** ...of whom have no phone SMS/voice may dial (only meaningful with SMS configured). */
  respondersWithoutPhone: number;
  signingConfigured: boolean;
  publicUrl: string | null;
  slaConfigured: boolean;
  /** Active members with no two-factor method. */
  membersWithoutMfa: number;
  /** Org policy: two-factor sign-in required for everyone. */
  requireMfa: boolean;
}

function safe(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

export async function loadOrgSetupFacts(organizationId: string, callerId: string, now: Date = new Date()): Promise<OrgSetupFacts> {
  const sms = twilioConfigured();
  const [org, members, pendingInvites, contactRows, slaRows, lastPage, lastTest, ackedPage, providers, report, membersWithoutMfa] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, industry: true, region: true, profileJson: true, requireMfa: true } }),
    db.user.findMany({ where: { organizationId, isActive: true }, select: { id: true, role: true } }),
    db.orgInvite.count({ where: { organizationId, usedAt: null, revokedAt: null, expiresAt: { gt: now } } }),
    db.escalationContact.findMany({
      where: { organizationId, isActive: true },
      select: { tier: true, email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true, allowUnverifiedPhone: true },
    }),
    db.orgIncidentSla.count({ where: { organizationId } }),
    db.pageDelivery.findFirst({ where: { organizationId, status: "sent" }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    db.adminAuditLog.findFirst({
      where: { organizationId, action: "delivery.test_sent", metadataJson: { path: ["status"], equals: "sent" } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    db.incidentPage.findFirst({ where: { organizationId, status: "acked" }, select: { id: true } }),
    allProviders(),
    ensurePluginsLoaded(),
    countMembersWithoutMfa(organizationId),
  ]);

  const memberIds = members.map((m) => m.id);
  const testPages = memberIds.length
    ? await db.onboardingState.findMany({ where: { scope: "user", key: TEST_PAGE_KEY, subjectId: { in: memberIds } }, select: { id: true, value: true } })
    : [];
  const tp = testPages.map((r) => readTestPage(r.id, r.value)).filter((t): t is TestPageState => t !== null);

  const responders = members.filter((m) => m.role === "contributor" || m.role === "exercise_director" || m.role === "administrator");
  let respondersWithoutPhone = 0;
  if (sms && responders.length > 0) {
    const phones = await resolveMemberPhones(organizationId, responders.map((r) => r.id));
    respondersWithoutPhone = responders.filter((r) => !phones.get(r.id)?.phone).length;
  }

  // Latest successful delivery across the three sources.
  const candidates: { at: Date; kind: "page" | "test" }[] = [];
  if (lastPage) candidates.push({ at: lastPage.updatedAt, kind: "page" });
  if (lastTest) candidates.push({ at: lastTest.createdAt, kind: "test" });
  for (const t of tp) if (t.deliveredAt) candidates.push({ at: new Date(t.deliveredAt), kind: "test" });
  candidates.sort((a, b) => b.at.getTime() - a.at.getTime());

  const extras = providers
    .filter((r) => !r.provider.channels.some((c) => c === "email" || c === "sms" || c === "voice"))
    .filter((r) => safe(() => r.provider.isConfigured()))
    .map((r) => ({ name: r.provider.displayName, kind: r.source === "plugin" ? ("plugin" as const) : ("webhook" as const) }));

  const profile = org?.profileJson && typeof org.profileJson === "object" && !Array.isArray(org.profileJson) ? org.profileJson : null;
  return {
    orgName: org?.name ?? "",
    orgProfileFilled: !!(org?.industry || org?.region || (profile && Object.keys(profile).length > 0)),
    otherActiveMembers: members.filter((m) => m.id !== callerId).length,
    pendingInvites,
    emailTransport: activeEmailTransport(),
    sms,
    extras,
    pluginErrors: report.errors.length,
    lastDeliveryAt: candidates[0]?.at ?? null,
    lastDeliveryKind: candidates[0]?.kind ?? null,
    testPageConfirmed: !!lastTest || !!ackedPage || tp.some((t) => !!t.everAckedAt),
    contacts: contactStats(contactRows, { sms, now }),
    responders: responders.length,
    respondersWithoutPhone,
    signingConfigured: safe(isSigningConfigured),
    publicUrl: process.env.PUBLIC_URL?.trim() || null,
    slaConfigured: slaRows > 0,
    membersWithoutMfa,
    requireMfa: org?.requireMfa ?? false,
  };
}

// ---------------------------------------------------------------------------
// User facts
// ---------------------------------------------------------------------------

export interface UserSetupFacts {
  name: string | null;
  jobTitle: string | null;
  sms: boolean;
  emailTransport: EmailTransportId | null;
  phoneSaved: boolean;
  /** Verified (SMS code) or opened by an administrator: SMS/voice can reach it. */
  phoneVerified: boolean;
  /** Saved notification preferences at least once. */
  prefsReviewed: boolean;
  testPage: TestPageState | null;
  /** Acknowledged a real page at least once. */
  ackedRealPage: boolean;
  /** An authenticator app or a security key is set up. */
  mfaEnabled: boolean;
  /** Unused recovery codes (meaningful when mfaEnabled). */
  recoveryRemaining: number;
  /** The practice steps (onboarding only; lib/onboarding/practice-facts). */
  practice?: PracticeFacts;
}

export async function loadUserSetupFacts(userId: string): Promise<UserSetupFacts> {
  const [user, setting, prefCount, testRow, acked, factors] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { name: true, jobTitle: true } }),
    db.userNotificationSetting.findUnique({
      where: { userId },
      select: { notificationPhone: true, notificationPhoneVerifiedAt: true, allowUnverifiedPhone: true },
    }),
    db.userNotificationPref.count({ where: { userId } }),
    db.onboardingState.findUnique({ where: { scope_subjectId_key: { scope: "user", subjectId: userId, key: TEST_PAGE_KEY } }, select: { id: true, value: true } }),
    db.incidentPage.findFirst({ where: { acknowledgedById: userId, status: "acked" }, select: { id: true } }),
    loadFactors(userId),
  ]);
  return {
    name: user?.name ?? null,
    jobTitle: user?.jobTitle ?? null,
    sms: twilioConfigured(),
    emailTransport: activeEmailTransport(),
    phoneSaved: !!setting?.notificationPhone,
    phoneVerified: !!setting?.notificationPhone && memberPhoneAllowed(setting),
    prefsReviewed: prefCount > 0 || !!setting,
    testPage: testRow ? readTestPage(testRow.id, testRow.value) : null,
    ackedRealPage: !!acked,
    mfaEnabled: hasAnyFactor(factors),
    recoveryRemaining: factors.recoveryRemaining,
  };
}
