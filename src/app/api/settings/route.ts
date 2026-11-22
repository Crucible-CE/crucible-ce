// GET   /api/settings   administrators: exercise settings for the organization
// PATCH /api/settings   administrators: {timezone, capabilityFramework, enabledFrameworks, hseepMode, requireSponsorSignoff, retentionYears}
// The organization name is CE's (Org admin, Organization).
import { NextResponse } from "next/server";
import type { ExerciseSettings } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { requirePermission } from "@/lib/exercise/auth/session";
import { parseJsonBody } from "@/lib/http/parse-body";
import { exerciseSettingsSchema, getExerciseSettings } from "@/lib/exercise/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function view(i: ExerciseSettings) {
  return {
    timezone: i.timezone,
    capabilityFramework: i.capabilityFramework,
    enabledFrameworks: i.enabledFrameworks,
    hseepMode: i.hseepMode,
    requireSponsorSignoff: i.requireSponsorSignoff,
    retentionYears: i.retentionYears,
    showCloudNotes: i.showCloudNotes,
  };
}

export async function GET() {
  const a = await requirePermission("settings.manage");
  if (!a.ok) return a.response;
  const settings = await getExerciseSettings();
  if (!settings) return NextResponse.json({ error: "Setup has not run." }, { status: 404 });
  return NextResponse.json(view(settings));
}

export async function PATCH(req: Request) {
  const a = await requirePermission("settings.manage");
  if (!a.ok) return a.response;
  const parsed = await parseJsonBody(req, exerciseSettingsSchema.partial());
  if (!parsed.ok) return parsed.response;

  const before = await getExerciseSettings();
  if (!before) return NextResponse.json({ error: "Setup has not run." }, { status: 404 });
  const updated = await db.exerciseSettings.update({ where: { organizationId: before.organizationId }, data: parsed.data });

  const changed = Object.keys(parsed.data).filter(
    (k) => JSON.stringify((view(before) as Record<string, unknown>)[k]) !== JSON.stringify((view(updated) as Record<string, unknown>)[k]),
  );
  audit({ actorUserId: a.user.id, action: "settings.updated", targetType: "ExerciseSettings", targetId: before.organizationId, data: { changed }, req });
  return NextResponse.json(view(updated));
}
