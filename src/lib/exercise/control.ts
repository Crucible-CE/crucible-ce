// POST /api/exercises/{id}/control. Drivers only (the route checks). Each
// action calls the runtime engine; this file maps results to HTTP-shaped
// errors and writes the audit trail.

import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import {
  abandonExercise,
  advanceExercise,
  closeInject,
  discardHeldInject,
  endExercise,
  extendInject,
  notifyChanged,
  pauseExercise,
  releaseInject,
  resumeExercise,
  startExercise,
  type Actor,
} from "@/lib/exercise/runtime/engine";
import { bumpVersion, transitionExercise } from "@/lib/exercise/runtime/transition";
import { applyClockUpdates, type ClockUpdateResult } from "@/lib/exercise/runtime/clocks-db";
import { findMode } from "@/lib/exercise/modes/registry";
import { ServiceError } from "./errors";
import { syncObjectiveInjects } from "./objectives";
import type { ControlInput } from "./schemas";

export interface ControlContext {
  exerciseId: string;
  actor: Actor;
  req: Request;
}

function auditAction(ctx: ControlContext, action: string, targetType: string, targetId: string, data: Record<string, unknown> = {}) {
  audit({
    actorUserId: ctx.actor.userId ?? null,
    actorParticipantId: ctx.actor.participantId ?? null,
    action,
    targetType,
    targetId,
    data: data as never,
    req: ctx.req,
  });
}

async function injectIn(exerciseId: string, injectId: string | undefined, status: "open" | "held"): Promise<string> {
  const row = injectId
    ? await db.inject.findFirst({ where: { id: injectId, exerciseId }, select: { id: true, status: true } })
    : await db.inject.findFirst({ where: { exerciseId, status }, orderBy: { seq: "desc" }, select: { id: true, status: true } });
  if (!row) throw new ServiceError(409, status === "open" ? "No inject is open." : "No inject is waiting for release.");
  if (row.status !== status) throw new ServiceError(409, status === "open" ? "That inject is not open." : "That inject is not held.");
  return row.id;
}

/** Server side of the readiness checklist: the checks that block STARTEX. */
export async function assertReadyToStart(exerciseId: string): Promise<void> {
  const ex = await db.exercise.findUnique({
    where: { id: exerciseId },
    select: { scenarioStartAt: true, _count: { select: { clocks: true } } },
  });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  if (ex._count.clocks > 0 && !ex.scenarioStartAt) {
    throw new ServiceError(409, "Set the scenario start before you start. Regulatory clocks count from it.");
  }
}

const CLOCK_ERRORS: Record<Exclude<ClockUpdateResult, "ok">, [number, string]> = {
  unknown: [404, "That clock is not part of this exercise."],
  already_triggered: [409, "That clock is already running. Reset it first."],
  already_met: [409, "That clock is already met. Reset it first."],
  not_triggered: [409, "That clock has not started. Start it first."],
};

/** Scenario time for a control clock change: the current inject, else the scenario start. */
async function controlScenarioTime(exerciseId: string): Promise<Date> {
  const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { currentInjectId: true, scenarioStartAt: true } });
  const inj = ex?.currentInjectId
    ? await db.inject.findUnique({ where: { id: ex.currentInjectId }, select: { scenarioTime: true } })
    : null;
  return inj?.scenarioTime ?? ex?.scenarioStartAt ?? new Date();
}

const ADVANCE_ERRORS: Record<string, [number, string]> = {
  busy: [409, "An inject is still open or held. Close or release it first."],
  not_live: [409, "The exercise is not live."],
  raced: [409, "Someone else advanced at the same time."],
};

export async function runControl(ctx: ControlContext, input: ControlInput): Promise<Record<string, unknown>> {
  const { exerciseId, actor } = ctx;
  switch (input.action) {
    case "start": {
      await assertReadyToStart(exerciseId);
      await startExercise(exerciseId, actor);
      auditAction(ctx, "exercise.started", "Exercise", exerciseId);
      await syncObjectiveInjects(exerciseId).catch(() => 0);
      return { ok: true };
    }
    case "open_lobby":
    case "close_lobby": {
      const [from, to] = input.action === "open_lobby" ? (["draft", "lobby"] as const) : (["lobby", "draft"] as const);
      const ok = await db.$transaction(async (tx) => {
        const won = await transitionExercise(tx, exerciseId, from, to);
        if (won) {
          await tx.exerciseEvent.create({
            data: { exerciseId, type: to === "lobby" ? "lobby_opened" : "lobby_closed", actorUserId: actor.userId ?? null, actorParticipantId: actor.participantId ?? null },
          });
        }
        return won;
      });
      if (!ok) throw new ServiceError(409, input.action === "open_lobby" ? "The lobby is already open or the exercise has started." : "The lobby is not open.");
      notifyChanged(exerciseId);
      return { ok: true };
    }
    case "advance": {
      const open = await db.inject.findFirst({ where: { exerciseId, status: "open" }, select: { id: true } });
      if (open) {
        // Advance with an open inject closes it and moves on.
        const res = await closeInject(exerciseId, open.id, "facilitator", actor, { autoAdvance: true });
        if (!res.closed) throw new ServiceError(409, "The inject closed at the same time. Try again.");
        auditAction(ctx, "inject.closed", "Inject", open.id, { trigger: "facilitator", via: "advance" });
        return { ok: true, closed: open.id };
      }
      const res = await advanceExercise(exerciseId, actor);
      if (!res.ok) {
        if (res.reason === "ended") return { ok: true, ended: true };
        const [status, message] = ADVANCE_ERRORS[res.reason] ?? [409, "The exercise could not advance."];
        throw new ServiceError(status, message);
      }
      await syncObjectiveInjects(exerciseId).catch(() => 0);
      return { ok: true, injectId: res.injectId, held: res.held };
    }
    case "release": {
      const injectId = await injectIn(exerciseId, input.injectId, "held");
      await releaseInject(exerciseId, injectId, actor, input.edits);
      auditAction(ctx, "inject.released", "Inject", injectId, { edited: Boolean(input.edits) });
      await syncObjectiveInjects(exerciseId).catch(() => 0);
      return { ok: true };
    }
    case "discard": {
      const injectId = await injectIn(exerciseId, input.injectId, "held");
      await discardHeldInject(exerciseId, injectId, actor);
      auditAction(ctx, "inject.discarded", "Inject", injectId);
      return { ok: true };
    }
    case "close": {
      const injectId = await injectIn(exerciseId, input.injectId, "open");
      const res = await closeInject(exerciseId, injectId, "facilitator", actor);
      if (!res.closed) throw new ServiceError(409, "That inject is already closed.");
      auditAction(ctx, "inject.closed", "Inject", injectId, { trigger: "facilitator" });
      return { ok: true };
    }
    case "pause":
      await pauseExercise(exerciseId, actor);
      auditAction(ctx, "exercise.paused", "Exercise", exerciseId);
      return { ok: true };
    case "resume":
      await resumeExercise(exerciseId, actor);
      auditAction(ctx, "exercise.resumed", "Exercise", exerciseId);
      return { ok: true };
    case "extend": {
      if (!input.addMinutes) throw new ServiceError(400, "Say how many minutes to add.");
      const injectId = await injectIn(exerciseId, input.injectId, "open");
      await extendInject(exerciseId, injectId, input.addMinutes * 60_000, actor);
      return { ok: true };
    }
    case "endex": {
      const ended = await endExercise(exerciseId, "facilitator", actor);
      if (!ended) throw new ServiceError(409, "The exercise is not running.");
      auditAction(ctx, "exercise.ended", "Exercise", exerciseId, { reason: "facilitator" });
      await syncObjectiveInjects(exerciseId).catch(() => 0);
      return { ok: true };
    }
    case "abandon":
      await abandonExercise(exerciseId, actor);
      auditAction(ctx, "exercise.abandoned", "Exercise", exerciseId);
      return { ok: true };
    case "broadcast": {
      if (!input.message) throw new ServiceError(400, "Write a message.");
      const teamId = input.teamId ?? null;
      if (teamId) {
        const t = await db.team.findFirst({ where: { id: teamId, exerciseId }, select: { id: true } });
        if (!t) throw new ServiceError(400, "That team is not part of this exercise.");
      }
      const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { status: true } });
      if (!ex || ex.status === "ended" || ex.status === "abandoned") throw new ServiceError(409, "The exercise is over.");
      const version = await db.$transaction(async (tx) => {
        await tx.exerciseEvent.create({
          data: {
            exerciseId,
            type: "broadcast",
            actorUserId: actor.userId ?? null,
            actorParticipantId: actor.participantId ?? null,
            data: { message: input.message!, teamId },
          },
        });
        return bumpVersion(tx, exerciseId);
      });
      notifyChanged(exerciseId, version);
      return { ok: true };
    }
    case "clock": {
      if (!input.clock) throw new ServiceError(400, "Pick a clock and an action.");
      const { key, action } = input.clock;
      const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { status: true } });
      if (!ex || (ex.status !== "live" && ex.status !== "paused")) throw new ServiceError(409, "Clocks change only while the exercise runs.");
      const at = await controlScenarioTime(exerciseId);
      const version = await db.$transaction(async (tx) => {
        const [result] = await applyClockUpdates(tx, exerciseId, at, [{ key, action }], actor);
        if (result && result !== "ok") {
          const [status, message] = CLOCK_ERRORS[result];
          throw new ServiceError(status, message);
        }
        return bumpVersion(tx, exerciseId);
      });
      auditAction(ctx, action === "trigger" ? "clock.triggered" : action === "met" ? "clock.met" : "clock.reset", "Exercise", exerciseId, { key, scenarioTime: at.toISOString() });
      notifyChanged(exerciseId, version);
      return { ok: true };
    }
    case "config": {
      const patch = input.config ?? {};
      if (Object.keys(patch).length === 0) throw new ServiceError(400, "Nothing to change.");
      const version = await db.$transaction(async (tx) => {
        const ex = await tx.exercise.findUnique({ where: { id: exerciseId }, select: { mode: true, config: true, status: true } });
        if (!ex || ex.status === "ended" || ex.status === "abandoned") throw new ServiceError(409, "The exercise is over.");
        const mode = findMode(ex.mode);
        if (!mode) throw new ServiceError(400, "This exercise type is not available.");
        const merged = { ...((ex.config ?? {}) as Record<string, unknown>), ...patch };
        const parsed = mode.configSchema.safeParse(merged);
        // A key the mode schema drops would be lost without a word.
        const kept = parsed.success ? (parsed.data as Record<string, unknown>) : null;
        if (!kept || Object.keys(patch).some((k) => !(k in kept))) throw new ServiceError(400, "That setting does not apply to this exercise.");
        await tx.exercise.update({ where: { id: exerciseId }, data: { config: kept as never } });
        await tx.exerciseEvent.create({
          data: { exerciseId, type: "config_changed", actorUserId: actor.userId ?? null, actorParticipantId: actor.participantId ?? null, data: patch },
        });
        return bumpVersion(tx, exerciseId);
      });
      auditAction(ctx, "exercise.config_changed", "Exercise", exerciseId, patch);
      notifyChanged(exerciseId, version);
      return { ok: true };
    }
  }
}
