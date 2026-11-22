// GET   /api/exercises/{id}/participants/attendance   control: {participants: AttendanceRow[], canEdit, ended}
// PATCH /api/exercises/{id}/participants/attendance   driver: {participantId, attendance: attended|partial|absent|null}
// POST  /api/exercises/{id}/participants/attendance   driver, after ENDEX: {displayName, title?, organization?, teamId?, roles, attendance}
//   Adds a person who took part without a device: no user, no guest session.
// Attendance is confirmed during play and after ENDEX, and locks with the report (review, final).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { notifyChanged } from "@/lib/exercise/runtime/engine";
import { actorOf, requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { addAttendeeSchema, addNoDeviceAttendee, listAttendance, setAttendance, setAttendanceSchema } from "@/lib/exercise/participants";
import { syncRosterIntoAar } from "@/lib/exercise/aar/roster-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function syncReport(exerciseId: string) {
  await syncRosterIntoAar(exerciseId).catch((err) => console.error(`[attendance] report roster refresh failed for ${exerciseId}:`, err));
}

export async function GET(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { viewer } = await requireAccess(id, principal, "control");
    const [participants, ex, latest] = await Promise.all([
      listAttendance(id),
      db.exercise.findUnique({ where: { id }, select: { status: true } }),
      db.afterActionReport.findFirst({ where: { exerciseId: id }, orderBy: { version: "desc" }, select: { status: true } }),
    ]);
    const open = ["live", "paused", "ended"].includes(ex?.status ?? "") && latest?.status !== "review" && latest?.status !== "final";
    return NextResponse.json(
      { participants, canEdit: viewer.isDriver && open, ended: ex?.status === "ended" },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(id, principal, "driver");
    const parsed = await parseJsonBody(req, setAttendanceSchema);
    if (!parsed.ok) return parsed.response;
    const res = await setAttendance(id, parsed.data.participantId, parsed.data.attendance);
    const actor = actorOf(principal, participant);
    audit({
      actorUserId: actor.userId,
      actorParticipantId: actor.participantId,
      action: "participant.attendance_set",
      targetType: "Participant",
      targetId: parsed.data.participantId,
      data: { exerciseId: id, before: res.before, after: parsed.data.attendance },
      req,
    });
    await syncReport(id);
    notifyChanged(id, res.version, "control");
    return NextResponse.json({ ok: true });
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(id, principal, "driver");
    const parsed = await parseJsonBody(req, addAttendeeSchema);
    if (!parsed.ok) return parsed.response;
    const res = await addNoDeviceAttendee(id, parsed.data);
    const actor = actorOf(principal, participant);
    audit({
      actorUserId: actor.userId,
      actorParticipantId: actor.participantId,
      action: "participant.attendee_added",
      targetType: "Participant",
      targetId: res.participantId,
      data: { exerciseId: id, displayName: parsed.data.displayName, roles: parsed.data.roles, attendance: parsed.data.attendance, noDevice: true },
      req,
    });
    await syncReport(id);
    notifyChanged(id, res.version);
    return NextResponse.json({ ok: true, participantId: res.participantId }, { status: 201 });
  });
}
