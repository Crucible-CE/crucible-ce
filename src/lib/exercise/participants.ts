// Participants: add signed-in users with exercise roles, change roles, team
// and decision maker, remove. Guests join through src/exercises/join.ts.

import { db, type Tx } from "@/lib/db";
import { revokeGuestSessions } from "@/lib/exercise/auth/guest";
import { bumpVersion } from "@/lib/exercise/runtime/transition";
import { z } from "zod";
import { EXERCISE_ROLES, type ExerciseRole } from "@/lib/exercise/runtime/types";
import { ServiceError } from "./errors";

/** Roles a guest may hold. Guests are never facilitator, controller or evaluator. */
export const GUEST_ROLES: readonly ExerciseRole[] = ["player", "observer", "scribe"];

/** A display name not used yet in this exercise: "Name", then "Name 2", "Name 3"... */
export async function uniqueDisplayName(client: Tx | typeof db, exerciseId: string, base: string): Promise<string> {
  const clean = base.trim().slice(0, 36) || "Participant";
  const taken = new Set(
    (await client.participant.findMany({ where: { exerciseId }, select: { displayName: true } })).map((p) => p.displayName.toLowerCase()),
  );
  if (!taken.has(clean.toLowerCase())) return clean;
  for (let n = 2; n < 1000; n++) {
    const name = `${clean} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
  throw new ServiceError(409, "Could not pick a display name.");
}

export async function assertTeam(client: Tx | typeof db, exerciseId: string, teamId: string | null | undefined): Promise<void> {
  if (!teamId) return;
  const t = await client.team.findFirst({ where: { id: teamId, exerciseId }, select: { id: true } });
  if (!t) throw new ServiceError(400, "That team is not part of this exercise.");
}

function assertOpen(status: string) {
  if (status === "ended" || status === "abandoned") throw new ServiceError(409, "The exercise is over.");
}

export async function addParticipant(
  exerciseId: string,
  input: { userId: string; roles: ExerciseRole[]; teamId?: string | null; isDecisionMaker?: boolean },
): Promise<{ participantId: string; version: number }> {
  const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { status: true } });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  assertOpen(ex.status);
  const user = await db.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, email: true, jobTitle: true, isActive: true } });
  if (!user || !user.isActive) throw new ServiceError(404, "User not found.");

  return db.$transaction(async (tx) => {
    await assertTeam(tx, exerciseId, input.teamId);
    const existing = await tx.participant.findUnique({ where: { exerciseId_userId: { exerciseId, userId: user.id } } });
    let participantId: string;
    if (existing && !existing.removedAt) throw new ServiceError(409, "That person is already in this exercise.");
    if (existing) {
      await tx.participant.update({
        where: { id: existing.id },
        data: { removedAt: null, roles: input.roles, teamId: input.teamId ?? null, isDecisionMaker: input.isDecisionMaker ?? false },
      });
      participantId = existing.id;
    } else {
      const created = await tx.participant.create({
        data: {
          exerciseId,
          userId: user.id,
          displayName: await uniqueDisplayName(tx, exerciseId, user.name || user.email),
          title: user.jobTitle ?? null,
          teamId: input.teamId ?? null,
          roles: input.roles,
          isDecisionMaker: input.isDecisionMaker ?? false,
        },
        select: { id: true },
      });
      participantId = created.id;
    }
    const version = await bumpVersion(tx, exerciseId);
    return { participantId, version };
  });
}

export interface ParticipantChange {
  before: { roles: string[]; teamId: string | null; isDecisionMaker: boolean };
  after: { roles: string[]; teamId: string | null; isDecisionMaker: boolean };
  isGuest: boolean;
  version: number;
}

export async function updateParticipant(
  exerciseId: string,
  input: { participantId: string; roles?: ExerciseRole[]; teamId?: string | null; isDecisionMaker?: boolean; title?: string | null },
): Promise<ParticipantChange> {
  return db.$transaction(async (tx) => {
    const p = await tx.participant.findFirst({ where: { id: input.participantId, exerciseId, removedAt: null } });
    if (!p) throw new ServiceError(404, "Participant not found.");
    const ex = await tx.exercise.findUnique({ where: { id: exerciseId }, select: { status: true } });
    assertOpen(ex?.status ?? "ended");
    if (input.roles && p.isGuest && input.roles.some((r) => !GUEST_ROLES.includes(r))) {
      throw new ServiceError(400, "Guests can be players, observers or scribes.");
    }
    if (input.roles && p.roles.includes("lead_facilitator") && !input.roles.includes("lead_facilitator")) {
      await assertAnotherLead(tx, exerciseId, p.id);
    }
    if (input.teamId !== undefined) await assertTeam(tx, exerciseId, input.teamId);
    const updated = await tx.participant.update({
      where: { id: p.id },
      data: {
        ...(input.roles ? { roles: [...new Set(input.roles)] } : {}),
        ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
        ...(input.isDecisionMaker !== undefined ? { isDecisionMaker: input.isDecisionMaker } : {}),
        ...(input.title !== undefined ? { title: input.title || null } : {}),
      },
    });
    if (isExcuse(p.roles, updated.roles)) {
      await tx.exerciseEvent.create({ data: { exerciseId, type: "participant_excused", data: { participantId: p.id, displayName: p.displayName } } });
    }
    const version = await bumpVersion(tx, exerciseId);
    return {
      before: { roles: p.roles, teamId: p.teamId, isDecisionMaker: p.isDecisionMaker },
      after: { roles: updated.roles, teamId: updated.teamId, isDecisionMaker: updated.isDecisionMaker },
      isGuest: p.isGuest,
      version,
    };
  });
}

async function assertAnotherLead(tx: Tx, exerciseId: string, participantId: string) {
  const others = await tx.participant.count({
    where: { exerciseId, removedAt: null, id: { not: participantId }, roles: { has: "lead_facilitator" } },
  });
  if (others === 0) throw new ServiceError(409, "Keep at least one lead facilitator. Add another one first.");
}

/** Mark removed and revoke guest sessions. Socket eviction is the caller's job (after commit). */
export async function removeParticipant(
  exerciseId: string,
  participantId: string,
): Promise<{ isGuest: boolean; userId: string | null; displayName: string; version: number }> {
  return db.$transaction(async (tx) => {
    const p = await tx.participant.findFirst({ where: { id: participantId, exerciseId, removedAt: null } });
    if (!p) throw new ServiceError(404, "Participant not found.");
    if (p.roles.includes("lead_facilitator")) await assertAnotherLead(tx, exerciseId, p.id);
    await tx.participant.update({ where: { id: p.id }, data: { removedAt: new Date(), leftAt: new Date() } });
    await revokeGuestSessions(p.id, tx);
    await tx.exerciseEvent.create({ data: { exerciseId, type: "participant_removed", data: { participantId: p.id, displayName: p.displayName } } });
    const version = await bumpVersion(tx, exerciseId);
    return { isGuest: p.isGuest, userId: p.userId, displayName: p.displayName, version };
  });
}

/** A player moved to observer: excused from play, no longer a required voter. */
export function isExcuse(before: readonly string[], after: readonly string[]): boolean {
  return before.includes("player") && !after.includes("player") && after.includes("observer");
}

// ---------------------------------------------------------------------------
// Attendance (facilitator-confirmed) and no-device attendees
// ---------------------------------------------------------------------------

export const ATTENDANCE = ["attended", "partial", "absent"] as const;
export type Attendance = (typeof ATTENDANCE)[number];

export const setAttendanceSchema = z
  .object({ participantId: z.string().trim().min(1).max(64), attendance: z.enum(ATTENDANCE).nullable() })
  .strict();

export const addAttendeeSchema = z
  .object({
    displayName: z.string().trim().min(1, "Enter a name.").max(60, "Use 60 characters or fewer."),
    title: z.string().trim().max(120).nullable().optional(),
    organization: z.string().trim().max(200).nullable().optional(),
    teamId: z.string().trim().min(1).max(64).nullable().optional(),
    roles: z.array(z.enum(EXERCISE_ROLES)).min(1, "Pick at least one role.").max(6),
    attendance: z.enum(["attended", "partial"]).default("attended"),
  })
  .strict();

export interface AttendanceRow {
  id: string;
  displayName: string;
  title: string | null;
  organization: string | null;
  teamId: string | null;
  roles: string[];
  isGuest: boolean;
  noDevice: boolean;
  joinedAt: string | null;
  leftAt: string | null;
  attendance: Attendance | null;
}

/** Statuses where attendance can be confirmed: during play and after ENDEX. */
const ATTENDANCE_STATUSES = ["live", "paused", "ended"];

/** Attendance locks with the report: review freezes it, final locks it. */
async function assertAttendanceOpen(exerciseId: string, client: Tx | typeof db): Promise<{ status: string }> {
  const ex = await client.exercise.findUnique({ where: { id: exerciseId }, select: { status: true } });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  if (!ATTENDANCE_STATUSES.includes(ex.status)) throw new ServiceError(409, "Attendance is confirmed during the exercise or after ENDEX.");
  const latest = await client.afterActionReport.findFirst({ where: { exerciseId }, orderBy: { version: "desc" }, select: { status: true } });
  if (latest?.status === "final") throw new ServiceError(409, "The report is final. Amend it to change attendance.");
  if (latest?.status === "review") throw new ServiceError(409, "The report is in review. Move it back to draft to change attendance.");
  return ex;
}

export async function listAttendance(exerciseId: string): Promise<AttendanceRow[]> {
  const rows = await db.participant.findMany({ where: { exerciseId, removedAt: null }, orderBy: { createdAt: "asc" } });
  return rows.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    title: p.title,
    organization: p.organization,
    teamId: p.teamId,
    roles: p.roles,
    isGuest: p.isGuest,
    noDevice: p.noDevice,
    joinedAt: p.joinedAt?.toISOString() ?? null,
    leftAt: p.leftAt?.toISOString() ?? null,
    attendance: (ATTENDANCE as readonly string[]).includes(p.attendance ?? "") ? (p.attendance as Attendance) : null,
  }));
}

export async function setAttendance(exerciseId: string, participantId: string, attendance: Attendance | null): Promise<{ before: string | null; version: number }> {
  return db.$transaction(async (tx) => {
    await assertAttendanceOpen(exerciseId, tx);
    const p = await tx.participant.findFirst({ where: { id: participantId, exerciseId, removedAt: null }, select: { id: true, attendance: true } });
    if (!p) throw new ServiceError(404, "Participant not found.");
    await tx.participant.update({ where: { id: p.id }, data: { attendance } });
    const version = await bumpVersion(tx, exerciseId);
    return { before: p.attendance, version };
  });
}

/** A person who took part without a device: a participant row with no user and no guest session. After ENDEX only. */
export async function addNoDeviceAttendee(
  exerciseId: string,
  input: { displayName: string; title?: string | null; organization?: string | null; teamId?: string | null; roles: ExerciseRole[]; attendance: "attended" | "partial" },
): Promise<{ participantId: string; version: number }> {
  return db.$transaction(async (tx) => {
    const ex = await assertAttendanceOpen(exerciseId, tx);
    if (ex.status !== "ended") throw new ServiceError(409, "Add people without a device after ENDEX.");
    await assertTeam(tx, exerciseId, input.teamId);
    const created = await tx.participant.create({
      data: {
        exerciseId,
        userId: null,
        isGuest: false,
        noDevice: true,
        displayName: await uniqueDisplayName(tx, exerciseId, input.displayName),
        title: input.title || null,
        organization: input.organization || null,
        teamId: input.teamId ?? null,
        roles: [...new Set(input.roles)],
        attendance: input.attendance,
      },
      select: { id: true },
    });
    const version = await bumpVersion(tx, exerciseId);
    return { participantId: created.id, version };
  });
}
