// Areas for improvement (AFIs) in AAR sections and how they are decided.
// One model for the Findings tab and the improvement plan panel:
//
//   proposed -> accepted -> action item | "No action needed" with a reason
//   proposed -> rejected with a reason (out of the report, in the appendix)
//
// Finalize refuses while a finding is proposed, or accepted with neither an
// action item nor a "No action needed" reason. Every decision goes through
// resolveAfi or applyFindings, which append an edit log entry.

import type { Prisma } from "@prisma/client";
import { db, type DbClient } from "@/lib/db";
import { aarSectionsSchema, type AarSections, type Afi, type EditLogEntry, type FindingDecision, type FindingSource, type FindingStatus } from "@/lib/exercise/aar/schema";
import { assertAarEditable, lockAarRow } from "@/lib/exercise/aar/lock";
import { AarEditError } from "@/lib/exercise/aar/edit";
import { allFindings, applyFindingAction, type FindingAction, type FindingActionResult } from "@/lib/exercise/aar/findings";
import { REVIEW_FROZEN_MESSAGE } from "@/lib/exercise/aar/store";
import { ServiceError } from "@/lib/exercise/errors";

export interface AfiRef {
  id: string;
  title: string;
  observation: string;
  analysis: string;
  recommendation: string;
  capabilityKey: string | null;
  /** Null for a finding with no objective yet. */
  objectiveId: string | null;
  objectiveText: string;
  actionItemId: string | null;
  rejectedReason: string | null;
  status: FindingStatus;
  decision: FindingDecision | null;
  sources: FindingSource[];
  evidence: Afi["evidence"];
  /** analysis index (-1 with no objective) and finding index, for edit log paths. */
  at: [number, number];
}

export function parseSections(raw: unknown): AarSections | null {
  const r = aarSectionsSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function listAfis(sections: AarSections): AfiRef[] {
  return allFindings(sections).map((v) => ({
    id: v.afi.id,
    title: v.afi.title,
    observation: v.afi.observation,
    analysis: v.afi.analysis,
    recommendation: v.afi.recommendation,
    capabilityKey: v.afi.capabilityKey,
    objectiveId: v.objectiveId,
    objectiveText: v.objectiveText,
    actionItemId: v.afi.actionItemId,
    rejectedReason: v.afi.rejectedReason,
    status: v.afi.status,
    decision: v.afi.decision,
    sources: v.afi.sources,
    evidence: v.afi.evidence,
    at: [v.objectiveIndex ?? -1, v.index],
  }));
}

/** The afiId an ActionItem.evidence references, if any. Accepts {afiId} or [{afiId}]. */
export function evidenceAfiId(evidence: unknown): string | null {
  if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
    const v = (evidence as { afiId?: unknown }).afiId;
    return typeof v === "string" && v ? v : null;
  }
  if (Array.isArray(evidence)) {
    for (const e of evidence) {
      const v = e && typeof e === "object" ? (e as { afiId?: unknown }).afiId : null;
      if (typeof v === "string" && v) return v;
    }
  }
  return null;
}

/**
 * Findings that still need a decision: proposed, or accepted with neither an
 * action item nor a "No action needed" reason. A rejected finding has its
 * reason. `items` are the exercise's ActionItem rows (id and evidence).
 */
export function unresolvedAfis(sections: AarSections, items: Array<{ id: string; evidence: unknown }>): AfiRef[] {
  const itemIds = new Set(items.map((i) => i.id));
  const referenced = new Set(items.map((i) => evidenceAfiId(i.evidence)).filter((x): x is string => Boolean(x)));
  return listAfis(sections).filter((f) => {
    if (f.rejectedReason && f.rejectedReason.trim()) return false;
    if (f.actionItemId && itemIds.has(f.actionItemId)) return false;
    if (referenced.has(f.id)) return false;
    if (f.status === "accepted" && f.decision?.kind === "no_action") return false;
    return true;
  });
}

export type AfiResolution =
  | { actionItemId: string }
  | { rejectedReason: string }
  | { noAction: { preset?: string | null; reason?: string | null; reference?: string | null } }
  | { reopen: true };

function readEditLog(raw: unknown): EditLogEntry[] {
  return Array.isArray(raw) ? (raw as EditLogEntry[]) : [];
}

async function actorName(tx: DbClient, userId: string | null): Promise<string> {
  if (!userId) return "";
  const u = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name ?? "";
}

/**
 * Apply a findings action to the AAR in one transaction and append a human
 * edit log entry per change. Refuses a final or older version. Decisions are
 * allowed in draft and review, like the improvement plan. Merging and writing
 * a finding change the report text, so they need draft.
 */
export async function applyFindings(aarId: string, action: FindingAction, byUserId: string | null, client?: DbClient): Promise<FindingActionResult["changed"]> {
  const run = async (tx: DbClient) => {
    await lockAarRow(tx, aarId);
    const aar = await assertAarEditable(aarId, tx);
    if ((action.kind === "merge" || action.kind === "add") && aar.status !== "draft") throw new ServiceError(409, REVIEW_FROZEN_MESSAGE);
    const sections = parseSections(aar.sections);
    if (!sections) throw new ServiceError(409, "The report sections could not be read. Regenerate or fix the draft first.");
    let result: FindingActionResult;
    try {
      result = applyFindingAction(sections, action, { userId: byUserId, name: await actorName(tx, byUserId) });
    } catch (e) {
      if (e instanceof AarEditError) throw new ServiceError(e.status, e.message);
      throw e;
    }
    const at = new Date().toISOString();
    const entries: EditLogEntry[] = result.log.map((l) => ({ ...l, path: l.path?.slice(0, 120), origin: "human", byUserId, at }));
    await tx.afterActionReport.update({
      where: { id: aarId },
      data: {
        sections: result.sections as unknown as Prisma.InputJsonValue,
        editLog: [...readEditLog(aar.editLog), ...entries] as unknown as Prisma.InputJsonValue,
      },
    });
    return result.changed;
  };
  if (client) return run(client);
  return db.$transaction(async (tx) => run(tx));
}

/**
 * Record how one AFI was resolved: an action item, a rejection, "No action
 * needed", or reopened. The same model as the Findings tab.
 */
export async function resolveAfi(aarId: string, afiId: string, resolution: AfiResolution, byUserId: string | null, client?: DbClient): Promise<void> {
  let action: FindingAction;
  if ("actionItemId" in resolution) action = { kind: "link_action", id: afiId, actionItemId: resolution.actionItemId };
  else if ("rejectedReason" in resolution) {
    const reason = resolution.rejectedReason.trim();
    if (!reason) throw new ServiceError(400, "Give a reason for the rejection.");
    action = { kind: "reject", ids: [afiId], preset: null, reason };
  } else if ("noAction" in resolution) action = { kind: "no_action", ids: [afiId], ...resolution.noAction };
  else action = { kind: "reopen", ids: [afiId] };
  await applyFindings(aarId, action, byUserId, client);
}
