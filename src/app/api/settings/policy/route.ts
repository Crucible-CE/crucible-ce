// GET /api/settings/policy   admins: {cadence, requiredRoles, confidentialityMarking, defaults}
// PUT /api/settings/policy   admins: {cadence: {framework: months}, requiredRoles: string[], confidentialityMarking?: string}
// Suggested objectives in the policy are kept as they are.
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { requirePermission } from "@/lib/exercise/auth/session";
import { parseJsonBody } from "@/lib/http/parse-body";
import { defaultCadence } from "@/lib/exercise/content/frameworks";
import { getExerciseSettings, lockExerciseSettings } from "@/lib/exercise/settings";
import { policyUpdateSchema, readPolicy } from "@/lib/exercise/program/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requirePermission("settings.manage");
  if (!a.ok) return a.response;
  const i = await getExerciseSettings();
  if (!i) return NextResponse.json({ error: "Setup has not run." }, { status: 404 });
  const p = readPolicy(i.policy);
  return NextResponse.json({ cadence: p.cadence, requiredRoles: p.requiredRoles, confidentialityMarking: p.confidentialityMarking, reminderDomains: p.reminderDomains, defaults: defaultCadence });
}

export async function PUT(req: Request) {
  const a = await requirePermission("settings.manage");
  if (!a.ok) return a.response;
  const parsed = await parseJsonBody(req, policyUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const result = await db.$transaction(async (tx) => {
    const i = await lockExerciseSettings(tx);
    if (!i) return null;
    const raw = (i.policy && typeof i.policy === "object" && !Array.isArray(i.policy) ? i.policy : {}) as Record<string, unknown>;
    const next = {
      ...raw,
      schemaVersion: 1,
      cadence: parsed.data.cadence,
      requiredRoles: parsed.data.requiredRoles,
      ...(parsed.data.confidentialityMarking !== undefined ? { confidentialityMarking: parsed.data.confidentialityMarking } : {}),
      ...(parsed.data.reminderDomains !== undefined ? { reminderDomains: parsed.data.reminderDomains } : {}),
    };
    await tx.exerciseSettings.update({ where: { organizationId: i.organizationId }, data: { policy: next as Prisma.InputJsonValue } });
    return { policy: readPolicy(next), organizationId: i.organizationId };
  });
  if (!result) return NextResponse.json({ error: "Setup has not run." }, { status: 404 });
  const updated = result.policy;
  audit({
    actorUserId: a.user.id,
    action: "settings.policy_updated",
    targetType: "ExerciseSettings",
    targetId: result.organizationId,
    data: { cadence: updated.cadence, requiredRoles: updated.requiredRoles, confidentialityMarking: updated.confidentialityMarking, reminderDomains: updated.reminderDomains },
    req,
  });
  return NextResponse.json({
    cadence: updated.cadence,
    requiredRoles: updated.requiredRoles,
    confidentialityMarking: updated.confidentialityMarking,
    reminderDomains: updated.reminderDomains,
  });
}
