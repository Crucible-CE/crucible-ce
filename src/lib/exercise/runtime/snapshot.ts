// Load an exercise into the plain-data snapshot that modes read.

import { db, type Tx } from "@/lib/db";
import { getMode } from "@/lib/exercise/modes/registry";
import type {
  AdvancePolicy,
  ExerciseMode,
  ExerciseRole,
  ExerciseSnapshot,
  ExerciseStatus,
  InjectRow,
  InjectSource,
  InjectStatus,
  Mode,
  ParticipantRow,
  ResponseKind,
  ResponseRow,
  ScoreRow,
  SourceDocumentData,
  TemplateData,
} from "./types";

type Client = Tx | typeof db;

export class NotFoundError extends Error {
  status = 404;
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

const injectSelect = {
  id: true,
  seq: true,
  status: true,
  source: true,
  title: true,
  scenarioTime: true,
  targetTeamIds: true,
  content: true,
  secret: true,
  templateInjectId: true,
  budgetMs: true,
  openedAt: true,
  closesAt: true,
  closedAt: true,
  closeTrigger: true,
} as const;

export function toInjectRow(r: {
  id: string;
  seq: number;
  status: string;
  source: string;
  title: string;
  scenarioTime: Date | null;
  targetTeamIds: string[];
  content: unknown;
  secret: unknown;
  templateInjectId: string | null;
  budgetMs: number | null;
  openedAt: Date | null;
  closesAt: Date | null;
  closedAt: Date | null;
  closeTrigger: string | null;
}): InjectRow {
  return { ...r, status: r.status as InjectStatus, source: r.source as InjectSource };
}

export function toResponseRow(r: {
  id: string;
  injectId: string;
  participantId: string;
  teamId: string | null;
  kind: string;
  payload: unknown;
  status: string;
  createdAt: Date;
}): ResponseRow {
  return { ...r, kind: r.kind as ResponseKind };
}

export function toParticipantRow(p: {
  id: string;
  userId: string | null;
  displayName: string;
  title: string | null;
  teamId: string | null;
  roles: string[];
  isDecisionMaker: boolean;
  isGuest: boolean;
  joinedAt: Date | null;
  leftAt: Date | null;
  removedAt: Date | null;
}): ParticipantRow {
  return { ...p, roles: p.roles as ExerciseRole[] };
}

export async function loadSnapshot(
  client: Client,
  exerciseId: string,
): Promise<{ snapshot: ExerciseSnapshot; mode: ExerciseMode }> {
  const ex = await client.exercise.findUnique({
    where: { id: exerciseId },
    include: {
      teams: { orderBy: { seq: "asc" } },
      participants: { orderBy: { createdAt: "asc" } },
      injects: { orderBy: { seq: "asc" }, select: injectSelect },
      scoreState: true,
    },
  });
  if (!ex) throw new NotFoundError("Exercise not found");

  const mode = getMode(ex.mode as Mode);

  let template: TemplateData | null = null;
  if (ex.templateId) {
    const t = await client.exerciseTemplate.findUnique({
      where: { id: ex.templateId },
      include: { injects: { orderBy: { seq: "asc" } }, branches: true },
    });
    if (t) {
      template = {
        id: t.id,
        mode: t.mode as Mode,
        config: t.config,
        branching: t.branching === "branched" ? "branched" : "linear",
        injects: t.injects.map((i) => ({
          id: i.id,
          nodeId: i.nodeId,
          seq: i.seq,
          title: i.title,
          scenarioOffsetMin: i.scenarioOffsetMin,
          plannedDelayMin: i.plannedDelayMin,
          targetTeams: i.targetTeams,
          expectedActions: i.expectedActions,
          objectiveKeys: i.objectiveKeys,
          content: i.content,
          secret: i.secret,
        })),
        branches: t.branches.map((b) => ({
          id: b.id,
          fromNodeId: b.fromNodeId,
          toNodeId: b.toNodeId,
          condition: b.condition,
          priority: b.priority,
        })),
      };
    }
  }

  let document: SourceDocumentData | null = null;
  if (ex.sourceDocumentId) {
    const d = await client.sourceDocument.findUnique({ where: { id: ex.sourceDocumentId } });
    if (d) {
      document = {
        id: d.id,
        kind: d.kind,
        title: d.title,
        text: d.text,
        sha256: d.sha256,
        sections: Array.isArray(d.sections) ? (d.sections as SourceDocumentData["sections"]) : [],
      };
    }
  }

  const score: ScoreRow | null = ex.scoreState
    ? {
        path: ex.scoreState.path,
        cumulative: ex.scoreState.cumulative,
        teamScores: (ex.scoreState.teamScores ?? {}) as Record<string, unknown>,
      }
    : null;

  const parsedConfig = mode.configSchema.safeParse(ex.config);

  const snapshot: ExerciseSnapshot = {
    exercise: {
      id: ex.id,
      mode: ex.mode as Mode,
      title: ex.title,
      status: ex.status as ExerciseStatus,
      stateVersion: ex.stateVersion,
      config: ex.config,
      secret: ex.secret,
      templateId: ex.templateId,
      sourceDocumentId: ex.sourceDocumentId,
      currentInjectId: ex.currentInjectId,
      scenarioStartAt: ex.scenarioStartAt,
      timeboxMin: ex.timeboxMin,
      injectBudget: ex.injectBudget,
      advancePolicy: ex.advancePolicy as AdvancePolicy,
      startedAt: ex.startedAt,
      pausedAt: ex.pausedAt,
      pausedMsTotal: ex.pausedMsTotal,
      endedAt: ex.endedAt,
      endReason: ex.endReason,
      isPractice: ex.isPractice,
    },
    config: parsedConfig.success ? parsedConfig.data : ex.config,
    teams: ex.teams.map((t) => ({ id: t.id, name: t.name, seq: t.seq })),
    participants: ex.participants.map(toParticipantRow),
    injects: ex.injects.map(toInjectRow),
    score,
    template,
    document,
  };
  return { snapshot, mode };
}

/** Active participants: not removed. */
export function activeParticipants(snapshot: ExerciseSnapshot): ParticipantRow[] {
  return snapshot.participants.filter((p) => !p.removedAt);
}

export function currentInject(snapshot: ExerciseSnapshot): InjectRow | null {
  const id = snapshot.exercise.currentInjectId;
  return id ? (snapshot.injects.find((i) => i.id === id) ?? null) : null;
}
