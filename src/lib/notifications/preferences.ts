// Assembles the category x channel preference matrix for the settings UIs.
// One source of truth shared by the user settings page and the admin policy
// page: it overlays org locks on user choices on catalog defaults.

import { db } from "@/lib/db";
import { CATEGORIES, CHANNELS, type Channel } from "./catalog";
import { twilioConfigured } from "@/lib/delivery/providers/twilio";

export type Lock = "user_choice" | "force_on" | "force_off";

export interface ChannelState {
  available: boolean;
  enabled: boolean; // effective on/off
  lock: Lock; // org policy lock for this cell
}

export interface CategoryMatrix {
  code: string;
  group: string;
  label: string;
  description: string;
  urgency: string;
  channels: Record<Channel, ChannelState>;
}

export interface UserSettings {
  timezone: string;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  dndUntil: string | null;
  digestCadence: string;
  /** Personal SMS/voice number for incident alerts and pages (E.164). */
  notificationPhone: string | null;
  /** Proven by the SMS code (Settings, "Send code"). */
  notificationPhoneVerified: boolean;
  /** An administrator allowed SMS/voice to this number without verification. */
  notificationPhoneAllowedUnverified: boolean;
  /** Can this server send SMS at all (Twilio configured)? Gates "Send code". */
  smsConfigured: boolean;
}

export async function getPreferenceMatrix(userId: string, organizationId: string): Promise<{ categories: CategoryMatrix[]; settings: UserSettings }> {
  const [prefs, policies, settingRow] = await Promise.all([
    db.userNotificationPref.findMany({ where: { userId } }),
    db.orgNotificationPolicy.findMany({ where: { organizationId } }),
    db.userNotificationSetting.findUnique({ where: { userId } }),
  ]);

  const prefMap = new Map(prefs.map((p) => [`${p.categoryCode}:${p.channel}`, p.enabled]));
  const lockMap = new Map(policies.map((p) => [`${p.categoryCode}:${p.channel}`, p.lock as Lock]));

  const categories: CategoryMatrix[] = CATEGORIES.map((cat) => {
    const channels = {} as Record<Channel, ChannelState>;
    for (const ch of CHANNELS) {
      const available = cat.availableChannels.includes(ch);
      const lock = lockMap.get(`${cat.code}:${ch}`) ?? "user_choice";
      let enabled: boolean;
      if (lock === "force_on") enabled = true;
      else if (lock === "force_off") enabled = false;
      else enabled = prefMap.get(`${cat.code}:${ch}`) ?? cat.defaultChannels.includes(ch);
      channels[ch] = { available, enabled: available && enabled, lock };
    }
    return { code: cat.code, group: cat.group, label: cat.label, description: cat.description, urgency: cat.urgency, channels };
  });

  const settings: UserSettings = {
    timezone: settingRow?.timezone ?? "UTC",
    quietHoursStart: settingRow?.quietHoursStart ?? null,
    quietHoursEnd: settingRow?.quietHoursEnd ?? null,
    dndUntil: settingRow?.dndUntil ? settingRow.dndUntil.toISOString() : null,
    digestCadence: settingRow?.digestCadence ?? "off",
    notificationPhone: settingRow?.notificationPhone ?? null,
    notificationPhoneVerified: !!settingRow?.notificationPhoneVerifiedAt,
    notificationPhoneAllowedUnverified: !!settingRow?.allowUnverifiedPhone,
    smsConfigured: twilioConfigured(),
  };

  return { categories, settings };
}

// ---------------------------------------------------------------------------
// Admin org-policy matrix — the per-cell lock state plus org-wide floors.
// ---------------------------------------------------------------------------

export interface OrgPolicyCell { available: boolean; lock: Lock; default: boolean }
export interface OrgPolicyCategory {
  code: string; group: string; label: string; description: string; urgency: string;
  channels: Record<Channel, OrgPolicyCell>;
}

export async function getOrgPolicyMatrix(organizationId: string): Promise<{ categories: OrgPolicyCategory[]; criticalBreaksDnd: boolean }> {
  const [policies, orgDefault] = await Promise.all([
    db.orgNotificationPolicy.findMany({ where: { organizationId } }),
    db.orgNotificationDefault.findUnique({ where: { organizationId } }),
  ]);
  const lockMap = new Map(policies.map((p) => [`${p.categoryCode}:${p.channel}`, p.lock as Lock]));

  const categories: OrgPolicyCategory[] = CATEGORIES.map((cat) => {
    const channels = {} as Record<Channel, OrgPolicyCell>;
    for (const ch of CHANNELS) {
      channels[ch] = {
        available: cat.availableChannels.includes(ch),
        lock: lockMap.get(`${cat.code}:${ch}`) ?? "user_choice",
        default: cat.defaultChannels.includes(ch),
      };
    }
    return { code: cat.code, group: cat.group, label: cat.label, description: cat.description, urgency: cat.urgency, channels };
  });

  return { categories, criticalBreaksDnd: orgDefault?.criticalBreaksDnd ?? true };
}
