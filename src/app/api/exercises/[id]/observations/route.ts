// GET    /api/exercises/{id}/observations   {observations, options, canEdit}
// POST   /api/exercises/{id}/observations   {text, kind, injectId?, objectiveId?, capabilityId?}
// PATCH  /api/exercises/{id}/observations   {id, text?, kind?, injectId?, objectiveId?, capabilityId?} (own only)
// DELETE /api/exercises/{id}/observations   {id} (own only; hard delete, audited with the text)
// Control reads all and writes any kind, also after ENDEX. Scribes (signed-in
// users) write kind "observation" and read their own. Hidden from players.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { notifyChanged } from "@/lib/exercise/runtime/engine";
import { AccessError } from "@/lib/exercise/runtime/view";
import { actorOf, requestPrincipal, requireAccess, type Principal } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import {
  addObservation,
  deleteObservation,
  listObservations,
  observationOptions,
  updateObservation,
  type ObservationRole,
} from "@/lib/exercise/observations";
import { observationDeleteSchema, observationSchema, observationUpdateSchema } from "@/lib/exercise/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function access(id: string, req: Request): Promise<{ principal: Principal; participantId: string | null; role: ObservationRole; actor: ReturnType<typeof actorOf> }> {
  const principal = await requestPrincipal(req, { allowGuest: false });
  const { participant, viewer } = await requireAccess(id, principal, "any");
  const actor = actorOf(principal, participant);
  if (viewer.isControl) return { principal, participantId: participant?.id ?? null, role: "control", actor };
  if (participant?.roles.includes("scribe")) return { principal, participantId: participant.id, role: "scribe", actor };
  throw new AccessError(403, "Only the control team and scribes can record observations.");
}

export async function GET(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await access(id, req);
    const [observations, options] = await Promise.all([
      listObservations(id, a.role === "scribe" ? { authorParticipantId: a.participantId } : {}),
      observationOptions(id),
    ]);
    return NextResponse.json(
      { observations, options, me: a.participantId, role: a.role },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await access(id, req);
    const parsed = await parseJsonBody(req, observationSchema);
    if (!parsed.ok) return parsed.response;
    const obsId = await addObservation(id, a.participantId, parsed.data, a.role);
    audit({
      actorUserId: a.actor.userId,
      actorParticipantId: a.actor.participantId,
      action: "observation.added",
      targetType: "Exercise",
      targetId: id,
      data: { observationId: obsId, kind: parsed.data.kind },
      req,
    });
    notifyChanged(id, undefined, "control");
    return NextResponse.json({ id: obsId }, { status: 201 });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await access(id, req);
    const parsed = await parseJsonBody(req, observationUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const res = await updateObservation(id, a.participantId, parsed.data, a.role);
    audit({
      actorUserId: a.actor.userId,
      actorParticipantId: a.actor.participantId,
      action: "observation.edited",
      targetType: "Exercise",
      targetId: id,
      data: { observationId: parsed.data.id, before: res.before },
      req,
    });
    notifyChanged(id, undefined, "control");
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await access(id, req);
    const parsed = await parseJsonBody(req, observationDeleteSchema);
    if (!parsed.ok) return parsed.response;
    const removed = await deleteObservation(id, a.participantId, parsed.data.id);
    audit({
      actorUserId: a.actor.userId,
      actorParticipantId: a.actor.participantId,
      action: "observation.deleted",
      targetType: "Exercise",
      targetId: id,
      data: { observationId: parsed.data.id, ...removed, at: removed.at.toISOString() },
      req,
    });
    notifyChanged(id, undefined, "control");
    return NextResponse.json({ ok: true });
  });
}
