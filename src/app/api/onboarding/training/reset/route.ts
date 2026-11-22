import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { resetTrainingIncident } from "@/lib/incident/training";

// POST /api/onboarding/training/reset: delete the signed-in member's training
// incident so they can start again. Idempotent: nothing to reset is not an error.
export async function POST() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const deleted = await resetTrainingIncident(user.id);
  return NextResponse.json({ deleted });
}
