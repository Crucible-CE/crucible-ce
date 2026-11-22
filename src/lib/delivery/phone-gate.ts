// =============================================================================
// Which phone may Crucible text or call? (toll-fraud rule, shared)
// =============================================================================
// SMS and voice cost money per message and can be pointed at premium-rate
// numbers, so a phone is dialed only when its owner PROVED they hold it, or an
// administrator explicitly waived that for it:
//   - members: UserNotificationSetting.notificationPhone, verified by a 6-digit
//     SMS code (notificationPhoneVerifiedAt) or allowUnverifiedPhone (admin);
//     otherwise a linked escalation-matrix contact's phone under the contact
//     rule below;
//   - escalation contacts: EscalationContact.phone, verified by the SMS
//     verification link (phoneVerifiedAt) or allowUnverifiedPhone (admin).
//     The contact's EMAIL verification does not open the phone.
// Used by the page delivery engine and by notify() SMS: one rule everywhere.
// =============================================================================

import { db } from "@/lib/db";
import { toE164 } from "@/lib/phone/e164";

/** Recorded on SMS/voice when the target has a phone that may not be dialed yet. */
export const UNVERIFIED_PHONE_REASON = "phone not verified";

/** May SMS/voice go to this escalation contact's phone? */
export function contactPhoneAllowed(c: { phoneVerifiedAt?: Date | null; allowUnverifiedPhone?: boolean | null }): boolean {
  return c.phoneVerifiedAt != null || c.allowUnverifiedPhone === true;
}

/** May SMS/voice go to this member's own notification phone? */
export function memberPhoneAllowed(s: { notificationPhoneVerifiedAt?: Date | null; allowUnverifiedPhone?: boolean | null }): boolean {
  return s.notificationPhoneVerifiedAt != null || s.allowUnverifiedPhone === true;
}

export interface MemberPhone {
  /** E.164 number that may be dialed, or null. */
  phone: string | null;
  /** Set when the member HAS a number but none may be dialed yet. */
  blocked: string | null;
}

/**
 * Dialable phone per member, batched (two queries for any roster size):
 * their own verified (or admin-overridden) notification phone, else the first
 * linked matrix contact (tier, sortOrder) whose phone is verified/overridden.
 */
export async function resolveMemberPhones(organizationId: string, userIds: string[]): Promise<Map<string, MemberPhone>> {
  const out = new Map<string, MemberPhone>();
  if (userIds.length === 0) return out;
  const [settings, contacts] = await Promise.all([
    db.userNotificationSetting.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, notificationPhone: true, notificationPhoneVerifiedAt: true, allowUnverifiedPhone: true },
    }),
    db.escalationContact.findMany({
      where: { organizationId, userId: { in: userIds }, isActive: true, phone: { not: null } },
      orderBy: [{ tier: "asc" }, { sortOrder: "asc" }],
      select: { userId: true, phone: true, phoneVerifiedAt: true, allowUnverifiedPhone: true },
    }),
  ]);
  const settingBy = new Map((settings ?? []).map((s) => [s.userId, s]));
  for (const userId of userIds) {
    const s = settingBy.get(userId);
    const own = toE164(s?.notificationPhone);
    if (own && s && memberPhoneAllowed(s)) {
      out.set(userId, { phone: own, blocked: null });
      continue;
    }
    const linked = (contacts ?? []).filter((c) => c.userId === userId && toE164(c.phone));
    const allowed = linked.find(contactPhoneAllowed);
    if (allowed) out.set(userId, { phone: toE164(allowed.phone), blocked: null });
    else out.set(userId, { phone: null, blocked: own || linked.length > 0 ? UNVERIFIED_PHONE_REASON : null });
  }
  return out;
}
