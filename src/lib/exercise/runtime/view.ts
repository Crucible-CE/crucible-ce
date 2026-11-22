// Build what one viewer may see of an exercise. Routes call projectFor and
// return its result; nothing else sends exercise state to a client.

import { db } from "@/lib/db";
import { modePathLabel } from "@/lib/exercise/modes/registry";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { managesAllExercises } from "@/lib/exercise/auth/rbac";
import { loadSnapshot, toResponseRow } from "./snapshot";
import {
  CONTROL_ROLES,
  DRIVER_ROLES,
  type ExerciseSnapshot,
  type ExerciseView,
  type FeedItem,
  type GradeRow,
  type ParticipantRow,
  type PublicPlan,
  type Viewer,
} from "./types";

export type Principal =
  | { kind: "user"; userId: string; accountRole: string }
  | { kind: "guest"; exerciseId: string; participantId: string };

export class AccessError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AccessError";
  }
}

export function viewerFor(
  participants: ParticipantRow[],
  principal: Principal,
  exercise: { id: string; createdById?: string | null },
): Viewer {
  let participant: ParticipantRow | null = null;
  if (principal.kind === "guest") {
    if (principal.exerciseId !== exercise.id) throw new AccessError(403, "No access to this exercise.");
    participant = participants.find((p) => p.id === principal.participantId && !p.removedAt) ?? null;
    if (!participant) throw new AccessError(403, "No access to this exercise.");
    // Guests never get control, whatever roles the row carries.
    return { participant, isControl: false, isDriver: false };
  }
  participant = participants.find((p) => p.userId === principal.userId && !p.removedAt) ?? null;
  const roleControl = Boolean(participant?.roles.some((r) => CONTROL_ROLES.includes(r)));
  const roleDriver = Boolean(participant?.roles.some((r) => DRIVER_ROLES.includes(r)));
  const owner = exercise.createdById === principal.userId;
  const admin = managesAllExercises(principal.accountRole);
  if (!participant && !owner && !admin) throw new AccessError(403, "No access to this exercise.");
  return {
    participant,
    isControl: roleControl || owner || admin,
    isDriver: roleDriver || owner || admin,
  };
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

/** Event types a player or observer may see in the feed. Control sees every type. */
export const PLAYER_FEED_TYPES = [
  "startex",
  "endex",
  "paused",
  "resumed",
  "inject_released",
  "broadcast",
  "path_shift",
  "clock_triggered",
] as const;

/** How many recent events the feed carries. */
export const FEED_LIMIT = 300;

export interface RawEvent {
  id: string;
  type: string;
  at: Date;
  injectId: string | null;
  data: unknown;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Filter and redact exercise events (oldest first) for one viewer. Control
 * gets everything. Players get PLAYER_FEED_TYPES only: broadcasts for
 * everyone or their own team, releases of injects their team can see, and
 * path shifts reduced to the new path's label (never scores). Pure.
 */
export function feedFor(events: RawEvent[], snapshot: ExerciseSnapshot, viewer: Viewer): FeedItem[] {
  if (viewer.isControl) {
    return events.map((e) => ({ id: e.id, type: e.type, at: e.at, data: asRecord(e.data) }));
  }
  const teamId = viewer.participant?.teamId ?? null;
  const allowed = new Set<string>(PLAYER_FEED_TYPES);
  const out: FeedItem[] = [];
  for (const e of events) {
    if (!allowed.has(e.type)) continue;
    const data = asRecord(e.data);
    const item = (d: Record<string, unknown>) => out.push({ id: e.id, type: e.type, at: e.at, data: d });
    switch (e.type) {
      case "broadcast": {
        const target = typeof data.teamId === "string" && data.teamId ? data.teamId : null;
        if (target && target !== teamId) break;
        item({ message: typeof data.message === "string" ? data.message : "", teamId: target });
        break;
      }
      case "inject_released": {
        const inj = e.injectId ? snapshot.injects.find((i) => i.id === e.injectId) : undefined;
        if (!inj || (inj.status !== "open" && inj.status !== "closed")) break;
        if (inj.targetTeamIds.length > 0 && (!teamId || !inj.targetTeamIds.includes(teamId))) break;
        item({ injectId: inj.id, seq: inj.seq, title: inj.title, scenarioTime: inj.scenarioTime?.toISOString() ?? null });
        break;
      }
      case "path_shift": {
        const to = typeof data.to === "string" ? data.to : "";
        item({ to: modePathLabel(snapshot.exercise.mode, to) ?? to });
        break;
      }
      case "clock_triggered":
        item({
          key: typeof data.key === "string" ? data.key : null,
          label: typeof data.label === "string" ? data.label : null,
          deadlineAt: typeof data.deadlineAt === "string" ? data.deadlineAt : null,
        });
        break;
      case "endex":
        item({ reason: typeof data.reason === "string" ? data.reason : null });
        break;
      default:
        // startex, paused, resumed: nothing a player needs beyond the time.
        item({});
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export async function projectFor(exerciseId: string, principal: Principal): Promise<Record<string, unknown>> {
  const { snapshot, mode } = await loadSnapshot(db, exerciseId);
  const meta = await db.exercise.findUnique({ where: { id: exerciseId }, select: { createdById: true, plan: true } });
  const viewer = viewerFor(snapshot.participants, principal, { id: exerciseId, createdById: meta?.createdById });

  const [objectives, responses, grades, closeEvents, recentEvents, clocks, instance] = await Promise.all([
    db.objective.findMany({ where: { exerciseId }, orderBy: { seq: "asc" }, select: { id: true, seq: true, text: true } }),
    db.response.findMany({ where: { exerciseId }, orderBy: { createdAt: "asc" } }),
    db.grade.findMany({ where: { response: { exerciseId } }, orderBy: { createdAt: "asc" } }),
    db.exerciseEvent.findMany({ where: { exerciseId, type: "inject_closed" }, select: { injectId: true, data: true } }),
    db.exerciseEvent.findMany({
      where: viewer.isControl ? { exerciseId } : { exerciseId, type: { in: [...PLAYER_FEED_TYPES] } },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: FEED_LIMIT,
      select: { id: true, type: true, at: true, injectId: true, data: true },
    }),
    db.regulatoryClock.findMany({
      where: { exerciseId },
      orderBy: { key: "asc" },
      select: { key: true, label: true, status: true, triggeredAt: true, deadlineAt: true, metAt: true },
    }),
    getExerciseSettings(),
  ]);

  const closeSummaries: Record<string, Record<string, unknown>> = {};
  for (const ev of closeEvents) {
    if (!ev.injectId) continue;
    const data = (ev.data ?? {}) as { summary?: Record<string, unknown> };
    closeSummaries[ev.injectId] = data.summary ?? {};
  }

  const view: ExerciseView = {
    ...snapshot,
    responses: responses.map(toResponseRow),
    grades: grades.map((g) => ({
      id: g.id,
      responseId: g.responseId,
      source: g.source as GradeRow["source"],
      attempt: g.attempt,
      score: g.score,
      rating: g.rating,
      rationale: g.rationale,
      createdAt: g.createdAt,
    })),
    closeSummaries,
    feed: feedFor([...recentEvents].reverse(), snapshot, viewer),
    clocks,
    plan: publicPlan(meta?.plan, snapshot.template?.config),
    objectives,
    timezone: instance?.timezone ?? "UTC",
    now: new Date(),
  };
  return mode.project(view, viewer);
}

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/**
 * The player brief: plan fields everyone in the exercise may read, plus the
 * template's executive brief. Sponsor, hazard and the objective key map stay
 * out. Pure; tolerant of old or broken JSON.
 */
export function publicPlan(plan: unknown, templateConfig: unknown): PublicPlan {
  const p = asRecord(plan);
  const brief = asRecord(templateConfig).executiveBriefMd;
  return {
    executiveBriefMd: typeof brief === "string" && brief.trim() ? brief.slice(0, 6000) : null,
    scope: text(p.scope, 2000),
    groundRules: text(p.groundRules, 4000),
    assumptions: text(p.assumptions, 4000),
    stopWord: text(p.stopWord, 60),
    noFaultStatement: text(p.noFaultStatement, 2000),
  };
}

/** Resolve the acting participant for a mutation, with role checks. */
export async function actingParticipant(
  exerciseId: string,
  principal: Principal,
): Promise<{ participant: ParticipantRow | null; viewer: Viewer }> {
  const { snapshot } = await loadSnapshot(db, exerciseId);
  const meta = await db.exercise.findUnique({ where: { id: exerciseId }, select: { createdById: true } });
  const viewer = viewerFor(snapshot.participants, principal, { id: exerciseId, createdById: meta?.createdById });
  return { participant: viewer.participant, viewer };
}
