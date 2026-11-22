import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { provisionTrainingIncident } from "@/lib/incident/training";

// POST /api/onboarding/training/provision: open the signed-in member's
// training incident (one per member, idempotent) and return its id. Members
// who can work incidents only; the sandbox reaches no one (lib/incident/training).
export async function POST() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, created } = await provisionTrainingIncident(user.id);
  return NextResponse.json({ incidentId: id, created }, { status: created ? 201 : 200 });
}
