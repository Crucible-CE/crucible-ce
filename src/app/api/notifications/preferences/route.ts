import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPreferenceMatrix } from "@/lib/notifications/preferences";
import { CATEGORY_BY_CODE, CHANNELS } from "@/lib/notifications/catalog";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { e164PhoneField } from "@/lib/phone/schema";

// GET /api/notifications/preferences — the category x channel matrix + the
// user's global delivery settings (quiet hours, DND, digest).
export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const data = await getPreferenceMatrix(session.user.id, session.user.organizationId);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

const putSchema = z.object({
  prefs: z
    .array(z.object({ categoryCode: z.string().max(LIMITS.TAG), channel: z.enum(CHANNELS), enabled: z.boolean() }))
    .max(LIMITS.ARRAY)
    .optional(),
  settings: z
    .object({
      timezone: z.string().max(LIMITS.TIMEZONE).optional(),
      quietHoursStart: z.number().int().min(0).max(1439).nullable().optional(),
      quietHoursEnd: z.number().int().min(0).max(1439).nullable().optional(),
      dndUntil: z.string().datetime().nullable().optional(),
      digestCadence: z.enum(["off", "hourly", "daily"]).optional(),
      // Personal SMS/voice number (E.164, normalized at write; "" / null clears).
      notificationPhone: e164PhoneField(),
    })
    .optional(),
});

// PUT /api/notifications/preferences — update toggles and/or settings.
// Org-locked cells (force_on/force_off) are silently ignored, never overridden.
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const orgId = session.user.organizationId;

  const parsed = await parseJsonBody(req, putSchema);
  if (!parsed.ok) return parsed.response;

  // Pull locks once so we never let a user write a locked cell.
  const locks = parsed.data.prefs?.length
    ? new Map(
        (await db.orgNotificationPolicy.findMany({ where: { organizationId: orgId } })).map((p) => [`${p.categoryCode}:${p.channel}`, p.lock]),
      )
    : new Map<string, string>();

  for (const pref of parsed.data.prefs ?? []) {
    const cat = CATEGORY_BY_CODE[pref.categoryCode];
    if (!cat || !cat.availableChannels.includes(pref.channel)) continue;
    const lock = locks.get(`${pref.categoryCode}:${pref.channel}`);
    if (lock === "force_on" || lock === "force_off") continue; // locked — ignore
    await db.userNotificationPref.upsert({
      where: { userId_categoryCode_channel: { userId, categoryCode: pref.categoryCode, channel: pref.channel } },
      create: { userId, categoryCode: pref.categoryCode, channel: pref.channel, enabled: pref.enabled },
      update: { enabled: pref.enabled },
    });
  }

  if (parsed.data.settings) {
    const s = parsed.data.settings;
    // A changed number is unverified until confirmed again (SMS code), and an
    // administrator override for the OLD number does not carry over.
    let phoneChanged = false;
    if (s.notificationPhone !== undefined) {
      const current = await db.userNotificationSetting.findUnique({ where: { userId }, select: { notificationPhone: true } });
      phoneChanged = (current?.notificationPhone ?? null) !== s.notificationPhone;
    }
    await db.userNotificationSetting.upsert({
      where: { userId },
      create: {
        userId,
        timezone: s.timezone ?? "UTC",
        quietHoursStart: s.quietHoursStart ?? null,
        quietHoursEnd: s.quietHoursEnd ?? null,
        dndUntil: s.dndUntil ? new Date(s.dndUntil) : null,
        digestCadence: s.digestCadence ?? "off",
        notificationPhone: s.notificationPhone ?? null,
        notificationPhoneVerifiedAt: null,
      },
      update: {
        ...(s.timezone !== undefined ? { timezone: s.timezone } : {}),
        ...(s.quietHoursStart !== undefined ? { quietHoursStart: s.quietHoursStart } : {}),
        ...(s.quietHoursEnd !== undefined ? { quietHoursEnd: s.quietHoursEnd } : {}),
        ...(s.dndUntil !== undefined ? { dndUntil: s.dndUntil ? new Date(s.dndUntil) : null } : {}),
        ...(s.digestCadence !== undefined ? { digestCadence: s.digestCadence } : {}),
        ...(phoneChanged
          ? {
              notificationPhone: s.notificationPhone ?? null,
              notificationPhoneVerifiedAt: null,
              allowUnverifiedPhone: false,
              phoneOtpHash: null,
              phoneOtpPhone: null,
              phoneOtpExpiresAt: null,
              phoneOtpAttempts: 0,
            }
          : {}),
      },
    });
  }

  const data = await getPreferenceMatrix(userId, orgId);
  return NextResponse.json(data);
}
