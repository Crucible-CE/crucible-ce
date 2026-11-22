// Evaluator observations. Never in a player projection.
//
// Control (lead facilitator, controller, evaluator) reads all and adds any
// kind, during play and after ENDEX. Scribes add kind "observation" and read
// their own. Authors edit and delete their own; a delete is hard and the
// route writes an audit record with the deleted text.

import { db } from "@/lib/db";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { ServiceError } from "./errors";

export interface ObservationItem {
  id: string;
  kind: string;
  text: string;
  at: Date;
  author: string | null;
  authorParticipantId: string | null;
  injectId: string | null;
  injectSeq: number | null;
  injectTitle: string | null;
  objectiveId: string | null;
  objectiveText: string | null;
  capabilityId: string | null;
  capabilityName: string | null;
}

export interface ObservationOptions {
  injects: Array<{ id: string; seq: number; title: string }>;
  objectives: Array<{ id: string; seq: number; text: string }>;
  capabilities: Array<{ id: string; key: string; name: string }>;
}

/** Who may do what with observations. */
export type ObservationRole = "control" | "scribe";

export async function listObservations(exerciseId: string, opts: { authorParticipantId?: string | null } = {}): Promise<ObservationItem[]> {
  const rows = await db.observation.findMany({
    where: { exerciseId, ...(opts.authorParticipantId !== undefined ? { authorParticipantId: opts.authorParticipantId ?? "\u0000" } : {}) },
    orderBy: { at: "desc" },
    take: 500,
    include: {
      author: { select: { displayName: true } },
      objective: { select: { text: true } },
      capability: { select: { name: true } },
    },
  });
  const injectIds = [...new Set(rows.map((r) => r.injectId).filter((x): x is string => Boolean(x)))];
  const injects = injectIds.length
    ? await db.inject.findMany({ where: { id: { in: injectIds } }, select: { id: true, seq: true, title: true } })
    : [];
  const byId = new Map(injects.map((i) => [i.id, i]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    at: r.at,
    author: r.author?.displayName ?? null,
    authorParticipantId: r.authorParticipantId,
    injectId: r.injectId,
    injectSeq: r.injectId ? (byId.get(r.injectId)?.seq ?? null) : null,
    injectTitle: r.injectId ? (byId.get(r.injectId)?.title ?? null) : null,
    objectiveId: r.objectiveId,
    objectiveText: r.objective?.text ?? null,
    capabilityId: r.capabilityId,
    capabilityName: r.capability?.name ?? null,
  }));
}

/** What an observation can link to: delivered injects, objectives, capabilities. */
export async function observationOptions(exerciseId: string): Promise<ObservationOptions> {
  const [injects, objectives, instance] = await Promise.all([
    db.inject.findMany({ where: { exerciseId, status: { in: ["open", "closed"] } }, orderBy: { seq: "asc" }, select: { id: true, seq: true, title: true } }),
    db.objective.findMany({ where: { exerciseId }, orderBy: { seq: "asc" }, select: { id: true, seq: true, text: true, capabilityIds: true } }),
    getExerciseSettings(),
  ]);
  const used = [...new Set(objectives.flatMap((o) => o.capabilityIds))];
  const capabilities = await db.capability.findMany({
    where: { OR: [{ framework: instance?.capabilityFramework ?? "nist-csf", isActive: true }, { id: { in: used } }] },
    orderBy: [{ framework: "asc" }, { seq: "asc" }],
    select: { id: true, key: true, name: true },
  });
  return { injects, objectives: objectives.map(({ id, seq, text }) => ({ id, seq, text })), capabilities };
}

async function checkLinks(exerciseId: string, input: { injectId?: string | null; objectiveId?: string | null; capabilityId?: string | null }) {
  if (input.injectId) {
    const i = await db.inject.findFirst({ where: { id: input.injectId, exerciseId, status: { in: ["open", "closed"] } }, select: { id: true } });
    if (!i) throw new ServiceError(400, "Link a delivered inject from this exercise.");
  }
  if (input.objectiveId) {
    const o = await db.objective.findFirst({ where: { id: input.objectiveId, exerciseId }, select: { id: true } });
    if (!o) throw new ServiceError(400, "That objective is not part of this exercise.");
  }
  if (input.capabilityId) {
    const c = await db.capability.findUnique({ where: { id: input.capabilityId }, select: { id: true } });
    if (!c) throw new ServiceError(400, "That capability does not exist.");
  }
}

function checkKind(role: ObservationRole, kind: string | undefined) {
  if (role === "scribe" && kind !== undefined && kind !== "observation") {
    throw new ServiceError(403, "Scribes record observations only. Ask an evaluator to mark strengths and areas for improvement.");
  }
}

export async function addObservation(
  exerciseId: string,
  authorParticipantId: string | null,
  input: { text: string; kind: string; injectId?: string | null; objectiveId?: string | null; capabilityId?: string | null },
  role: ObservationRole = "control",
): Promise<string> {
  checkKind(role, input.kind);
  await checkLinks(exerciseId, input);
  const row = await db.observation.create({
    data: {
      exerciseId,
      authorParticipantId,
      text: input.text,
      kind: input.kind,
      injectId: input.injectId ?? null,
      objectiveId: input.objectiveId ?? null,
      capabilityId: input.capabilityId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

async function ownObservation(exerciseId: string, id: string, participantId: string | null) {
  const row = await db.observation.findFirst({ where: { id, exerciseId } });
  if (!row) throw new ServiceError(404, "Observation not found.");
  if (!participantId || row.authorParticipantId !== participantId) throw new ServiceError(403, "You can change only your own observations.");
  return row;
}

export async function updateObservation(
  exerciseId: string,
  participantId: string | null,
  input: { id: string; text?: string; kind?: string; injectId?: string | null; objectiveId?: string | null; capabilityId?: string | null },
  role: ObservationRole = "control",
): Promise<{ before: { text: string; kind: string } }> {
  const row = await ownObservation(exerciseId, input.id, participantId);
  checkKind(role, input.kind);
  await checkLinks(exerciseId, input);
  await db.observation.update({
    where: { id: row.id },
    data: {
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.injectId !== undefined ? { injectId: input.injectId } : {}),
      ...(input.objectiveId !== undefined ? { objectiveId: input.objectiveId } : {}),
      ...(input.capabilityId !== undefined ? { capabilityId: input.capabilityId } : {}),
    },
  });
  return { before: { text: row.text, kind: row.kind } };
}

/** Hard delete. Returns the deleted row's fields for the audit record. */
export async function deleteObservation(
  exerciseId: string,
  participantId: string | null,
  id: string,
): Promise<{ text: string; kind: string; injectId: string | null; objectiveId: string | null; at: Date }> {
  const row = await ownObservation(exerciseId, id, participantId);
  await db.observation.delete({ where: { id: row.id } });
  return { text: row.text, kind: row.kind, injectId: row.injectId, objectiveId: row.objectiveId, at: row.at };
}
