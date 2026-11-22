import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { verifyLedgerAnchored } from "@/lib/ledger/append";

// GET /api/incidents/[id]/ledger/verify — recompute the chain from genesis and
// report integrity (valid / first broken seq). Also checks the head-anchor
// comparison + prior-export cross-check so tail truncation is also detected
// (additive headMatches/truncationSuspected fields). Every entry's keyed HMAC
// (MASTER_KEK-derived) is recomputed and the Ed25519 head signature checked;
// `status` is valid | head_unsigned | key_mismatch | tampered (only "valid"
// has valid=true; key_mismatch = MASTER_KEK or the signing key changed).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await verifyLedgerAnchored(db, id);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
