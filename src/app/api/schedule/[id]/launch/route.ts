// POST /api/schedule/{id}/launch   facilitator, admin: create a draft exercise from the entry.
// Same service as POST /api/exercises (createExercise). Nothing starts by itself.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { requirePermission } from "@/lib/exercise/auth/session";
import { withErrors } from "@/lib/exercise/errors";
import { launchFromSchedule } from "@/lib/exercise/schedule/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await requirePermission("exercises.create");
  if (!a.ok) return a.response;
  const { id } = await params;
  return withErrors(async () => {
    const ex = await launchFromSchedule(id, a.user);
    audit({ actorUserId: a.user.id, action: "exercise.created", targetType: "Exercise", targetId: ex.id, data: { scheduleId: id }, req });
    return NextResponse.json({ id: ex.id }, { status: 201 });
  });
}
