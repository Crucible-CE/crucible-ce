// Shared field rules for escalation-matrix contacts.
//
// - Phones are stored in E.164 (+<country><number>) because the SMS/voice
//   providers dial them as-is. Normalized at write time (lib/phone/e164).
// - allowUnverifiedPhone (toll-fraud override) is administrator-only.
// - Contact details (email / phones / notes) are for the people who run the
//   response: readers see the matrix structure, not the numbers.

import { hasPermission, type RBACUser } from "@/lib/auth/rbac";
import { e164PhoneField } from "@/lib/phone/schema";

/**
 * Optional phone: "" / null clear it, anything else is normalized to E.164 at
 * write time by the shared helper (lib/phone) — national input uses
 * PHONE_DEFAULT_COUNTRY_CODE — and an unreadable number is a validation error.
 */
export const phoneField = e164PhoneField(40);

/** Columns returned to clients (never the verification token hash). */
export const CONTACT_SELECT = {
  id: true,
  name: true,
  title: true,
  email: true,
  phone: true,
  alternatePhone: true,
  tier: true,
  severityLevel: true,
  role: true,
  userId: true,
  notes: true,
  isActive: true,
  sortOrder: true,
  allowUnverifiedPhone: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  verificationSentAt: true,
  phoneVerificationSentAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Days after which a channel's verification is stale (re-verify). */
export const CONTACT_VERIFY_STALE_DAYS = 90;

/**
 * Prisma where-clause: active contacts with an email or a phone whose OWN
 * verification is missing or older than the stale threshold.
 */
export function staleContactWhere(staleBefore: Date) {
  return {
    isActive: true,
    OR: [
      { email: { not: null }, emailVerifiedAt: null },
      { email: { not: null }, emailVerifiedAt: { lt: staleBefore } },
      { phone: { not: null }, phoneVerifiedAt: null },
      { phone: { not: null }, phoneVerifiedAt: { lt: staleBefore } },
    ],
  };
}

/** Contributors and administrators see contact details; readers don't. */
export function canSeeContactDetails(user: RBACUser): boolean {
  return hasPermission(user, "incidents.edit");
}

export function shapeContactForViewer<T extends { email: string | null; phone: string | null; alternatePhone: string | null; notes: string | null }>(
  contact: T,
  user: RBACUser,
): T & { detailsHidden: boolean } {
  if (canSeeContactDetails(user)) return { ...contact, detailsHidden: false };
  return { ...contact, email: null, phone: null, alternatePhone: null, notes: null, detailsHidden: true };
}
