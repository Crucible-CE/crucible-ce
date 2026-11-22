// GET  /api/schedule   signed-in users: every schedule entry
// POST /api/schedule   facilitator, admin: create an entry
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { requirePermission, requireUser } from "@/lib/exercise/auth/session";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { createSchedule, listSchedules, scheduleInputSchema } from "@/lib/exercise/schedule/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (!a.ok) return a.response;
  return withErrors(async () => NextResponse.json({ schedules: await listSchedules() }, { headers: { "Cache-Control": "no-store" } }));
}

export async function POST(req: Request) {
  const a = await requirePermission("exercises.create");
  if (!a.ok) return a.response;
  const parsed = await parseJsonBody(req, scheduleInputSchema);
  if (!parsed.ok) return parsed.response;
  return withErrors(async () => {
    const id = await createSchedule(parsed.data);
    audit({
      actorUserId: a.user.id,
      action: "schedule.created",
      targetType: "ExerciseSchedule",
      targetId: id,
      data: { title: parsed.data.title, mode: parsed.data.mode, recurrence: parsed.data.recurrence },
      req,
    });
    return NextResponse.json({ id }, { status: 201 });
  });
}
