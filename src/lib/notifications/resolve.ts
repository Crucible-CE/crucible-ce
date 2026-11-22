// =============================================================================
// Effective-channel resolver — the one function that decides, for a given user
// and notification category, exactly which channels deliver and whether the
// item is held by quiet hours or routed to a digest.
//
// Precedence (highest first):
//   1. Org policy lock      force_off -> never;  force_on -> always
//   2. User preference       explicit per channel toggle
//   3. Category default      from the catalog
// Then quiet-hours / DND suppress the *interruptive* channels (push, sms) for
// non-critical items, unless the org floor lets criticals break through.
// =============================================================================

import { db } from "@/lib/db";
import { CATEGORY_BY_CODE, type Channel, type Urgency } from "./catalog";

export interface ResolveResult {
  category: string;
  urgency: Urgency;
  channels: Channel[]; // channels to deliver on right now
  digest: boolean; // true => hold for the periodic digest instead of delivering
  quietSuppressed: Channel[]; // channels held back by quiet hours / DND
}

const EMPTY: ResolveResult = { category: "", urgency: "normal", channels: [], digest: false, quietSuppressed: [] };

// Minutes-from-local-midnight for `now` in the given IANA timezone.
function localMinutes(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

// Is `mins` inside [start, end), handling windows that wrap past midnight
// (e.g. 22:00 -> 07:00)?
function inWindow(mins: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? mins >= start && mins < end : mins >= start || mins < end;
}

export async function resolveDelivery(
  userId: string,
  organizationId: string,
  categoryCode: string,
  now: Date = new Date(),
): Promise<ResolveResult> {
  const cat = CATEGORY_BY_CODE[categoryCode];
  if (!cat) return EMPTY;

  const [prefs, policies, settings, orgDefault] = await Promise.all([
    db.userNotificationPref.findMany({ where: { userId, categoryCode } }),
    db.orgNotificationPolicy.findMany({ where: { organizationId, categoryCode } }),
    db.userNotificationSetting.findUnique({ where: { userId } }),
    db.orgNotificationDefault.findUnique({ where: { organizationId } }),
  ]);

  const prefByChannel = new Map(prefs.map((p) => [p.channel as Channel, p.enabled]));
  const lockByChannel = new Map(policies.map((p) => [p.channel as Channel, p.lock]));

  // 1-3: base channel set from policy > user pref > default.
  let channels: Channel[] = cat.availableChannels.filter((ch) => {
    const lock = lockByChannel.get(ch);
    if (lock === "force_off") return false;
    if (lock === "force_on") return true;
    const pref = prefByChannel.get(ch);
    if (pref !== undefined) return pref;
    return cat.defaultChannels.includes(ch);
  });

  // Quiet hours / DND: suppress push + sms for non-critical (or all-but-in_app
  // when a hard DND snooze is active). Criticals break through if the org floor
  // allows (default true).
  const criticalBreaks = orgDefault?.criticalBreaksDnd ?? true;
  const isCritical = cat.urgency === "critical";
  const quietSuppressed: Channel[] = [];

  if (!(isCritical && criticalBreaks) && settings) {
    const dndActive = settings.dndUntil ? settings.dndUntil.getTime() > now.getTime() : false;
    const inQuiet =
      settings.quietHoursStart != null && settings.quietHoursEnd != null
        ? inWindow(localMinutes(now, settings.timezone), settings.quietHoursStart, settings.quietHoursEnd)
        : false;
    if (dndActive || inQuiet) {
      const interruptive: Channel[] = ["push", "sms"];
      channels = channels.filter((ch) => {
        if (interruptive.includes(ch)) {
          quietSuppressed.push(ch);
          return false;
        }
        return true;
      });
    }
  }

  // Low-urgency items route to the digest when the user has one enabled — but
  // only the passive in-app copy is batched; loud channels are dropped.
  const digest = cat.urgency === "low" && (settings?.digestCadence ?? "off") !== "off";

  return { category: categoryCode, urgency: cat.urgency, channels, digest, quietSuppressed };
}
