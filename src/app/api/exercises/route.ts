// GET /api/exercises?status=live|planned|ended   list for the signed-in user
// POST /api/exercises                             create a draft (facilitator, admin)
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { requirePermission, requireUser } from "@/lib/exercise/auth/session";
import { parseJsonBody } from "@/lib/http/parse-body";
import { createExercise } from "@/lib/exercise/create";
import { withErrors } from "@/lib/exercise/errors";
import { LIST_TABS, isListTab, listExercises } from "@/lib/exercise/list";
import { createExerciseSchema } from "@/lib/exercise/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requireUser();
  if (!a.ok) return a.response;
  return withErrors(async () => {
    const status = new URL(req.url).searchParams.get("status");
    const statuses = isListTab(status) ? LIST_TABS[status] : status ? [status] : undefined;
    const exercises = await listExercises(a.user, { statuses });
    return NextResponse.json({ exercises }, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(req: Request) {
  const a = await requirePermission("exercises.create");
  if (!a.ok) return a.response;
  const parsed = await parseJsonBody(req, createExerciseSchema);
  if (!parsed.ok) return parsed.response;
  return withErrors(async () => {
    const { id } = await createExercise(parsed.data, a.user);
    audit({
      actorUserId: a.user.id,
      action: "exercise.created",
      targetType: "Exercise",
      targetId: id,
      data: { mode: parsed.data.mode, templateId: parsed.data.templateId ?? null },
      req,
    });
    return NextResponse.json({ id }, { status: 201 });
  });
}
