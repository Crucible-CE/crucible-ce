// GET /api/action-items/plan?aarId=   control of that exercise (or program users)
// Everything the improvement plan panel needs: the AAR's findings with their
// status and decision, the plan rows, link options and whether the plan can change.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ServiceError, withErrors } from "@/lib/exercise/errors";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { assertPlanRead, assertPlanWrite, planUser } from "@/lib/exercise/improvement/access";
import { listActionItems } from "@/lib/exercise/improvement/service";
import { listAfis, parseSections } from "@/lib/exercise/improvement/afis";
import { decisionText } from "@/lib/exercise/aar/findings";
import { readPolicy } from "@/lib/exercise/program/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withErrors(async () => {
    const user = await planUser();
    const aarId = new URL(req.url).searchParams.get("aarId");
    if (!aarId) throw new ServiceError(400, "Pick a report.");
    const aar = await db.afterActionReport.findUnique({
      where: { id: aarId },
      select: { id: true, exerciseId: true, version: true, status: true, sections: true, exercise: { select: { title: true, isPractice: true, status: true } } },
    });
    if (!aar) throw new ServiceError(404, "Report not found.");
    await assertPlanRead(user, aar.exerciseId);
    let canWrite = true;
    try {
      await assertPlanWrite(user, aar.exerciseId);
    } catch {
      canWrite = false;
    }
    const [newer, items, objectives, instance] = await Promise.all([
      db.afterActionReport.findFirst({ where: { exerciseId: aar.exerciseId, version: { gt: aar.version } }, select: { id: true } }),
      listActionItems({ exerciseId: aar.exerciseId }),
      db.objective.findMany({ where: { exerciseId: aar.exerciseId }, orderBy: { seq: "asc" }, select: { id: true, seq: true, text: true, capabilityIds: true } }),
      getExerciseSettings(),
    ]);
    const used = [...new Set(objectives.flatMap((o) => o.capabilityIds))];
    const capabilities = await db.capability.findMany({
      where: { OR: [{ framework: instance?.capabilityFramework ?? "nist-csf", isActive: true }, { id: { in: used } }] },
      orderBy: [{ framework: "asc" }, { seq: "asc" }],
      select: { id: true, key: true, name: true },
    });
    const planItems = items.filter((i) => i.aarId === aar.id || i.aarId === null);
    const byAfi = new Map(planItems.filter((i) => i.afiId).map((i) => [i.afiId!, i.id]));
    const carried = new Set(readPolicy(instance?.policy).suggestedObjectives.filter((s) => s.sourceAarId === aar.id).map((s) => s.afiId));
    const sections = parseSections(aar.sections);
    const afis = sections
      ? listAfis(sections).map((f) => ({
          id: f.id,
          title: f.title,
          observation: f.observation,
          recommendation: f.recommendation,
          capabilityKey: f.capabilityKey,
          objectiveId: f.objectiveId,
          objectiveText: f.objectiveText,
          actionItemId: f.actionItemId && planItems.some((i) => i.id === f.actionItemId) ? f.actionItemId : (byAfi.get(f.id) ?? null),
          rejectedReason: f.rejectedReason,
          status: f.status,
          decision: f.decision?.kind ?? null,
          decisionText: decisionText(f.decision),
          carried: carried.has(f.id),
        }))
      : [];
    const locked = aar.status === "final" || Boolean(newer);
    return NextResponse.json(
      {
        aar: { id: aar.id, exerciseId: aar.exerciseId, version: aar.version, status: aar.status, isLatest: !newer },
        exercise: aar.exercise,
        afis,
        sectionsReadable: Boolean(sections),
        items: planItems,
        options: { objectives: objectives.map(({ id, seq, text }) => ({ id, seq, text })), capabilities },
        canWrite: canWrite && !aar.exercise.isPractice,
        locked,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
