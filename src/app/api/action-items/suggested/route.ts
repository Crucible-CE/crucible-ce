// GET    /api/action-items/suggested          program users: objectives carried from open AFIs
// DELETE /api/action-items/suggested {id}     remove one suggestion
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { AccessError } from "@/lib/exercise/runtime/view";
import { withErrors } from "@/lib/exercise/errors";
import { isProgramUser, planUser } from "@/lib/exercise/improvement/access";
import { removeSuggestedObjective } from "@/lib/exercise/improvement/carry";
import { getPolicy } from "@/lib/exercise/program/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withErrors(async () => {
    const user = await planUser();
    if (!isProgramUser(user)) throw new AccessError(403, "You do not have access to this.");
    const policy = await getPolicy();
    const exIds = [...new Set(policy.suggestedObjectives.map((s) => s.sourceExerciseId).filter((x): x is string => Boolean(x)))];
    const exercises = exIds.length ? await db.exercise.findMany({ where: { id: { in: exIds } }, select: { id: true, title: true } }) : [];
    const titles = new Map(exercises.map((e) => [e.id, e.title]));
    return NextResponse.json(
      { suggestions: policy.suggestedObjectives.map((s) => ({ ...s, sourceExerciseTitle: s.sourceExerciseId ? (titles.get(s.sourceExerciseId) ?? null) : null })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export async function DELETE(req: Request) {
  return withErrors(async () => {
    const user = await planUser();
    if (!isProgramUser(user)) throw new AccessError(403, "You do not have access to this.");
    const parsed = await parseJsonBody(req, z.object({ id: z.string().min(1).max(40) }));
    if (!parsed.ok) return parsed.response;
    await removeSuggestedObjective(parsed.data.id);
    audit({ actorUserId: user.id, action: "suggested_objective.removed", targetType: "ExerciseSettings", data: { id: parsed.data.id }, req });
    return NextResponse.json({ ok: true });
  });
}
