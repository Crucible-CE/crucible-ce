// GET    /api/exercises/{id}/participants?q=   users to add (driver)
// POST   /api/exercises/{id}/participants      {userId, roles, teamId?, isDecisionMaker?}
// PATCH  /api/exercises/{id}/participants      {participantId, roles?, teamId?, isDecisionMaker?, title?}
// DELETE /api/exercises/{id}/participants      {participantId}
// Drivers only. Removal revokes guest sessions and disconnects the person's sockets.
// Excusing a player (PATCH roles without "player", with "observer") is audited
// as participant.excused; they stop counting as a required voter at once.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { closeIfResponsesComplete, notifyChanged } from "@/lib/exercise/runtime/engine";
import { disconnectParticipant, disconnectUserSockets } from "@/lib/exercise/socket/emit";
import { actorOf, requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { revokeParticipantSockets } from "@/lib/exercise/notify";
import { addParticipant, isExcuse, removeParticipant, updateParticipant } from "@/lib/exercise/participants";
import { addParticipantSchema, removeParticipantSchema, updateParticipantSchema } from "@/lib/exercise/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    await requireAccess(id, principal, "driver");
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
    const inExercise = await db.participant.findMany({ where: { exerciseId: id, removedAt: null, userId: { not: null } }, select: { userId: true } });
    const me = principal.kind === "user" ? await db.user.findUnique({ where: { id: principal.userId }, select: { organizationId: true } }) : null;
    const orgId = me?.organizationId ?? null;
    const rows = await db.user.findMany({
      where: {
        isActive: true,
        ...(orgId ? { organizationId: orgId } : {}),
        id: { notIn: inExercise.map((p) => p.userId!) },
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: { name: "asc" },
      take: 20,
      select: { id: true, name: true, email: true, jobTitle: true },
    });
    const users = rows.map(({ jobTitle, ...u }) => ({ ...u, title: jobTitle }));
    return NextResponse.json({ users }, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(id, principal, "driver");
    const parsed = await parseJsonBody(req, addParticipantSchema);
    if (!parsed.ok) return parsed.response;
    const res = await addParticipant(id, parsed.data);
    const actor = actorOf(principal, participant);
    audit({
      actorUserId: actor.userId,
      actorParticipantId: actor.participantId,
      action: "participant.added",
      targetType: "Participant",
      targetId: res.participantId,
      data: { exerciseId: id, userId: parsed.data.userId, roles: parsed.data.roles, teamId: parsed.data.teamId ?? null },
      req,
    });
    notifyChanged(id, res.version);
    return NextResponse.json({ ok: true, participantId: res.participantId }, { status: 201 });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(id, principal, "driver");
    const parsed = await parseJsonBody(req, updateParticipantSchema);
    if (!parsed.ok) return parsed.response;
    const change = await updateParticipant(id, parsed.data);
    const actor = actorOf(principal, participant);
    const rolesChanged = change.before.roles.join(",") !== change.after.roles.join(",");
    audit({
      actorUserId: actor.userId,
      actorParticipantId: actor.participantId,
      action: isExcuse(change.before.roles, change.after.roles) ? "participant.excused" : rolesChanged ? "participant.roles_changed" : "participant.updated",
      targetType: "Participant",
      targetId: parsed.data.participantId,
      data: { exerciseId: id, before: change.before, after: change.after },
      req,
    });
    // A narrowed grant (team change, demotion) applies on the next room join:
    // disconnect so the client rejoins with the right team room.
    if (rolesChanged || change.before.teamId !== change.after.teamId) {
      const row = await db.participant.findUnique({ where: { id: parsed.data.participantId }, select: { userId: true } });
      if (row?.userId) disconnectUserSockets(row.userId);
      else disconnectParticipant(parsed.data.participantId);
    }
    notifyChanged(id, change.version);
    // Fewer required voters may mean everyone left has voted.
    await closeIfResponsesComplete(id).catch((err) => console.error(`[exercises] completion check failed for ${id}:`, err));
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(id, principal, "driver");
    const parsed = await parseJsonBody(req, removeParticipantSchema);
    if (!parsed.ok) return parsed.response;
    const removed = await removeParticipant(id, parsed.data.participantId);
    revokeParticipantSockets(id, parsed.data.participantId);
    await closeIfResponsesComplete(id).catch((err) => console.error(`[exercises] completion check failed for ${id}:`, err));
    const actor = actorOf(principal, participant);
    audit({
      actorUserId: actor.userId,
      actorParticipantId: actor.participantId,
      action: "participant.removed",
      targetType: "Participant",
      targetId: parsed.data.participantId,
      data: { exerciseId: id, guest: removed.isGuest, displayName: removed.displayName },
      req,
    });
    notifyChanged(id, removed.version);
    return NextResponse.json({ ok: true });
  });
}
