// Who a broadcast reaches. The sender picks any mix of org members (all,
// by role, or by name) and escalation contacts (all, by tier, by contact role,
// or by name). People are merged: a matrix contact linked to a member who is
// also picked becomes ONE recipient (the member, with the contact's id).
//
// Addresses follow the paging rules (lib/delivery/phone-gate): a member's
// email is their account email and their phone is a verified (or
// administrator overridden) number; a contact's phone is dialed only when it
// is verified or overridden.

import { z } from "zod";
import { db } from "@/lib/db";
import { ORG_ROLES } from "@/lib/auth/rbac";
import { toE164 } from "@/lib/phone/e164";
import { UNVERIFIED_PHONE_REASON, contactPhoneAllowed, resolveMemberPhones } from "@/lib/delivery/phone-gate";

export const BROADCAST_CHANNELS = ["app", "email", "sms", "voice", "webhook"] as const;
export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number];

export const MAX_BROADCAST_RECIPIENTS = 1000;

const ids = z.array(z.string().min(1).max(64)).max(MAX_BROADCAST_RECIPIENTS).optional();

export const audienceSchema = z
  .object({
    allMembers: z.boolean().optional(),
    roles: z.array(z.enum(ORG_ROLES)).max(ORG_ROLES.length).optional(),
    userIds: ids,
    allContacts: z.boolean().optional(),
    contactTiers: z.array(z.number().int().min(1).max(3)).max(3).optional(),
    contactRoles: z.array(z.string().min(1).max(40)).max(20).optional(),
    contactIds: ids,
  })
  .strict();

export type BroadcastAudience = z.infer<typeof audienceSchema>;

export function audienceIsEmpty(a: BroadcastAudience): boolean {
  return !a.allMembers && !a.roles?.length && !a.userIds?.length && !a.allContacts && !a.contactTiers?.length && !a.contactRoles?.length && !a.contactIds?.length;
}

export interface BroadcastTarget {
  userId: string | null;
  contactId: string | null;
  name: string;
  email: string | null;
  /** E.164 that may be dialed, or null. */
  phone: string | null;
  /** Why the phone may not be dialed, when there is one. */
  phoneBlocked: string | null;
}

interface MemberRow { id: string; name: string | null; email: string }
interface ContactRow { id: string; name: string; email: string | null; phone: string | null; userId: string | null; phoneVerifiedAt: Date | null; allowUnverifiedPhone: boolean }

/** Pure merge of picked members and contacts into recipients (exported for tests). */
export function mergeTargets(
  members: MemberRow[],
  memberPhones: Map<string, { phone: string | null; blocked: string | null }>,
  contacts: ContactRow[],
): BroadcastTarget[] {
  const out: BroadcastTarget[] = [];
  const byUser = new Map<string, BroadcastTarget>();
  for (const m of members) {
    const p = memberPhones.get(m.id) ?? { phone: null, blocked: null };
    const t: BroadcastTarget = { userId: m.id, contactId: null, name: m.name ?? m.email, email: m.email, phone: p.phone, phoneBlocked: p.blocked };
    byUser.set(m.id, t);
    out.push(t);
  }
  for (const c of contacts) {
    const linked = c.userId ? byUser.get(c.userId) : undefined;
    if (linked) {
      linked.contactId ??= c.id;
      continue;
    }
    const dialable = toE164(c.phone);
    const allowed = dialable !== null && contactPhoneAllowed(c);
    out.push({
      userId: c.userId,
      contactId: c.id,
      name: c.name,
      email: c.email,
      phone: allowed ? dialable : null,
      phoneBlocked: dialable && !allowed ? UNVERIFIED_PHONE_REASON : null,
    });
  }
  return out;
}

/** Resolve an audience to recipients within ONE organization (active people only). */
export async function resolveAudience(organizationId: string, a: BroadcastAudience): Promise<BroadcastTarget[]> {
  // "All" is no filter at all (Prisma matches nothing for OR: [{}]).
  const memberOr: object[] = [];
  if (a.roles?.length) memberOr.push({ role: { in: a.roles } });
  if (a.userIds?.length) memberOr.push({ id: { in: a.userIds } });
  const contactOr: object[] = [];
  if (a.contactTiers?.length) contactOr.push({ tier: { in: a.contactTiers } });
  if (a.contactRoles?.length) contactOr.push({ role: { in: a.contactRoles } });
  if (a.contactIds?.length) contactOr.push({ id: { in: a.contactIds } });

  const [members, contacts] = await Promise.all([
    a.allMembers || memberOr.length
      ? db.user.findMany({
          where: { organizationId, isActive: true, ...(a.allMembers ? {} : { OR: memberOr }) },
          orderBy: [{ name: "asc" }, { email: "asc" }],
          select: { id: true, name: true, email: true },
          take: MAX_BROADCAST_RECIPIENTS + 1,
        })
      : Promise.resolve([] as MemberRow[]),
    a.allContacts || contactOr.length
      ? db.escalationContact.findMany({
          where: { organizationId, isActive: true, ...(a.allContacts ? {} : { OR: contactOr }) },
          orderBy: [{ tier: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true, email: true, phone: true, userId: true, phoneVerifiedAt: true, allowUnverifiedPhone: true },
          take: MAX_BROADCAST_RECIPIENTS + 1,
        })
      : Promise.resolve([] as ContactRow[]),
  ]);
  const phones = await resolveMemberPhones(organizationId, members.map((m) => m.id));
  return mergeTargets(members, phones, contacts);
}
