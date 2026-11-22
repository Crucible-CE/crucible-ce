import { NextResponse } from "next/server";
import { findAccessibleIncident } from "@/lib/incident/access";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { readEvidence } from "@/lib/evidence/storage";

interface RouteContext {
  params: Promise<{ id: string; evidenceId: string }>;
}

// GET /api/incidents/[id]/evidence/[evidenceId]/verify — re-hash the stored
// bytes and compare to the recorded SHA-256. Logs a custody "verify" access.
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, evidenceId } = await context.params;
  const orgId = session.user.organizationId;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ev = await db.incidentEvidence.findFirst({
    where: { id: evidenceId, incidentId: id, organizationId: orgId },
    select: { id: true, sha256: true },
  });
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readEvidence(orgId, id, ev.id);
  } catch {
    return NextResponse.json({ error: "File missing from storage", intact: false }, { status: 410 });
  }

  const actual = createHash("sha256").update(bytes).digest("hex");
  const intact = actual === ev.sha256;

  try {
    await db.incidentEvidenceAccess.create({
      data: { evidenceId: ev.id, userId: session.user.id, userName: session.user.name ?? null, action: "verify" },
    });
  } catch {
    // non-fatal
  }

  return NextResponse.json({ intact, expected: ev.sha256, actual });
}
