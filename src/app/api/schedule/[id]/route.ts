// GET    /api/schedule/{id}   signed-in users
// PATCH  /api/schedule/{id}   facilitator, admin: the full entry, or {isActive}
// DELETE /api/schedule/{id}   facilitator, admin
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { requirePermission, requireUser } from "@/lib/exercise/auth/session";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { deleteSchedule, getSchedule, scheduleInputSchema, scheduleToggleSchema, updateSchedule } from "@/lib/exercise/schedule/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const a = await requireUser();
  if (!a.ok) return a.response;
  const { id } = await params;
  return withErrors(async () => NextResponse.json({ schedule: await getSchedule(id) }, { headers: { "Cache-Control": "no-store" } }));
}

export async function PATCH(req: Request, { params }: Ctx) {
  const a = await requirePermission("exercises.create");
  if (!a.ok) return a.response;
  const { id } = await params;
  const parsed = await parseJsonBody(req, scheduleInputSchema.or(scheduleToggleSchema));
  if (!parsed.ok) return parsed.response;
  return withErrors(async () => {
    const body = parsed.data;
    await updateSchedule(id, body);
    audit({
      actorUserId: a.user.id,
      action: "schedule.updated",
      targetType: "ExerciseSchedule",
      targetId: id,
      data: "title" in body ? { title: body.title, recurrence: body.recurrence, isActive: body.isActive } : { isActive: body.isActive },
      req,
    });
    return NextResponse.json({ schedule: await getSchedule(id) });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const a = await requirePermission("exercises.create");
  if (!a.ok) return a.response;
  const { id } = await params;
  return withErrors(async () => {
    await deleteSchedule(id);
    audit({ actorUserId: a.user.id, action: "schedule.deleted", targetType: "ExerciseSchedule", targetId: id, req });
    return NextResponse.json({ ok: true });
  });
}
