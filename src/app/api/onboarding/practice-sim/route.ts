// POST /api/onboarding/practice-sim: launch the library practice Crisis Sim
// for the signed-in member alone (onboarding, Your setup), or return their
// unfinished one. Members who can create exercises only.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { requirePermission } from "@/lib/exercise/auth/session";
import { withErrors } from "@/lib/exercise/errors";
import { launchPracticeSim } from "@/lib/onboarding/practice-sim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await requirePermission("exercises.create");
  if (!a.ok) return a.response;
  return withErrors(async () => {
    const { id, created } = await launchPracticeSim(a.user);
    if (created) {
      audit({ actorUserId: a.user.id, action: "exercise.created", targetType: "Exercise", targetId: id, data: { mode: "crisissim", practice: true, source: "onboarding" }, req });
    }
    return NextResponse.json({ exerciseId: id, created }, { status: created ? 201 : 200 });
  });
}
