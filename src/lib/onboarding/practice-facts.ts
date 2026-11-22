// Facts behind the four practice steps of Your setup (lib/onboarding/steps):
// the training incident, the practice Crisis Sim, the organization's own IR
// playbook and its first scheduled exercise. Each step shows only to members
// whose role can complete it.

import { db } from "@/lib/db";
import { hasPermission as hasCePermission } from "@/lib/auth/rbac";
import { exerciseRoleFor, hasPermission as hasExercisePermission } from "@/lib/exercise/auth/rbac";
import { PRACTICE_TEMPLATE_ID } from "@/lib/exercise/templates/crisissim-seed-data";
import { findTrainingIncident } from "@/lib/incident/training";

export interface TrainingFacts {
  incidentId: string;
  /** The member opened the war room (presence heartbeat). */
  opened: boolean;
  /** The member added a task or proposed an action (ledger). */
  worked: boolean;
  /** The member posted a status update. */
  statusUpdate: boolean;
}

export interface PracticeFacts {
  /** Can work incidents (training incident). */
  canIncidents: boolean;
  /** Can create exercises (practice sim, schedule). */
  canExercises: boolean;
  /** Can add documents (IR playbook). */
  canDocuments: boolean;
  training: TrainingFacts | null;
  /** The member's latest unfinished practice run, to reopen. */
  practiceSimOpenId: string | null;
  /** A practice Crisis Sim the member took part in reached ENDEX. */
  practiceSimEnded: boolean;
  /** Playbook documents the organization added (not library copies left as is). */
  localPlaybooks: number;
  schedules: number;
}

async function loadTrainingFacts(userId: string): Promise<TrainingFacts | null> {
  const incident = await findTrainingIncident(userId);
  if (!incident) return null;
  const incidentId = incident.id;
  const [presence, task, action, update] = await Promise.all([
    db.incidentPresence.findFirst({ where: { incidentId, userId }, select: { id: true } }),
    db.incidentLedgerEntry.findFirst({
      where: { incidentId, actorUserId: userId, eventType: "task_updated", payloadJson: { path: ["kind"], equals: "created" } },
      select: { id: true },
    }),
    db.incidentLedgerEntry.findFirst({ where: { incidentId, actorUserId: userId, eventType: "action_proposed" }, select: { id: true } }),
    db.incidentStatusUpdate.findFirst({ where: { incidentId, publishedById: userId }, select: { id: true } }),
  ]);
  return { incidentId, opened: !!presence, worked: !!task || !!action, statusUpdate: !!update };
}

export async function loadPracticeFacts(user: { id: string; organizationId: string; role?: string | null }): Promise<PracticeFacts> {
  const ceUser = { id: user.id, role: user.role ?? undefined };
  const exUser = { id: user.id, role: exerciseRoleFor(user.role) };
  const canIncidents = hasCePermission(ceUser, "incidents.edit");
  const canExercises = hasExercisePermission(exUser, "exercises.create");
  const canDocuments = hasExercisePermission(exUser, "documents.manage");

  const [training, openRun, ended, localPlaybooks, schedules] = await Promise.all([
    canIncidents ? loadTrainingFacts(user.id) : Promise.resolve(null),
    canExercises
      ? db.exercise.findFirst({
          where: { isPractice: true, templateId: PRACTICE_TEMPLATE_ID, createdById: user.id, status: { notIn: ["ended", "abandoned"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      : Promise.resolve(null),
    canExercises
      ? db.exercise.findFirst({
          where: { isPractice: true, mode: "crisissim", status: "ended", participants: { some: { userId: user.id, removedAt: null } } },
          select: { id: true },
        })
      : Promise.resolve(null),
    canDocuments ? db.sourceDocument.count({ where: { organizationId: user.organizationId, scope: "local", kind: "playbook" } }) : Promise.resolve(0),
    canExercises ? db.exerciseSchedule.count({ where: { organizationId: user.organizationId } }) : Promise.resolve(0),
  ]);

  return {
    canIncidents,
    canExercises,
    canDocuments,
    training,
    practiceSimOpenId: openRun?.id ?? null,
    practiceSimEnded: !!ended,
    localPlaybooks,
    schedules,
  };
}
