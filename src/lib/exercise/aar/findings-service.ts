// Findings tab actions behind POST /api/exercises/{id}/aar/findings. The
// route checks access and audits each change. This resolves the latest
// version and applies the action through the one findings model.

import { z } from "zod";
import { ServiceError } from "@/lib/exercise/errors";
import { applyFindings } from "@/lib/exercise/improvement/afis";
import type { FindingAction, FindingActionResult } from "./findings";
import { collectFindings, newFindingId } from "./service";
import { latestAar } from "./store";

const id = z.string().min(1).max(40);
const ids = z.array(id).min(1, "Pick at least one finding.").max(140);
const reason = {
  preset: z.string().max(40).nullable().optional(),
  reason: z.string().trim().max(1000, "Use 1000 characters or fewer.").optional(),
  reference: z.string().trim().max(300, "Use 300 characters or fewer.").optional(),
};

export const findingsActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), ids, objectiveId: id.nullable().optional() }),
  z.object({ action: z.literal("reject"), ids, ...reason }),
  z.object({ action: z.literal("no_action"), ids, ...reason }),
  z.object({ action: z.literal("reopen"), ids }),
  z.object({ action: z.literal("merge"), primaryId: id, secondaryId: id }),
  z.object({
    action: z.literal("add"),
    objectiveId: id.nullable(),
    title: z.string().trim().min(1, "Give the finding a title.").max(300),
    observation: z.string().trim().max(3000).optional(),
    analysis: z.string().trim().max(3000).optional(),
    recommendation: z.string().trim().max(2000).optional(),
  }),
  z.object({ action: z.literal("collect") }),
]);
export type FindingsActionInput = z.infer<typeof findingsActionSchema>;

export function toFindingAction(input: Exclude<FindingsActionInput, { action: "collect" }>, makeId: () => string = newFindingId): FindingAction {
  switch (input.action) {
    case "accept":
      return { kind: "accept", ids: input.ids, ...(input.objectiveId !== undefined ? { objectiveId: input.objectiveId } : {}) };
    case "reject":
    case "no_action":
      return { kind: input.action, ids: input.ids, preset: input.preset ?? null, reason: input.reason ?? "", reference: input.reference ?? "" };
    case "reopen":
      return { kind: "reopen", ids: input.ids };
    case "merge":
      return { kind: "merge", primaryId: input.primaryId, secondaryId: input.secondaryId };
    case "add":
      return {
        kind: "add",
        id: makeId(),
        objectiveId: input.objectiveId,
        title: input.title,
        observation: input.observation,
        analysis: input.analysis,
        recommendation: input.recommendation,
      };
  }
}

export async function findingsAction(
  exerciseId: string,
  input: FindingsActionInput,
  userId: string | null,
): Promise<{ aarId: string; changed: FindingActionResult["changed"]; proposed?: number }> {
  if (input.action === "collect") {
    const r = await collectFindings(exerciseId, userId);
    return { aarId: r.aarId, changed: [], proposed: r.proposed };
  }
  const latest = await latestAar(exerciseId);
  if (!latest) throw new ServiceError(404, "After-action report not found.");
  const changed = await applyFindings(latest.id, toFindingAction(input), userId);
  return { aarId: latest.id, changed };
}
