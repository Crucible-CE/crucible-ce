// Regulatory clock writes. Used by closeInject (mode clock effects) and by the
// `clock` control action. Runs inside the caller's transaction.

import type { Tx } from "@/lib/db";
import { clockDeadline } from "./clocks";

export type ClockAction = "trigger" | "met" | "reset";

/** What happened to one requested update. */
export type ClockUpdateResult = "ok" | "unknown" | "already_triggered" | "already_met" | "not_triggered";

/**
 * Start, satisfy or reset regulatory clocks at a scenario time.
 *   trigger  sets triggeredAt and the deadline (hours, or business days
 *            skipping weekends). A clock that already started is left alone.
 *   met      records metAt and whether it beat the deadline. A clock that
 *            never started cannot be met; it stays pending.
 *   reset    clears triggeredAt, deadlineAt and metAt and sets it pending.
 * Each change appends an ExerciseEvent. Returns one result per update.
 */
export async function applyClockUpdates(
  tx: Tx,
  exerciseId: string,
  scenarioTime: Date,
  updates: Array<{ key: string; action: ClockAction }>,
  actor: { userId?: string | null; participantId?: string | null } = {},
): Promise<ClockUpdateResult[]> {
  const clocks = await tx.regulatoryClock.findMany({ where: { exerciseId } });
  const out: ClockUpdateResult[] = [];
  const event = (type: string, data: Record<string, unknown>) =>
    tx.exerciseEvent.create({
      data: {
        exerciseId,
        type,
        data: data as never,
        actorUserId: actor.userId ?? null,
        actorParticipantId: actor.participantId ?? null,
      },
    });
  for (const u of updates) {
    const clock = clocks.find((c) => c.key === u.key);
    if (!clock) {
      out.push("unknown");
      continue;
    }
    if (u.action === "trigger") {
      if (clock.triggeredAt) {
        out.push("already_triggered");
        continue;
      }
      const deadlineAt = clockDeadline(scenarioTime, clock.durationHours, clock.businessDays);
      await tx.regulatoryClock.update({
        where: { id: clock.id },
        data: { triggeredAt: scenarioTime, deadlineAt, metAt: null, status: "running" },
      });
      clock.triggeredAt = scenarioTime;
      clock.deadlineAt = deadlineAt;
      clock.status = "running";
      await event("clock_triggered", { key: clock.key, label: clock.label, deadlineAt: deadlineAt?.toISOString() ?? null });
      out.push("ok");
    } else if (u.action === "met") {
      if (!clock.triggeredAt) {
        out.push("not_triggered");
        continue;
      }
      if (clock.metAt) {
        out.push("already_met");
        continue;
      }
      const onTime = !clock.deadlineAt || scenarioTime.getTime() <= clock.deadlineAt.getTime();
      await tx.regulatoryClock.update({
        where: { id: clock.id },
        data: { metAt: scenarioTime, status: onTime ? "met" : "missed" },
      });
      clock.metAt = scenarioTime;
      await event("clock_met", { key: clock.key, label: clock.label, onTime });
      out.push("ok");
    } else {
      await tx.regulatoryClock.update({
        where: { id: clock.id },
        data: { triggeredAt: null, deadlineAt: null, metAt: null, status: "pending" },
      });
      clock.triggeredAt = null;
      clock.deadlineAt = null;
      clock.metAt = null;
      clock.status = "pending";
      await event("clock_reset", { key: clock.key, label: clock.label });
      out.push("ok");
    }
  }
  return out;
}
