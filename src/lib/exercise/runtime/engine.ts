// Exercise runtime: start, advance, release, respond, close, pause, resume, end.
// See docs/architecture.md.
//
// Concurrency rules:
// - Each transition is guarded on its own row (transition.ts).
// - closeInject is the only close path. Its first statement flips the inject
//   open -> closed; zero rows means another closer won. Responses are read
//   after that, in the same transaction, so a response either committed before
//   the close (and is scored) or sees `closed` and is rejected.
// - Responding takes FOR SHARE on the open inject row, so the close UPDATE
//   waits for in-flight responses to commit.
// - planInject never runs inside a transaction. advance stores a pending inject
//   (unique on exerciseId+seq, so concurrent advances collapse), then publishes
//   it with a CAS on Exercise.currentInjectId.
// - Socket emits happen after commit.

import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { emitToExercise, SOCKET_EVENTS } from "@/lib/exercise/socket/emit";
import { enqueueJob } from "@/lib/exercise/runtime/jobs/queue";
import { kickWorker } from "@/lib/exercise/runtime/jobs/worker";
import { loadSnapshot, toResponseRow, currentInject, activeParticipants } from "./snapshot";
import { transitionExercise, transitionInject, bumpVersion, TransitionError } from "./transition";
import { scheduleInjectTimer, clearExerciseTimer } from "./timers";
import { runEndHooks } from "./hooks";
import { applyClockUpdates } from "./clocks-db";
import type {
  CloseOutcome,
  CloseTrigger,
  EndReason,
  ExerciseMode,
  ExerciseSnapshot,
  InjectRow,
  ParticipantRow,
  ResponseKind,
} from "./types";
import { ResponseError } from "./types";

export { TransitionError, ResponseError };

export interface Actor {
  userId?: string | null;
  participantId?: string | null;
}

const TX_OPTS = { timeout: 20_000, maxWait: 10_000 } as const;

function json(v: unknown): Prisma.InputJsonValue {
  return (v ?? {}) as Prisma.InputJsonValue;
}

async function addEvent(
  tx: Tx,
  exerciseId: string,
  type: string,
  data: Record<string, unknown>,
  actor?: Actor,
  injectId?: string | null,
): Promise<void> {
  await tx.exerciseEvent.create({
    data: {
      exerciseId,
      type,
      data: json(data),
      actorUserId: actor?.userId ?? null,
      actorParticipantId: actor?.participantId ?? null,
      injectId: injectId ?? null,
    },
  });
}

/** Change notices within this window per exercise and scope go out as one. */
export const NOTIFY_COALESCE_MS = 100;

const pendingNotices = new Map<string, { timer: ReturnType<typeof setTimeout>; version: number | null; unknown: boolean }>();

/**
 * Tell an exercise's sockets that state changed. Coalesced per exercise and
 * scope over NOTIFY_COALESCE_MS so a burst of votes sends one notice. The
 * notice carries the highest stateVersion seen, or null when any call in the
 * window had none (clients then always refetch).
 */
export function notifyChanged(exerciseId: string, stateVersion?: number, scope: "all" | "control" = "all"): void {
  const key = `${exerciseId}:${scope}`;
  const pending = pendingNotices.get(key);
  if (pending) {
    if (stateVersion === undefined || stateVersion === null) pending.unknown = true;
    else pending.version = Math.max(pending.version ?? stateVersion, stateVersion);
    return;
  }
  const entry = {
    version: stateVersion ?? null,
    unknown: stateVersion === undefined || stateVersion === null,
    timer: setTimeout(() => {
      pendingNotices.delete(key);
      emitToExercise(exerciseId, scope, SOCKET_EVENTS.EXERCISE_CHANGED, {
        exerciseId,
        stateVersion: entry.unknown ? null : entry.version,
      });
    }, NOTIFY_COALESCE_MS),
  };
  entry.timer.unref?.();
  pendingNotices.set(key, entry);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export async function startExercise(exerciseId: string, actor: Actor): Promise<void> {
  const { snapshot, mode } = await loadSnapshot(db, exerciseId);
  const now = new Date();
  await db.$transaction(async (tx) => {
    const won = await transitionExercise(tx, exerciseId, ["draft", "lobby"], "live", {
      startedAt: now,
      scenarioStartAt: snapshot.exercise.scenarioStartAt ?? now,
    });
    if (!won) throw new TransitionError(409, "Exercise already started.");
    const initial = mode.initialScore(snapshot);
    if (initial) {
      await tx.scoreState.upsert({
        where: { exerciseId },
        create: { exerciseId, path: initial.path, cumulative: initial.cumulative, teamScores: json(initial.teamScores) },
        update: { path: initial.path, cumulative: initial.cumulative, teamScores: json(initial.teamScores) },
      });
    }
    await addEvent(tx, exerciseId, "startex", { at: now.toISOString() }, actor);
  }, TX_OPTS);
  notifyChanged(exerciseId);
  await advanceExercise(exerciseId, actor);
}

// ---------------------------------------------------------------------------
// Advance and release
// ---------------------------------------------------------------------------

export type AdvanceResult =
  | { ok: true; injectId: string; held: boolean }
  | { ok: false; reason: "ended" | "busy" | "not_live" | "raced" };

/**
 * Plan and publish the next inject. Refuses when an inject is still open or
 * held. Ends the exercise when the mode has nothing left or an end rule fires.
 */
export async function advanceExercise(exerciseId: string, actor: Actor): Promise<AdvanceResult> {
  const { snapshot, mode } = await loadSnapshot(db, exerciseId);
  if (snapshot.exercise.status !== "live") return { ok: false, reason: "not_live" };
  if (snapshot.injects.some((i) => i.status === "open" || i.status === "held")) {
    return { ok: false, reason: "busy" };
  }

  const endReason = mode.checkEnd(snapshot, new Date());
  if (endReason) {
    await endExercise(exerciseId, endReason, actor);
    return { ok: false, reason: "ended" };
  }

  // A pending row left by a crashed advance would otherwise hold its seq forever.
  const stale = snapshot.injects.filter(
    (i) => i.status === "pending" && i.openedAt === null && i.closedAt === null,
  );
  if (stale.length > 0) {
    await db.inject.deleteMany({
      where: { id: { in: stale.map((i) => i.id) }, status: "pending", createdAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    });
  }
  const live = await db.inject.findFirst({ where: { exerciseId }, orderBy: { seq: "desc" }, select: { seq: true } });
  const seq = (live?.seq ?? 0) + 1;
  const lastClosed = [...snapshot.injects].reverse().find((i) => i.status === "closed") ?? null;
  const lastClose = lastClosed ? await lastCloseSummary(exerciseId, lastClosed.id) : null;

  // Claim the seq before planning so concurrent advances collapse to one.
  let pendingId: string;
  try {
    const pending = await db.inject.create({
      data: { exerciseId, seq, status: "pending", source: "template", title: "Preparing" },
      select: { id: true },
    });
    pendingId = pending.id;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { ok: false, reason: "raced" };
    throw e;
  }

  let draft;
  try {
    const history = await recentHistory(snapshot, 3);
    draft = await mode.planInject({ snapshot, seq, lastClose, history });
  } catch (err) {
    await db.inject.delete({ where: { id: pendingId } }).catch(() => undefined);
    await db.exerciseEvent.create({
      data: { exerciseId, type: "advance_failed", data: json({ error: String((err as Error).message ?? err) }) },
    });
    notifyChanged(exerciseId, undefined, "control");
    throw err;
  }

  if (!draft) {
    await db.inject.delete({ where: { id: pendingId } }).catch(() => undefined);
    await endExercise(exerciseId, "template_exhausted", actor);
    return { ok: false, reason: "ended" };
  }

  const hold = Boolean(draft.hold && mode.caps.controllerHold);
  const now = new Date();
  const closesAt = !hold && draft.budgetMs ? new Date(now.getTime() + draft.budgetMs) : null;

  const published = await db.$transaction(async (tx) => {
    await tx.inject.update({
      where: { id: pendingId },
      data: {
        title: draft.title,
        source: draft.source,
        scenarioTime: draft.scenarioTime,
        targetTeamIds: draft.targetTeamIds,
        content: json(draft.content),
        secret: json(draft.secret),
        templateInjectId: draft.templateInjectId,
        budgetMs: draft.budgetMs,
      },
    });
    const moved = await transitionInject(tx, pendingId, "pending", hold ? "held" : "open", hold ? {} : { openedAt: now, closesAt });
    if (!moved) return null;
    const res = await tx.exercise.updateMany({
      where: { id: exerciseId, status: "live", currentInjectId: snapshot.exercise.currentInjectId },
      data: { currentInjectId: pendingId, stateVersion: { increment: 1 } },
    });
    if (res.count !== 1) throw new RaceAbort();
    await addEvent(
      tx,
      exerciseId,
      hold ? "inject_held" : "inject_released",
      { seq, title: draft.title, source: draft.source, scenarioTime: draft.scenarioTime?.toISOString() ?? null },
      actor,
      pendingId,
    );
    return true;
  }, TX_OPTS).catch(async (e) => {
    // P2025: an ENDEX deleted the pending row first.
    if (e instanceof RaceAbort || (e as { code?: string }).code === "P2025") {
      await db.inject.delete({ where: { id: pendingId } }).catch(() => undefined);
      return null;
    }
    throw e;
  });

  if (!published) return { ok: false, reason: "raced" };
  if (closesAt) scheduleInjectTimer(exerciseId, pendingId, closesAt);
  notifyChanged(exerciseId);
  return { ok: true, injectId: pendingId, held: hold };
}

class RaceAbort extends Error {}

/** Effective grade per response: the latest human grade. */
export function effectiveGrades<G extends { responseId: string; source: string; createdAt: Date }>(grades: G[]): Map<string, G> {
  const out = new Map<string, G>();
  const sorted = [...grades].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const g of sorted) {
    const prev = out.get(g.responseId);
    if (!prev || g.source === "human" || prev.source !== "human") out.set(g.responseId, g);
  }
  return out;
}

async function lastCloseSummary(exerciseId: string, injectId: string) {
  const ev = await db.exerciseEvent.findFirst({
    where: { exerciseId, injectId, type: "inject_closed" },
    orderBy: { at: "desc" },
    select: { data: true },
  });
  const data = (ev?.data ?? {}) as { summary?: Record<string, unknown> };
  const summary: Record<string, unknown> = { ...(data.summary ?? {}) };

  // Enrich with grades so branch conditions can see outcomes.
  const responses = await db.response.findMany({
    where: { injectId, kind: { in: ["answer", "entry", "deliverable"] } },
    select: { id: true, teamId: true, team: { select: { name: true } }, grades: true },
  });
  const eff = effectiveGrades(responses.flatMap((r) => r.grades));
  const scores: number[] = [];
  const outcomes: Record<string, string> = {};
  for (const r of responses) {
    const g = eff.get(r.id);
    if (!g) continue;
    if (typeof g.score === "number") scores.push(g.score);
    if (r.team?.name && g.rating) outcomes[r.team.name] = g.rating;
  }
  if (scores.length) summary.avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (Object.keys(outcomes).length) summary.outcomes = outcomes;
  return { injectId, summary };
}

async function recentHistory(snapshot: ExerciseSnapshot, count: number) {
  const closed = snapshot.injects.filter((i) => i.status === "closed").slice(-count);
  if (closed.length === 0) return [];
  const responses = await db.response.findMany({
    where: { injectId: { in: closed.map((i) => i.id) } },
    orderBy: { createdAt: "asc" },
    include: { grades: true },
  });
  const eff = effectiveGrades(responses.flatMap((r) => r.grades));
  const teamName = new Map(snapshot.teams.map((t) => [t.id, t.name]));
  return closed.map((i) => ({
    injectId: i.id,
    seq: i.seq,
    title: i.title,
    content: i.content,
    responses: responses
      .filter((r) => r.injectId === i.id)
      .map((r) => {
        const g = eff.get(r.id);
        return {
          teamId: r.teamId,
          teamName: r.teamId ? (teamName.get(r.teamId) ?? null) : null,
          kind: r.kind as ResponseKind,
          payload: r.payload,
          rating: g?.rating ?? null,
          score: g?.score ?? null,
        };
      }),
  }));
}

/** Release a held inject, optionally with controller edits to its public content. */
export async function releaseInject(
  exerciseId: string,
  injectId: string,
  actor: Actor,
  edits?: { title?: string; content?: unknown; targetTeamIds?: string[] },
): Promise<void> {
  const inj = await db.inject.findFirst({
    where: { id: injectId, exerciseId },
    select: { budgetMs: true, status: true, exercise: { select: { status: true, mode: true, teams: { select: { id: true } } } } },
  });
  if (!inj) throw new TransitionError(404, "Inject not found.");
  if (inj.exercise.status !== "live") throw new TransitionError(409, "Resume the exercise before releasing an inject.");
  if (edits?.content !== undefined) {
    const { getMode } = await import("@/lib/exercise/modes/registry");
    if (!getMode(inj.exercise.mode as never).injectContentSchema.safeParse(edits.content).success) {
      throw new TransitionError(400, "The edited inject is not valid. Check the fields and try again.");
    }
  }
  if (edits?.targetTeamIds) {
    const teamIds = new Set(inj.exercise.teams.map((t) => t.id));
    if (!edits.targetTeamIds.every((id) => teamIds.has(id))) throw new TransitionError(400, "A selected team is not part of this exercise.");
  }
  const now = new Date();
  const closesAt = inj.budgetMs ? new Date(now.getTime() + inj.budgetMs) : null;
  await db.$transaction(async (tx) => {
    const ok = await transitionInject(tx, injectId, "held", "open", {
      openedAt: now,
      closesAt,
      releasedById: actor.participantId ?? null,
      ...(edits?.title ? { title: edits.title } : {}),
      ...(edits?.content !== undefined ? { content: json(edits.content) } : {}),
      ...(edits?.targetTeamIds ? { targetTeamIds: edits.targetTeamIds } : {}),
    });
    if (!ok) throw new TransitionError(409, "Inject is not held.");
    await addEvent(tx, exerciseId, "inject_released", { edited: Boolean(edits) }, actor, injectId);
    await bumpVersion(tx, exerciseId);
  }, TX_OPTS);
  if (closesAt) scheduleInjectTimer(exerciseId, injectId, closesAt);
  notifyChanged(exerciseId);
}

/** Discard a held inject so the controller can advance again. */
export async function discardHeldInject(exerciseId: string, injectId: string, actor: Actor): Promise<void> {
  await db.$transaction(async (tx) => {
    const res = await tx.inject.deleteMany({ where: { id: injectId, exerciseId, status: "held" } });
    if (res.count !== 1) throw new TransitionError(409, "Inject is not held.");
    const ex = await tx.exercise.findUnique({ where: { id: exerciseId }, select: { currentInjectId: true } });
    if (ex?.currentInjectId === injectId) {
      const prev = await tx.inject.findFirst({
        where: { exerciseId, status: "closed" },
        orderBy: { seq: "desc" },
        select: { id: true },
      });
      await tx.exercise.update({ where: { id: exerciseId }, data: { currentInjectId: prev?.id ?? null } });
    }
    await addEvent(tx, exerciseId, "inject_discarded", { injectId }, actor);
    await bumpVersion(tx, exerciseId);
  }, TX_OPTS);
  notifyChanged(exerciseId);
}

// ---------------------------------------------------------------------------
// Respond
// ---------------------------------------------------------------------------

export async function submitResponse(args: {
  exerciseId: string;
  injectId: string;
  participant: ParticipantRow;
  kind: ResponseKind;
  raw: unknown;
}): Promise<{ responseId: string }> {
  const { snapshot, mode } = await loadSnapshot(db, args.exerciseId);
  if (snapshot.exercise.status !== "live") throw new ResponseError(409, "Exercise is not live.");
  const inject = snapshot.injects.find((i) => i.id === args.injectId);
  if (!inject) throw new ResponseError(404, "Inject not found.");

  const responseId = await db.$transaction(async (tx) => {
    const open = await tx.$queryRaw<Array<{ ok: number }>>`
      SELECT 1 AS ok FROM "Inject" WHERE id = ${args.injectId} AND "exerciseId" = ${args.exerciseId} AND status = 'open' FOR SHARE`;
    if (open.length === 0) throw new ResponseError(409, "This inject is closed.");

    const existingRows = await tx.response.findMany({
      where: {
        injectId: args.injectId,
        OR: [{ participantId: args.participant.id }, ...(args.participant.teamId ? [{ teamId: args.participant.teamId }] : [])],
      },
    });
    const validated = mode.validateResponse({
      snapshot,
      inject,
      participant: args.participant,
      kind: args.kind,
      raw: args.raw,
      existing: existingRows.map(toResponseRow),
    });

    let id: string;
    if (validated.replaceId) {
      const updated = await tx.response.update({
        where: { id: validated.replaceId },
        data: { payload: json(validated.payload), participantId: args.participant.id, teamId: validated.teamId },
        select: { id: true },
      });
      id = updated.id;
    } else {
      try {
        const created = await tx.response.create({
          data: {
            exerciseId: args.exerciseId,
            injectId: args.injectId,
            participantId: args.participant.id,
            teamId: validated.teamId,
            kind: validated.kind,
            payload: json(validated.payload),
          },
          select: { id: true },
        });
        id = created.id;
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") throw new ResponseError(409, "A response already exists.");
        throw e;
      }
    }
    await bumpVersion(tx, args.exerciseId);
    return id;
  }, TX_OPTS);

  notifyChanged(args.exerciseId);

  // Auto-close when every required responder is in.
  const policy = snapshot.exercise.advancePolicy;
  if (policy === "votes_in" || policy === "all_teams") {
    await maybeCloseWhenComplete(args.exerciseId, args.injectId, policy === "votes_in" ? "votes_in" : "all_teams", mode, snapshot, inject);
  }
  return { responseId };
}

async function maybeCloseWhenComplete(
  exerciseId: string,
  injectId: string,
  trigger: CloseTrigger,
  mode: ExerciseMode,
  snapshot: ExerciseSnapshot,
  inject: InjectRow,
): Promise<void> {
  const required = mode.requiredResponders(snapshot, inject);
  if (required.by === "none" || required.ids.length === 0) return;
  const rows = await db.response.findMany({
    where: { injectId, kind: { in: ["vote", "answer"] } },
    select: { participantId: true, teamId: true },
  });
  const have = new Set(required.by === "participant" ? rows.map((r) => r.participantId) : rows.map((r) => r.teamId ?? ""));
  if (required.ids.every((id) => have.has(id))) {
    await closeInject(exerciseId, injectId, trigger, {});
  }
}

/**
 * Re-check the open inject after the roster changed (a player excused,
 * removed or moved). Closes it when the advance policy waits for responses
 * and everyone still required has responded. Returns true when it closed.
 */
export async function closeIfResponsesComplete(exerciseId: string): Promise<boolean> {
  const { snapshot, mode } = await loadSnapshot(db, exerciseId);
  if (snapshot.exercise.status !== "live") return false;
  const policy = snapshot.exercise.advancePolicy;
  if (policy !== "votes_in" && policy !== "all_teams") return false;
  const inject = snapshot.injects.find((i) => i.status === "open");
  if (!inject) return false;
  const before = await db.inject.findUnique({ where: { id: inject.id }, select: { status: true } });
  await maybeCloseWhenComplete(exerciseId, inject.id, policy, mode, snapshot, inject);
  const after = await db.inject.findUnique({ where: { id: inject.id }, select: { status: true } });
  return before?.status === "open" && after?.status === "closed";
}

// ---------------------------------------------------------------------------
// Close
// ---------------------------------------------------------------------------

export type CloseResult =
  | { closed: true; outcome: CloseOutcome; endReason: EndReason | null }
  | { closed: false; reason: string };

export async function closeInject(
  exerciseId: string,
  injectId: string,
  trigger: CloseTrigger,
  actor: Actor,
  opts: { autoAdvance?: boolean } = {},
): Promise<CloseResult> {
  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    const won = await tx.inject.updateMany({
      where: { id: injectId, exerciseId, status: "open" },
      data: { status: "closed", closedAt: now, closeTrigger: trigger },
    });
    if (won.count === 0) return null;

    const { snapshot, mode } = await loadSnapshot(tx, exerciseId);
    const inject = snapshot.injects.find((i) => i.id === injectId)!;
    const responses = (await tx.response.findMany({ where: { injectId } })).map(toResponseRow);
    const closeSnap = { ...snapshot, inject, responses, trigger, now };
    const outcome = mode.scoreClose(closeSnap);

    if (outcome.abstains.length > 0) {
      await tx.response.createMany({
        data: outcome.abstains.map((a) => ({
          exerciseId,
          injectId,
          participantId: a.participantId,
          teamId: a.teamId,
          kind: "vote",
          payload: json(a.payload),
        })),
        skipDuplicates: true,
      });
    }
    for (const u of outcome.responseUpdates) {
      const row = responses.find((r) => r.id === u.responseId);
      const base = (row?.payload ?? {}) as Record<string, unknown>;
      await tx.response.update({ where: { id: u.responseId }, data: { payload: json({ ...base, ...u.payloadPatch }) } });
    }
    if (outcome.score) {
      await tx.scoreState.upsert({
        where: { exerciseId },
        create: {
          exerciseId,
          path: outcome.score.path,
          cumulative: outcome.score.cumulative,
          teamScores: json(outcome.score.teamScores),
        },
        update: {
          path: outcome.score.path,
          cumulative: outcome.score.cumulative,
          teamScores: json(outcome.score.teamScores),
        },
      });
    }
    if (outcome.clockUpdates?.length) {
      await applyClockUpdates(tx, exerciseId, inject.scenarioTime ?? now, outcome.clockUpdates);
    }
    await addEvent(tx, exerciseId, "inject_closed", { seq: inject.seq, trigger, summary: outcome.summary }, actor, injectId);
    for (const ev of outcome.events) await addEvent(tx, exerciseId, ev.type, ev.data, actor, injectId);
    const jobs = mode.jobsAfterClose(closeSnap, outcome);
    for (const job of jobs) await enqueueJob(tx, job);
    const version = await bumpVersion(tx, exerciseId);

    const after = { ...snapshot, injects: snapshot.injects.map((i) => (i.id === injectId ? { ...i, status: "closed" as const } : i)), score: outcome.score ?? snapshot.score };
    const endReason = outcome.endReason ?? mode.checkEnd(after, now);
    return {
      outcome,
      version,
      endReason,
      policy: snapshot.exercise.advancePolicy,
      config: snapshot.config as Record<string, unknown>,
      // Branch conditions can read grades, so a branched template waits for this close's grading jobs.
      waitForJobs: snapshot.template?.branching === "branched" ? jobs.map((j) => j.key) : [],
    };
  }, TX_OPTS);

  if (!result) return { closed: false, reason: "already closed" };
  clearExerciseTimer(exerciseId, injectId);
  kickWorker();
  notifyChanged(exerciseId, result.version);

  if (trigger === "endex") return { closed: true, outcome: result.outcome, endReason: null };

  if (result.endReason) {
    await endExercise(exerciseId, result.endReason, actor);
    return { closed: true, outcome: result.outcome, endReason: result.endReason };
  }

  const holdAfterClose = Boolean(result.config?.holdAfterClose);
  const auto = opts.autoAdvance ?? (result.policy !== "facilitator" && !holdAfterClose);
  if (auto) {
    const keys = result.waitForJobs;
    void (async () => {
      if (keys.length > 0) await waitForJobs(keys, GRADE_WAIT_MS);
      await advanceExercise(exerciseId, actor);
    })().catch((err) => console.error(`[runtime] auto-advance failed for ${exerciseId}:`, err));
  }
  return { closed: true, outcome: result.outcome, endReason: null };
}

/** Longest auto-advance waits for grading before branching without grades. */
export const GRADE_WAIT_MS = 120_000;

/** Wait until every job key is done or failed, or the timeout passes. */
export async function waitForJobs(keys: string[], timeoutMs: number, pollMs = 1_500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = await db.job.count({ where: { key: { in: keys }, status: { in: ["queued", "running"] } } });
    if (pending === 0) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pause, resume, end
// ---------------------------------------------------------------------------

export async function pauseExercise(exerciseId: string, actor: Actor): Promise<void> {
  const now = new Date();
  await db.$transaction(async (tx) => {
    const ok = await transitionExercise(tx, exerciseId, "live", "paused", { pausedAt: now });
    if (!ok) throw new TransitionError(409, "Exercise is not live.");
    await addEvent(tx, exerciseId, "paused", {}, actor);
  }, TX_OPTS);
  clearExerciseTimer(exerciseId);
  notifyChanged(exerciseId);
}

export async function resumeExercise(exerciseId: string, actor: Actor): Promise<void> {
  const now = new Date();
  let reschedule: { injectId: string; closesAt: Date } | null = null;
  await db.$transaction(async (tx) => {
    const ex = await tx.exercise.findUnique({ where: { id: exerciseId }, select: { pausedAt: true, status: true } });
    if (!ex || ex.status !== "paused" || !ex.pausedAt) throw new TransitionError(409, "Exercise is not paused.");
    const pausedMs = Math.max(0, now.getTime() - ex.pausedAt.getTime());
    // Inject row before the exercise row, the same order closeInject uses.
    const open = await tx.inject.findFirst({ where: { exerciseId, status: "open" }, select: { id: true, closesAt: true } });
    if (open?.closesAt) {
      const closesAt = new Date(open.closesAt.getTime() + pausedMs);
      await tx.inject.update({ where: { id: open.id }, data: { closesAt } });
      reschedule = { injectId: open.id, closesAt };
    }
    const ok = await transitionExercise(tx, exerciseId, "paused", "live", {
      pausedAt: null,
      pausedMsTotal: { increment: pausedMs },
    });
    if (!ok) throw new TransitionError(409, "Exercise is not paused.");
    await addEvent(tx, exerciseId, "resumed", { pausedMs }, actor);
  }, TX_OPTS);
  if (reschedule) {
    const r = reschedule as { injectId: string; closesAt: Date };
    scheduleInjectTimer(exerciseId, r.injectId, r.closesAt);
  }
  notifyChanged(exerciseId);
}

/** Extend the open inject's deadline. */
export async function extendInject(exerciseId: string, injectId: string, addMs: number, actor: Actor): Promise<void> {
  let closesAt: Date | null = null;
  await db.$transaction(async (tx) => {
    const inj = await tx.inject.findFirst({ where: { id: injectId, exerciseId, status: "open" }, select: { closesAt: true } });
    if (!inj) throw new TransitionError(409, "Inject is not open.");
    closesAt = new Date((inj.closesAt ?? new Date()).getTime() + addMs);
    await tx.inject.update({ where: { id: injectId }, data: { closesAt } });
    await addEvent(tx, exerciseId, "inject_extended", { addMs }, actor, injectId);
    await bumpVersion(tx, exerciseId);
  }, TX_OPTS);
  if (closesAt) scheduleInjectTimer(exerciseId, injectId, closesAt);
  notifyChanged(exerciseId);
}

export async function endExercise(exerciseId: string, reason: EndReason, actor: Actor): Promise<boolean> {
  // Close whatever is open first so its responses are scored.
  const open = await db.inject.findFirst({ where: { exerciseId, status: "open" }, select: { id: true } });
  if (open) await closeInject(exerciseId, open.id, "endex", actor, { autoAdvance: false });

  const now = new Date();
  // Lock order matches advance, release, respond and close: inject rows, then
  // clock rows, then the exercise row. Taking the exercise row first deadlocked
  // against an advance publishing at the same moment.
  const ended = await db
    .$transaction(async (tx) => {
      const ex = await tx.exercise.findUnique({ where: { id: exerciseId }, select: { status: true, pausedAt: true } });
      if (!ex || (ex.status !== "live" && ex.status !== "paused")) return false;
      await tx.inject.deleteMany({ where: { exerciseId, status: { in: ["pending", "held"] } } });
      await finalizeClocks(tx, exerciseId);
      const extraPaused = ex.status === "paused" && ex.pausedAt ? now.getTime() - ex.pausedAt.getTime() : 0;
      const ok = await transitionExercise(tx, exerciseId, ["live", "paused"], "ended", {
        endedAt: now,
        endReason: reason,
        pausedAt: null,
        ...(extraPaused ? { pausedMsTotal: { increment: extraPaused } } : {}),
      });
      if (!ok) throw new RaceAbort();
      await addEvent(tx, exerciseId, "endex", { reason }, actor);
      return true;
    }, TX_OPTS)
    .catch((e) => {
      if (e instanceof RaceAbort) return false;
      throw e;
    });
  if (!ended) return false;
  // An advance that published between the open check above and the ended
  // transition leaves an open inject behind. Close it now; closeInject does not
  // need the exercise to be live, and an endex close never auto-advances.
  await closeStragglers(exerciseId, actor);
  clearExerciseTimer(exerciseId);
  notifyChanged(exerciseId);
  await runEndHooks(exerciseId, reason);
  return true;
}

async function closeStragglers(exerciseId: string, actor: Actor): Promise<void> {
  const open = await db.inject.findMany({ where: { exerciseId, status: "open" }, select: { id: true } });
  for (const inj of open) await closeInject(exerciseId, inj.id, "endex", actor, { autoAdvance: false });
  await db.inject.deleteMany({ where: { exerciseId, status: { in: ["pending", "held"] } } });
}

/**
 * At ENDEX, a running clock whose deadline is at or before the last scenario
 * time is missed. One whose deadline is later stays running and is reported
 * as open at ENDEX with its due time.
 */
async function finalizeClocks(tx: Tx, exerciseId: string): Promise<void> {
  const last = await tx.inject.findFirst({
    where: { exerciseId, scenarioTime: { not: null }, status: { in: ["open", "closed"] } },
    orderBy: { seq: "desc" },
    select: { scenarioTime: true },
  });
  if (!last?.scenarioTime) return;
  const missed = await tx.regulatoryClock.findMany({
    where: { exerciseId, status: "running", deadlineAt: { lte: last.scenarioTime } },
    select: { id: true, key: true, label: true },
  });
  for (const c of missed) {
    await tx.regulatoryClock.update({ where: { id: c.id }, data: { status: "missed" } });
    await addEvent(tx, exerciseId, "clock_missed", { key: c.key, label: c.label });
  }
}

export async function abandonExercise(exerciseId: string, actor: Actor): Promise<void> {
  await db.$transaction(async (tx) => {
    const ok = await transitionExercise(tx, exerciseId, ["draft", "lobby", "live", "paused"], "abandoned", { endedAt: new Date(), endReason: "abandoned" });
    if (!ok) throw new TransitionError(409, "Exercise cannot be abandoned.");
    await addEvent(tx, exerciseId, "abandoned", {}, actor);
  }, TX_OPTS);
  await closeStragglers(exerciseId, actor);
  clearExerciseTimer(exerciseId);
  notifyChanged(exerciseId);
}

export { currentInject, activeParticipants };
