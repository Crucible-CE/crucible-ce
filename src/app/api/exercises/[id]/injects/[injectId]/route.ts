// PATCH /api/exercises/{id}/injects/{injectId} {controllerNotes}: MSEL notes (control).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseJsonBody } from "@/lib/http/parse-body";
import { notifyChanged } from "@/lib/exercise/runtime/engine";
import { requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { ServiceError, withErrors } from "@/lib/exercise/errors";
import { injectNotesSchema } from "@/lib/exercise/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; injectId: string }> }) {
  return withErrors(async () => {
    const { id, injectId } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    await requireAccess(id, principal, "control");
    const parsed = await parseJsonBody(req, injectNotesSchema);
    if (!parsed.ok) return parsed.response;
    const res = await db.inject.updateMany({
      where: { id: injectId, exerciseId: id },
      data: { controllerNotes: parsed.data.controllerNotes?.trim() || null },
    });
    if (res.count !== 1) throw new ServiceError(404, "Inject not found.");
    notifyChanged(id, undefined, "control");
    return NextResponse.json({ ok: true });
  });
}
