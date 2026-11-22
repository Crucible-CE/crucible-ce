// Template branch runtime. Pure. Picks the next template inject for a mode
// that follows a template (Document TTX, Strategic TTX). Crisis Sim branches
// inside each inject through path variants and does not use this.
//
// Linear templates deliver injects in seq order. Branched templates follow the
// outgoing branches of the last delivered node, in priority order; the first
// branch whose condition matches the last close summary wins. A "default"
// branch matches when nothing else does. With no matching branch the next
// undelivered inject by seq is used. A node is never delivered twice.

import { z } from "zod";
import type { ExerciseSnapshot, TemplateInjectRow } from "@/lib/exercise/runtime/types";

export const branchConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always") }),
  z.object({ type: z.literal("default") }),
  /** Crisis-style path in the last close summary (`newPath`). */
  z.object({ type: z.literal("path"), path: z.string() }),
  /** A team's majority option in the last close summary (`majority[team]`). */
  z.object({ type: z.literal("majority"), team: z.string(), optionId: z.string() }),
  /** Average evaluator rating on the last inject (`avgScore`, 0 to 4). */
  z.object({ type: z.literal("score_below"), value: z.number() }),
  z.object({ type: z.literal("score_at_least"), value: z.number() }),
  /** Count of entries of a type on the last inject (`byType[type]`). */
  z.object({ type: z.literal("entries_at_least"), entryType: z.string(), count: z.number().int() }),
  /** A team marked a given outcome (`outcomes[team]`), set by Strategic TTX grading. */
  z.object({ type: z.literal("team_outcome"), team: z.string(), outcome: z.string() }),
]);
export type BranchCondition = z.infer<typeof branchConditionSchema>;

export function evaluateCondition(cond: unknown, summary: Record<string, unknown> | null | undefined): boolean {
  const parsed = branchConditionSchema.safeParse(cond);
  if (!parsed.success) return false;
  const c = parsed.data;
  const s = summary ?? {};
  switch (c.type) {
    case "always":
      return true;
    case "default":
      return false; // handled separately
    case "path":
      return s.newPath === c.path;
    case "majority": {
      const m = (s.majority ?? {}) as Record<string, string | null>;
      return m[c.team] === c.optionId;
    }
    case "score_below":
      return typeof s.avgScore === "number" && s.avgScore < c.value;
    case "score_at_least":
      return typeof s.avgScore === "number" && s.avgScore >= c.value;
    case "entries_at_least": {
      const byType = (s.byType ?? {}) as Record<string, number>;
      return (byType[c.entryType] ?? 0) >= c.count;
    }
    case "team_outcome": {
      const o = (s.outcomes ?? {}) as Record<string, string>;
      return o[c.team] === c.outcome;
    }
  }
}

export function nextTemplateInject(
  snapshot: Pick<ExerciseSnapshot, "template" | "injects" | "exercise">,
  lastClose: { injectId: string; summary: Record<string, unknown> } | null,
): TemplateInjectRow | null {
  const t = snapshot.template;
  if (!t || t.injects.length === 0) return null;
  const ordered = [...t.injects].sort((a, b) => a.seq - b.seq);
  const deliveredIds = new Set(
    snapshot.injects.filter((i) => i.templateInjectId && i.status !== "pending").map((i) => i.templateInjectId as string),
  );
  const deliveredCount = deliveredIds.size;
  if (snapshot.exercise.injectBudget && deliveredCount >= snapshot.exercise.injectBudget) return null;

  const firstUndelivered = ordered.find((i) => !deliveredIds.has(i.id)) ?? null;
  if (t.branching !== "branched" || t.branches.length === 0) return firstUndelivered;

  // Last delivered template node, by exercise inject order.
  const lastDelivered = [...snapshot.injects]
    .filter((i) => i.templateInjectId && i.status !== "pending")
    .sort((a, b) => a.seq - b.seq)
    .at(-1);
  if (!lastDelivered) {
    // Start at a node with no incoming branches, lowest seq.
    const targets = new Set(t.branches.map((b) => b.toNodeId));
    return ordered.find((i) => !targets.has(i.nodeId)) ?? ordered[0];
  }
  const fromNode = t.injects.find((i) => i.id === lastDelivered.templateInjectId);
  if (!fromNode) return firstUndelivered;

  const byNode = new Map(t.injects.map((i) => [i.nodeId, i]));
  const outgoing = t.branches.filter((b) => b.fromNodeId === fromNode.nodeId).sort((a, b) => a.priority - b.priority);
  if (outgoing.length === 0) {
    // A node with no outgoing branches ends a branched template.
    return null;
  }
  const summary = lastClose?.injectId === lastDelivered.id ? lastClose.summary : null;
  const pick =
    outgoing.find((b) => evaluateCondition(b.condition, summary)) ??
    outgoing.find((b) => branchConditionSchema.safeParse(b.condition).data?.type === "default") ??
    null;
  if (!pick) return null;
  const target = byNode.get(pick.toNodeId) ?? null;
  if (!target || deliveredIds.has(target.id)) return null;
  return target;
}
